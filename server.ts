import express from "express";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const rawPort = process.env.PORT || "10000";
const PORT = Number(rawPort);

if (!Number.isFinite(PORT)) {
  throw new Error(`Invalid PORT: ${rawPort}`);
}

// Increase request size limits for base64 uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Temporary storage for images
// Key: unique ID, Value: image metadata & data
interface TempImage {
  id: string;
  filename: string;
  base64: string;
  mimeType: string;
  expireAt: number;
}
const tempStore = new Map<string, TempImage>();

// Serve CORS headers for any external engines attempting to scrape
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Clean up expired temp images every 1 minute
setInterval(() => {
  const now = Date.now();
  for (const [id, img] of tempStore.entries()) {
    if (img.expireAt < now) {
      tempStore.delete(id);
    }
  }
}, 60000);

// Initialize Gemini Client
const aiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (aiKey && aiKey !== "MY_GEMINI_API_KEY") {
  ai = new GoogleGenAI({
    apiKey: aiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// ---------------------- API ROUTES ----------------------

// Proxy endpoint for downloading external image thumbnails to calculate hashes on frontend canvas without CORS taints
app.get("/api/proxy-image", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).send("Error: Missing url parameter");
    }
    const response = await fetch(url as string, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      throw new Error(`Target image replied with status code ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Cache-Control": "public, max-age=1800", // Cache for 30 minutes
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buffer);
  } catch (error: any) {
    res.status(500).send("Proxy error: " + error.message);
  }
});

// Proxy route for TinEye automatic search matching
app.post("/api/search-tineye", async (req, res) => {
  try {
    const { tempUrl } = req.body;
    if (!tempUrl) {
      return res.status(400).json({ error: "Missing tempUrl param" });
    }
    const targetUrl = `https://tineye.com/search?url=${encodeURIComponent(tempUrl)}`;
    const result = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      }
    });

    const html = await result.text();
    if (result.status === 403 || html.includes("Just a moment...") || html.includes("Cloudflare")) {
       return res.json({ success: false, error: "cloudflare_block" });
    }

    if (!result.ok) {
      throw new Error(`TinEye returned status code ${result.status}`);
    }

    const formattedResults: any[] = [];
    
    // TinEye results match structure
    const blockRegex = /<div class="row match-row.*?">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let match;
    while ((match = blockRegex.exec(html)) !== null) {
      const block = match[1];
      
      let thumbnailUrl = "";
      const imgMatch = block.match(/<img.*?src="([^"]+)"/);
      if (imgMatch) {
        thumbnailUrl = imgMatch[1];
      }
      
      let candidateUrl = "";
      const linkMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*rel="nofollow"/);
      if (linkMatch) {
         candidateUrl = linkMatch[1];
      }

      let width = 0, height = 0, sizeText = "";
      const resMatch = block.match(/>\s*(\d+)\s*[xX]\s*(\d+)\s*,?\s*([^<]+)?</);
      if (resMatch) {
         width = parseInt(resMatch[1], 10);
         height = parseInt(resMatch[2], 10);
         sizeText = resMatch[3] ? resMatch[3].trim() : "";
      }
      
      if (candidateUrl && thumbnailUrl) {
         formattedResults.push({
           candidateUrl,
           sourcePageUrl: candidateUrl,
           thumbnailUrl,
           title: "TinEye Match",
           similarity: 90,
           width,
           height,
           resolutionText: sizeText ? `${width}x${height}, ${sizeText}` : `${width}x${height}`
         });
      }
    }

    res.json({ success: true, results: formattedResults });
  } catch (error: any) {
    res.json({ success: false, results: [], error: error.message });
  }
});

