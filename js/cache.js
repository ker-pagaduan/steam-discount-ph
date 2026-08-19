const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

const regionCache = new Map();
const inFlightCrawls = new Map();  

function kvUrl(key) {
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`;
}

async function loadRegionCacheFromKV(cc) {
  try {
    const res = await fetch(kvUrl(`deals-${cc}`), {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[cache] KV load ${cc}: HTTP ${res.status}`);
      }
      return;
    }
    const data = await res.json();
    if (Array.isArray(data.deals)) {
      regionCache.set(cc, data);
      console.log(
        `[cache] loaded ${cc} from Cloudflare KV `
        + `(${data.deals.length} deals, `
        + `updated ${new Date(data.updatedAt).toISOString()})`
      );
    }
  } catch (error) {
    console.error(`[cache] failed to load KV cache for ${cc}: ${error.message}`);
  }
}

async function saveRegionCacheToKV(cc, data) {
  try {
    const res = await fetch(kvUrl(`deals-${cc}`), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  } catch (error) {
    console.error(`[cache] failed to write KV cache for ${cc}: ${error.message}`);
  }
}

module.exports = {
  loadRegionCacheFromKV,
  saveRegionCacheToKV,
  regionCache,
  inFlightCrawls,
};