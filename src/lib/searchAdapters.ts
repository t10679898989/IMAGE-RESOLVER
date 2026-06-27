export type AdapterCapabilityMode = "automatic_api" | "browser_automation" | "manual_open_tabs" | "unsupported";

export interface AdapterCapability {
  mode: AdapterCapabilityMode;
  limitation?: string;
}

export interface PublicImagePayload {
  imageId: string;
  originalFilename: string;
  sha256: string;
  phash: string;
  dhash: string;
  width: number;
  height: number;
  fileSize: number;
  publicUrl: string;
  expiresAt: string;
}

export interface CandidateImage {
  candidateUrl: string; // The URL to view the specific result (e.g. twitter post)
  sourcePageUrl: string; // Same as above, or the gallery page
  thumbnailUrl?: string; // Direct image URL of the candidate
  width?: number;
  height?: number;
  similarity?: number;
  title?: string;
  rawScore?: number;
}

export interface AdapterSearchResult {
  engine: "saucenao" | "tineye" | "google_lens" | "danbooru" | "yandex" | "iqdb" | "ascii2d" | "google" | "twitter" | "facebook" | "manual";
  capability: AdapterCapability;
  status: "completed_with_candidates" | "manual_required" | "failed" | "unsupported" | "service_down" | "blocked";
  searchPageUrl?: string; // The URL to open the search engine manually
  candidates: CandidateImage[];
}

export abstract class SearchAdapter {
  abstract readonly engineName: AdapterSearchResult["engine"];
  abstract readonly capability: AdapterCapability;
  abstract search(payload: PublicImagePayload): Promise<AdapterSearchResult>;
}