// Proxy route for SauceNAO automatic search matching
app.post("/api/search-saucenao", async (req, res) => {
  try {
    const { tempUrl } = req.body;
    if (!tempUrl) {
      return res.status(400).json({ error: "Missing tempUrl param" });
    }
    // Remove output_type=2 to get HTML
    const targetUrl = `https://saucenao.com/search.php?db=999&url=${encodeURIComponent(tempUrl)}`;
    const result = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    
    const html = await result.text();
    if (result.status === 403 || html.includes("Just a moment...") || html.includes("Cloudflare")) {
       return res.json({ success: false, error: "cloudflare_block" });
    }

    if (!result.ok) {
      throw new Error(`SauceNAO returned status code ${result.status}`);
    }

    const formattedResults: any[] = [];
    
    // Parse HTML to extract results
    // SauceNAO results are typically in <div class="result">...</div>
    const resultRegex = /<div class="result.*?">([\s\S]*?)<\/div>\s*<!-- end result -->/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null) {
      const block = match[1];
      
      let similarity = 0;
      const simMatch = block.match(/<div class="resultsimilarityinfo">([\d.]+)%<\/div>/);
      if (simMatch) {
         similarity = parseFloat(simMatch[1]);
      }
      
      let title = "SauceNAO Match";
      const titleMatch = block.match(/<div class="resulttitle">([^<]+)<\/div>/);
      if (titleMatch) {
         title = titleMatch[1].trim();
      }
      
      let thumbnailUrl = "";
      const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
      if (imgMatch) {
         thumbnailUrl = imgMatch[1];
         if (thumbnailUrl.startsWith("/")) {
             thumbnailUrl = "https://saucenao.com" + thumbnailUrl;
         }
      }
      
      let candidateUrl = "";
      // The actual source link is often in <div class="resultcontent">... <a href="...">
      const linkMatch = block.match(/<div class="resultcontent">[\s\S]*?<a href="([^"]+)"/);
      if (linkMatch) {
         candidateUrl = linkMatch[1];
      } else {
         candidateUrl = `https://saucenao.com/search.php?url=${encodeURIComponent(tempUrl)}`;
      }

      let width = 0, height = 0;
      const resMatch = block.match(/(\d+)\s*[xX×]\s*(\d+)/);
      if (resMatch) {
         width = parseInt(resMatch[1], 10);
         height = parseInt(resMatch[2], 10);
      }
      
      formattedResults.push({
        candidateUrl,
        sourcePageUrl: candidateUrl,
        thumbnailUrl,
        title,
        similarity,
        width,
        height,
        resolutionText: width && height ? `${width}x${height}` : ""
      });
    }

    res.json({ success: true, results: formattedResults });
  } catch (error: any) {
    res.json({ success: false, results: [], error: error.message });
  }
});

// Proxy route for IQDB automatic search matching
app.post("/api/search-iqdb", async (req, res) => {
  try {
    const { tempUrl } = req.body;
    if (!tempUrl) {
      return res.status(400).json({ error: "Missing tempUrl param" });
    }
    const targetUrl = `https://iqdb.org/?url=${encodeURIComponent(tempUrl)}`;
    const result = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const html = await result.text();
    if (result.status === 403 || html.includes("Just a moment...") || html.includes("Cloudflare")) {
       return res.json({ success: false, error: "cloudflare_block" });
    }

    if (!result.ok) {
      throw new Error(`IQDB returned status code ${result.status}`);
    }

    const formattedResults: any[] = [];
    const blockRegex = /<td class='image'>\s*<a href="([^"]+)"><img.*?src="([^"]+)".*?<\/a>([\s\S]*?)<\/table>/g;
    let match;
    while ((match = blockRegex.exec(html)) !== null) {
      let href = match[1];
      let src = match[2];
      let rowContent = match[3];

      if (href.startsWith("//")) href = "https:" + href;
      if (src.startsWith("/")) src = "https://iqdb.org" + src;
      
      let width = 0, height = 0, similarity = 85;
      const resMatch = rowContent.match(/(\d+)\s*[x×]\s*(\d+)/i);
      if (resMatch) {
         width = parseInt(resMatch[1], 10);
         height = parseInt(resMatch[2], 10);
      }
      const simMatch = rowContent.match(/([\d.]+)%\s*similarity/i);
      if (simMatch) {
         similarity = parseFloat(simMatch[1]);
      }

      formattedResults.push({
        candidateUrl: href,
        sourcePageUrl: href,
        thumbnailUrl: src,
        title: href.includes("danbooru") ? "Danbooru Source File" : href.includes("gelbooru") ? "Gelbooru Source File" : "Anime Fanart Match",
        similarity,
        width,
        height,
        resolutionText: width && height ? `${width}x${height}` : ""
      });
    }

    res.json({ success: true, results: formattedResults });
  } catch (error: any) {
    res.json({ success: false, results: [], error: error.message });
  }
});

