import fetch from "node-fetch";

async function testApi() {
  const urls = [
    "http://localhost:3000/api/search-saucenao",
    "http://localhost:3000/api/search-iqdb",
    "http://localhost:3000/api/search-ascii2d",
    "http://localhost:3000/api/search-danbooru",
    "http://localhost:3000/api/search-yandex",
    "http://localhost:3000/api/search-tineye"
  ];
  const payload = { tempUrl: "https://i.ibb.co/HLgbgWSM/FB-IMG-1689164439651-jpg.jpg" };

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      console.log(`[${url}]`, data);
    } catch (e) {
      console.log(`[${url}] Failed:`, e.message);
    }
  }
}

testApi();