export class GoogleLensAdapter extends SearchAdapter {
  readonly engineName = "google";
  readonly capability: AdapterCapability = {
    mode: "manual_open_tabs",
    limitation: "API requires complex browser automation or paid GCP Vision API. Currently limited to manual tabs.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    const url = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(payload.publicUrl)}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class SauceNAOAdapter extends SearchAdapter {
  readonly engineName = "saucenao";
  readonly capability: AdapterCapability = {
    mode: "automatic_api",
    limitation: "Automated direct reverse matching supported using public ImgBB URL.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    try {
      const res = await fetch("/api/search-saucenao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempUrl: payload.publicUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "completed_with_candidates",
            searchPageUrl: `https://saucenao.com/search.php?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: data.results.map((r: any) => ({
              candidateUrl: r.candidateUrl,
              sourcePageUrl: r.sourcePageUrl,
              thumbnailUrl: r.thumbnailUrl,
              similarity: r.similarity / 100, // normalized structure
              title: r.title,
              width: r.width,
              height: r.height,
              resolutionText: r.resolutionText
            }))
          };
        } else if (data.error === "service_down") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "service_down",
            searchPageUrl: `https://saucenao.com/search.php?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        } else if (data.error === "cloudflare_block") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "blocked",
            searchPageUrl: `https://saucenao.com/search.php?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        }
      }
    } catch (e) {
      console.error("SauceNAO auto search failed", e);
    }
    const url = `https://saucenao.com/search.php?url=${encodeURIComponent(payload.publicUrl)}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class TinEyeAdapter extends SearchAdapter {
  readonly engineName = "tineye";
  readonly capability: AdapterCapability = {
    mode: "automatic_api",
    limitation: "Automated direct reverse matching supported.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    try {
      const res = await fetch("/api/search-tineye", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempUrl: payload.publicUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "completed_with_candidates",
            searchPageUrl: `https://tineye.com/search?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: data.results.map((r: any) => ({
              candidateUrl: r.candidateUrl,
              sourcePageUrl: r.sourcePageUrl,
              thumbnailUrl: r.thumbnailUrl,
              similarity: r.similarity / 100,
              title: r.title,
              width: r.width,
              height: r.height,
              resolutionText: r.resolutionText
            }))
          };
        } else if (data.error === "service_down") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "service_down",
            searchPageUrl: `https://tineye.com/search?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        } else if (data.error === "cloudflare_block") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "blocked",
            searchPageUrl: `https://tineye.com/search?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        }
      }
    } catch (e) {
      console.error("TinEye auto search failed", e);
    }
    const url = `https://tineye.com/search?url=${encodeURIComponent(payload.publicUrl)}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class DanbooruAdapter extends SearchAdapter {
  readonly engineName = "danbooru";
  readonly capability: AdapterCapability = {
    mode: "automatic_api",
    limitation: "Automated direct reverse matching supported.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    try {
      const res = await fetch("/api/search-danbooru", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempUrl: payload.publicUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "completed_with_candidates",
            searchPageUrl: `https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: data.results.map((r: any) => ({
              candidateUrl: r.candidateUrl,
              sourcePageUrl: r.sourcePageUrl,
              thumbnailUrl: r.thumbnailUrl,
              similarity: r.similarity / 100,
              title: r.title,
              width: r.width,
              height: r.height,
              resolutionText: r.resolutionText
            }))
          };
        } else if (data.error === "service_down") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "service_down",
            searchPageUrl: `https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        } else if (data.error === "cloudflare_block") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "blocked",
            searchPageUrl: `https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        }
      }
    } catch (e) {
      console.error("Danbooru auto search failed", e);
    }
    const url = `https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(payload.publicUrl)}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class IQDBAdapter extends SearchAdapter {
  readonly engineName = "iqdb";
  readonly capability: AdapterCapability = {
    mode: "automatic_api",
    limitation: "Automated reverse image parsing supported using public ImgBB URL.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    try {
      const res = await fetch("/api/search-iqdb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempUrl: payload.publicUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "completed_with_candidates",
            searchPageUrl: `https://iqdb.org/?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: data.results.map((r: any) => ({
              candidateUrl: r.candidateUrl,
              sourcePageUrl: r.sourcePageUrl,
              thumbnailUrl: r.thumbnailUrl,
              similarity: r.similarity / 100,
              title: r.title,
              width: r.width,
              height: r.height,
              resolutionText: r.resolutionText
            }))
          };
        } else if (data.error === "service_down") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "service_down",
            searchPageUrl: `https://iqdb.org/?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        } else if (data.error === "cloudflare_block") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "blocked",
            searchPageUrl: `https://iqdb.org/?url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        }
      }
    } catch (e) {
      console.error("IQDB auto search failed", e);
    }
    const url = `https://iqdb.org/?url=${encodeURIComponent(payload.publicUrl)}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class YandexAdapter extends SearchAdapter {
  readonly engineName = "yandex";
  readonly capability: AdapterCapability = {
    mode: "automatic_api",
    limitation: "Automated direct reverse matching supported.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    try {
      const res = await fetch("/api/search-yandex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempUrl: payload.publicUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "completed_with_candidates",
            searchPageUrl: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: data.results.map((r: any) => ({
              candidateUrl: r.candidateUrl,
              sourcePageUrl: r.sourcePageUrl,
              thumbnailUrl: r.thumbnailUrl,
              similarity: r.similarity / 100,
              title: r.title,
              width: r.width,
              height: r.height,
              resolutionText: r.resolutionText
            }))
          };
        } else if (data.error === "service_down") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "service_down",
            searchPageUrl: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        } else if (data.error === "cloudflare_block") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "blocked",
            searchPageUrl: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        }
      }
    } catch (e) {
      console.error("Yandex auto search failed", e);
    }
    const url = `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(payload.publicUrl)}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class Ascii2dAdapter extends SearchAdapter {
  readonly engineName = "ascii2d";
  readonly capability: AdapterCapability = {
    mode: "automatic_api",
    limitation: "Automated search box crawler supported using public ImgBB URL.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    try {
      const res = await fetch("/api/search-ascii2d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempUrl: payload.publicUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "completed_with_candidates",
            searchPageUrl: `https://ascii2d.net/search/url/${encodeURIComponent(payload.publicUrl)}`,
            candidates: data.results.map((r: any) => ({
              candidateUrl: r.candidateUrl,
              sourcePageUrl: r.sourcePageUrl,
              thumbnailUrl: r.thumbnailUrl,
              similarity: r.similarity / 100,
              title: r.title,
              width: r.width,
              height: r.height,
              resolutionText: r.resolutionText
            }))
          };
        } else if (data.error === "service_down") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "service_down",
            searchPageUrl: `https://ascii2d.net/search/url/${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        } else if (data.error === "cloudflare_block") {
          return {
            engine: this.engineName,
            capability: this.capability,
            status: "blocked",
            searchPageUrl: `https://ascii2d.net/search/url/${encodeURIComponent(payload.publicUrl)}`,
            candidates: []
          };
        }
      }
    } catch (e) {
      console.error("Ascii2d auto search failed", e);
    }
    const url = `https://ascii2d.net/search/url/${encodeURIComponent(payload.publicUrl)}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class TwitterAdapter extends SearchAdapter {
  readonly engineName = "twitter";
  readonly capability: AdapterCapability = {
    mode: "manual_open_tabs",
    limitation: "Image URL search on Twitter requires API or scraped indexes.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    const url = `https://twitter.com/search?q=${encodeURIComponent(payload.originalFilename.split('.')[0])}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "manual_required",
      searchPageUrl: url,
      candidates: []
    };
  }
}

export class FacebookAdapter extends SearchAdapter {
  readonly engineName = "facebook";
  readonly capability: AdapterCapability = {
    mode: "unsupported",
    limitation: "Facebook explicitly prevents reverse image search by URL.",
  };
  async search(payload: PublicImagePayload): Promise<AdapterSearchResult> {
    const url = `https://www.facebook.com/search/top/?q=${encodeURIComponent(payload.originalFilename.split('.')[0])}`;
    return {
      engine: this.engineName,
      capability: this.capability,
      status: "unsupported", // Marked unsupported per criteria
      searchPageUrl: url,
      candidates: []
    };
  }
}

export const ALL_ADAPTERS: SearchAdapter[] = [
  new GoogleLensAdapter(),
  new SauceNAOAdapter(),
  new TinEyeAdapter(),
  new DanbooruAdapter(),
  new IQDBAdapter(),
  new YandexAdapter(),
  new Ascii2dAdapter(),
  new TwitterAdapter(),
  new FacebookAdapter()
];