// Proxy route for Danbooru automatic search matching
app.post("/api/search-danbooru", async (req, res) => {
  try {
    const { tempUrl } = req.body;
    if (!tempUrl) {
      return res.status(400).json({ error: "Missing tempUrl param" });
    }
    const targetUrl = `https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(tempUrl)}`;
    const result = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const html = await result.text();
    if (result.status === 403 || html.includes("Just a moment...") || html.includes("Cloudflare") || html.includes("cloudflare")) {
       return res.json({ success: false, error: "cloudflare_block" });
    }

    if (!result.ok) {
      throw new Error(`Danbooru returned status code ${result.status}`);
    }

    const formattedResults: any[] = [];
    const blockRegex = /<article.*?class="(?=[^>]*\bpost-preview\b)[^>]+">([\s\S]*?)<\/article>/gs;
    let match;
    while ((match = blockRegex.exec(html)) !== null) {
      const articleHtml = match[1];
      const linkMatch = articleHtml.match(/<a class="(?=[^>]*\bpost-preview-link\b)[^>]+" href="([^"]+)"/);
      const imgMatch = articleHtml.match(/<img.*?src="([^"]+)"/);
      
      let width = 0, height = 0, similarity = 85;
      const resMatch = articleHtml.match(/(\d+)x(\d+)/);
      if (resMatch) {
         width = parseInt(resMatch[1], 10);
         height = parseInt(resMatch[2], 10);
      }
      const simMatch = articleHtml.match(/([\d.]+)%\s*similar/i);
      if (simMatch) {
         similarity = parseFloat(simMatch[1]);
      }

      if (linkMatch && imgMatch) {
        let href = linkMatch[1];
        let src = imgMatch[1];
        if (href.startsWith("/")) href = "https://danbooru.donmai.us" + href;
        formattedResults.push({
          candidateUrl: href,
          sourcePageUrl: href,
          thumbnailUrl: src,
          title: "Danbooru Artwork",
          similarity,
          width,
          height,
          resolutionText: width && height ? `${width}x${height}` : ""
        });
      }
    }

    res.json({ success: true, results: formattedResults });
  } catch (error: any) {
    res.json({ success: false, results: [], error: error.message });
  }
});

