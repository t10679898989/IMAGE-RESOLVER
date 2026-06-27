import fetch from "node-fetch";
import fs from "fs";

async function testApi() {
  const payload = { tempUrl: "https://i.ibb.co/HLgbgWSM/FB-IMG-1689164439651-jpg.jpg" };

  // Test IQDB
  const iqdbRes = await fetch(`https://iqdb.org/?url=${encodeURIComponent(payload.tempUrl)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
  });
  fs.writeFileSync("iqdb.html", await iqdbRes.text());

  // Test TinEye
  const tineyeRes = await fetch(`https://tineye.com/search?url=${encodeURIComponent(payload.tempUrl)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
  });
  fs.writeFileSync("tineye.html", await tineyeRes.text());

  // Test Yandex
  const yxRes = await fetch(`https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(payload.tempUrl)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
  });
  fs.writeFileSync("yandex.html", await yxRes.text());
  
  // Test Danbooru
  const danbRes = await fetch(`https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(payload.tempUrl)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
  });
  console.log("Danbooru code:", danbRes.status);
  fs.writeFileSync("danbooru.html", await danbRes.text());
}

testApi();
