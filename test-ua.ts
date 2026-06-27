import fetch from "node-fetch";

async function testH() {
  const url1 = "https://danbooru.donmai.us/iqdb_queries?url=https%3A%2F%2Fi.ibb.co%2FHLgbgWSM%2FFB-IMG-1689164439651-jpg.jpg";
  const url2 = "https://ascii2d.net/search/url/https%3A%2F%2Fi.ibb.co%2FHLgbgWSM%2FFB-IMG-1689164439651-jpg.jpg";
  
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  const res1 = await fetch(url1, { headers });
  console.log("Danbooru", res1.status, (await res1.text()).substring(0, 50));

  const res2 = await fetch(url2, { headers });
  console.log("Ascii2d", res2.status, (await res2.text()).substring(0, 50));
}

testH();