// Proxy route for Yandex automatic search matching
app.post("/api/search-yandex", async (req, res) => {
  try {
    const { tempUrl } = req.body;
    if (!tempUrl) {
      return res.status(400).json({ error: "Missing tempUrl param" });
    }
    const targetUrl = `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(tempUrl)}`;
    const result = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!result.ok) {
      throw new Error(`Yandex returned status code ${result.status}`);
    }

    const html = await result.text();
    if (html.includes("The service is under construction") || html.includes("We will be back soon") || html.includes("The&nbsp;service&nbsp;is under construction") || html.includes("The service is temporarily unavailable")) {
        return res.json({ success: false, error: "service_down", message: "Yandex service is under construction." });
    }
    const formattedResults: any[] = [];
    const blockRegex = /<a href="([^"]+)" class="(?=[^>]*\bserp-item__link\b)[^>]*">([\s\S]*?)<\/a>/gs;
    let match;
    while ((match = blockRegex.exec(html)) !== null) {
      let href = match[1];
      let blockContent = match[2];
      
      let src = "";
      const imgMatch = blockContent.match(/<img.*?src="([^"]+)"/);
      if (imgMatch) {
         src = imgMatch[1];
      }
      if (src.startsWith("//")) src = "https:" + src;

      let width = 0, height = 0;
      const resMatch = blockContent.match(/(\d+)\s*[xX×]\s*(\d+)/);
      if (resMatch) {
         width = parseInt(resMatch[1], 10);
         height = parseInt(resMatch[2], 10);
      }

      if (src) {
        formattedResults.push({
          candidateUrl: href,
          sourcePageUrl: href,
          thumbnailUrl: src.replace("&amp;", "&"),
          title: "Yandex Image Match",
          similarity: 80,
          width,
          height,
          resolutionText: width && height ? `${width}x${height}` : ""
        });
      }
    }

    res.json({ success: true, results: formattedResults });
  } catch (error: any) {
    res.json({ success: false, results: [], error: error.message });
  }
});
app.post("/api/search-ascii2d", async (req, res) => {
  try {
    const { tempUrl } = req.body;
    if (!tempUrl) {
      return res.status(400).json({ error: "Missing tempUrl param" });
    }
    const targetUrl = `https://ascii2d.net/search/url/${encodeURIComponent(tempUrl)}`;
    const result = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const html = await result.text();
    if (result.status === 403 || html.includes("Just a moment...") || html.includes("Cloudflare")) {
       return res.json({ success: false, error: "cloudflare_block" });
    }

    if (!result.ok) {
      throw new Error(`Ascii2d returned status code ${result.status}`);
    }

    const formattedResults: any[] = [];
    const blockRegex = /<div class="row item-box">([\s\S]*?)<\/div>\s*<\/div>/g;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(html)) !== null) {
      const blockContent = blockMatch[1];
      const imgM = blockContent.match(/<img[^>]+src="([^"]+)"/);
      const linkM = blockContent.match(/<a[^>]+href="([^"]+)"/);
      
      let width = 0, height = 0, sizeText = "";
      const resMatch = blockContent.match(/\b(\d+)\s*x\s*(\d+)\b[ \t]+([A-Z]+[ \t]+[\d.]+K?M?B)?/i);
      if (resMatch) {
         width = parseInt(resMatch[1], 10);
         height = parseInt(resMatch[2], 10);
         sizeText = resMatch[3] ? resMatch[3].trim() : "";
      }

      if (imgM && linkM) {
        let src = imgM[1];
        let href = linkM[1];
        if (src.startsWith("/")) src = "https://ascii2d.net" + src;
        formattedResults.push({
          candidateUrl: href,
          sourcePageUrl: href,
          thumbnailUrl: src,
          title: href.includes("pixiv") ? "Pixiv Artwork Match" : href.includes("twitter") ? "Twitter Original Post" : "Ascii2d Index Match",
          similarity: 80,
          width,
          height,
          resolutionText: sizeText ? `${width}x${height} ${sizeText}` : (width ? `${width}x${height}` : "")
        });
      }
    }

    res.json({ success: true, results: formattedResults });
  } catch (error: any) {
    res.json({ success: false, results: [], error: error.message });
  }
});

// Server metadata/healthcheck
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasGeminiKey: !!aiKey && aiKey !== "MY_GEMINI_API_KEY",
    tempImagesCount: tempStore.size,
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    serverHasImgBBKey: !!process.env.IMGBB_API_KEY,
    allowUserImgBBKey: process.env.ALLOW_USER_IMGBB_KEY === "true",
    isProduction: process.env.NODE_ENV === "production"
  });
});

// Upload endpoint for generating temporary externally readable URLs
app.post("/api/upload", async (req, res) => {
  try {
    const { base64, filename, mimeType, expireMinutes } = req.body;
    if (!base64 || !filename) {
      return res.status(400).json({ error: "Missing base64 data or filename" });
    }

    const allowUserImgBBKey = process.env.ALLOW_USER_IMGBB_KEY === "true";
    const serverImgBBKey = process.env.IMGBB_API_KEY;
    const userImgBBKey =
      typeof req.body.imgbbApiKey === "string"
        ? req.body.imgbbApiKey.trim()
        : "";

    const imgbbKey =
      allowUserImgBBKey && userImgBBKey
        ? userImgBBKey
        : serverImgBBKey;

    if (!imgbbKey) {
      if (process.env.NODE_ENV === "production" || allowUserImgBBKey) {
        return res.status(401).json({
          success: false,
          code: "IMGBB_KEY_REQUIRED",
          error: "ImgBB API key is required. Please provide your own ImgBB API key."
        });
      }
    }

    if (imgbbKey) {
      // Production-safe third-party ImgBB integration
      const cleanedBase64 = base64.split(",")[1] || base64;
      
      const params = new URLSearchParams();
      params.append("key", imgbbKey);
      params.append("image", cleanedBase64);
      params.append("name", filename);
      if (expireMinutes) {
        // ImgBB expiration is in seconds (min 60)
        params.append("expiration", (expireMinutes * 60).toString());
      }

      const imgbbRes = await fetch("https://api.imgbb.com/1/upload", {
        method: "POST",
        body: params,
      });

      if (!imgbbRes.ok) {
        let errText = "";
        try {
           errText = await imgbbRes.text();
        } catch(e) {}
        throw new Error("ImgBB upload API error");
      }

      const imgbbData = await imgbbRes.json();
      const durationMs = (expireMinutes || 15) * 60 * 1000;

      return res.json({
        success: true,
        provider: imgbbKey === userImgBBKey ? "user_imgbb" : "server_imgbb",
        id: imgbbData.data.id || crypto.randomUUID(),
        tempUrl: imgbbData.data.url, // Directly the absolutely public i.ibb.co URL
        expireAt: Date.now() + durationMs,
        filename,
      });
    }

    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({
        success: false,
        code: "IMGBB_KEY_REQUIRED",
        error: "ImgBB API key is required. Please provide your own ImgBB API key."
      });
    }

    const id = crypto.randomUUID();
    const durationMs = (expireMinutes || 15) * 60 * 1000;
    const expireAt = Date.now() + durationMs;

    tempStore.set(id, {
      id,
      filename,
      base64,
      mimeType: mimeType || "image/png",
      expireAt,
    });

    // Solve self-referencing server host
    let host = process.env.APP_URL;
    if (!host) {
      const forwardedProto = req.headers["x-forwarded-proto"] || req.protocol;
      const hostHeader = req.headers["x-forwarded-host"] || req.get("host");
      host = `${forwardedProto}://${hostHeader}`;
    }

    // Clean trailing slashes
    if (host.endsWith("/")) {
      host = host.slice(0, -1);
    }

    const tempUrl = `${host}/api/temp-images/${id}`;

    res.json({
      success: true,
      provider: "local-temp-store",
      id,
      tempUrl,
      expireAt,
      filename,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Retrieve raw image for external systems (Reverse Image Search bots)
app.get("/api/temp-images/:id", (req, res) => {
  const { id } = req.params;
  const img = tempStore.get(id);

  if (!img) {
    return res.status(404).send("Error: Image not found (expired or invalid token)");
  }

  if (img.expireAt < Date.now()) {
    tempStore.delete(id);
    return res.status(410).send("Error: This temporary URL has expired (10-30 minutes window exceeded)");
  }

  try {
    const base64Data = img.base64.split(",")[1] || img.base64;
    const buffer = Buffer.from(base64Data, "base64");

    res.writeHead(200, {
      "Content-Type": img.mimeType,
      "Content-Length": buffer.length,
      "Cache-Control": "public, max-age=900", // 15 mins cache
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buffer);
  } catch (error: any) {
    res.status(500).send("Error rendering image: " + error.message);
  }
});

// Endpoints removed



// ---------------------- VITE SETUP ----------------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched and ready! Port: ${PORT}`);
  });
}

startServer();
