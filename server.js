require('dotenv').config();

const {
  loadRegionCacheFromKV,
  saveRegionCacheToKV,
  regionCache,
  inFlightCrawls
} = require('./js/cache.js');

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const SITE_PER_PAGE = 20;

const CSS_DIR = path.join(__dirname, "css");
const JS_DIR = path.join(__dirname, "js");

const STEAM_CC = "ph";

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function decodeHtml(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    );
}

function parseReviewSpan(spanHtml) {
  if (!spanHtml) return { review_rating: "", review_percent: 0, review_count: 0 };
  const tooltipMatch = spanHtml.match(/data-tooltip-html="([^"]*)"/i);
  const tooltip = tooltipMatch ? decodeHtml(tooltipMatch[1]) : "";
  const reviewMatch = tooltip.match(/^([^<]+)/);
  const pctMatch = tooltip.match(/(\d+)%/);
  const countMatch = tooltip.match(/of the ([\d,]+) user reviews/i);
  return {
    review_rating: reviewMatch ? reviewMatch[1].trim() : "",
    review_percent: pctMatch ? Number(pctMatch[1]) : 0,
    review_count: countMatch ? Number(countMatch[1].replace(/,/g, "")) : 0,
  };
}

function parsePrice(str = "") {
  const cleaned = str
    .replace(/[^\d.,]/g, "")
    .replace(/,/g, "");

  const value = parseFloat(cleaned);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100);
}

function parseSteamResults(html) {
  const deals = [];

  const rowRegex =
    /<a\b[^>]*class="[^"]*\bsearch_result_row\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi;

  const rows = html.match(rowRegex) || [];

  for (const row of rows) {

    const idMatch =
      row.match(/data-ds-appid="([^"]+)"/i);

    if (!idMatch) continue;

    const id = Number(
      idMatch[1].split(",")[0]
    );

    if (!id) continue;

    const nameMatch =
      row.match(
        /<span[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      );

    if (!nameMatch) continue;

    const name = decodeHtml(
      nameMatch[1]
        .replace(/<[^>]+>/g, "")
        .trim()
    );

    const imageMatch =
      row.match(
        /<div[^>]*class="[^"]*\bsearch_capsule\b[^"]*"[^>]*>\s*<img[^>]+src="([^"]+)"/i
      );

    const image = imageMatch
      ? decodeHtml(imageMatch[1])
      : "";

    const discountMatch =
      row.match(
        /<div[^>]*class="[^"]*\bdiscount_block\b[^"]*"[^>]*data-discount="(\d+)"/i
      );

    const discountPercent =
      discountMatch
        ? Number(discountMatch[1])
        : 0;

    const originalMatch =
      row.match(
        /<div[^>]*class="[^"]*\bdiscount_original_price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i
      );

    const originalPrice =
      parsePrice(
        originalMatch
          ? decodeHtml(originalMatch[1])
          : ""
      );

    const finalMatch =
      row.match(
        /<div[^>]*class="[^"]*\bdiscount_final_price\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i
      );

    const finalPrice =
      parsePrice(
        finalMatch
          ? decodeHtml(finalMatch[1])
          : ""
      );

    const reviewMatch = row.match(
      /<div[^>]*class="[^"]*\bsearch_reviewscore responsive_secondrow\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );

    const {
      review_rating,
      review_percent,
      review_count
    } = parseReviewSpan(
      reviewMatch ? reviewMatch[1] : ""
    );

    const userReview =
      parsePrice(
        reviewMatch
          ? decodeHtml(reviewMatch[1])
          : ""
      );

    const urlMatch =
      row.match(/<a\b[^>]*href="([^"]+)"/i);

    const url =
      urlMatch
        ? decodeHtml(urlMatch[1])
        : `https://store.steampowered.com/app/${id}`;

    deals.push({
      id,
      name,
      discount_percent: discountPercent,
      original_price: originalPrice,
      final_price: finalPrice,
      large_capsule_image: image,
      header_image: image,
      small_capsule_image: image,
      review_rating,
      review_percent,
      review_count,
      url,
    });
  }

  return {
    deals,
    rawRowCount: rows.length,
  };
}

function getTotalResults(html) {
  const patterns = [
    /([\d,]+)\s+results match your search/i,
    /([\d,]+)\s+results/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (match) {
      return Number(
        match[1].replace(/,/g, "")
      );
    }
  }

  return 0;
}

const STEAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml",
  "Accept-Language":
    "en-US,en;q=0.9",
  "Referer":
    "https://store.steampowered.com/",
};

async function steamFetch(url) {
  const response = await fetch(url, {
    headers: STEAM_HEADERS,
  });

  if (!response.ok) {
    const error = new Error(
      `Steam returned HTTP ${response.status}`
    );
    error.status = response.status;
    error.retryAfter =
      response.headers.get("retry-after");
    throw error;
  }

  return response;
}

async function fetchSteamSearchJsonPage({
  cc,
  start,
  count,
}) {

  const params = new URLSearchParams();

  params.set("query", "");
  params.set("start", String(start));
  params.set("count", String(count));
  params.set("sort_by", "_ASC");
  params.set("order", "_DESC");
  params.set("specials", "1");
  params.set("infinite", "1");
  params.set("json", "1");
  params.set("cc", cc);
  params.set("l", "english");

  const url =
    `https://store.steampowered.com/search/results/?${params.toString()}`;

  const response = await steamFetch(url);
  const json = await response.json();

  if (typeof json.results_html !== "string") {
    throw new Error(
      "Unexpected response shape from Steam search AJAX endpoint"
    );
  }

  const { deals, rawRowCount } =
    parseSteamResults(json.results_html);

  return {
    rawDeals: deals,
    rawRowCount,
    steamTotal: Number(json.total_count) || 0,
  };
}

async function fetchSteamFullPage({
  cc,
  page,
}) {

  const params = new URLSearchParams();

  params.set("cc", cc);
  params.set("l", "english");
  params.set("specials", "1");
  params.set("page", String(page));
  params.set("sort_by", "_ASC");

  const url =
    `https://store.steampowered.com/search/?${params.toString()}`;

  const response = await steamFetch(url);
  const html = await response.text();

  const { deals, rawRowCount } =
    parseSteamResults(html);

  return {
    rawDeals: deals,
    rawRowCount,
    steamTotal: getTotalResults(html),
  };
}

const CRAWL_PAGE_SIZE = 100;
const CRAWL_FETCH_DELAY_MS = 3000;

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
let steamCooldownUntil = 0;

function isInCooldown() {
  return Date.now() < steamCooldownUntil;
}

function enterCooldown(retryAfterHeader) {

  let ms = DEFAULT_COOLDOWN_MS;

  if (retryAfterHeader) {

    const asSeconds = Number(retryAfterHeader);

    if (Number.isFinite(asSeconds)) {
      ms = Math.max(
        asSeconds * 1000,
        DEFAULT_COOLDOWN_MS
      );
    } else {
      const asDate = Date.parse(retryAfterHeader);
      if (!Number.isNaN(asDate)) {
        ms = Math.max(
          asDate - Date.now(),
          DEFAULT_COOLDOWN_MS
        );
      }
    }
  }

  const until = Date.now() + ms;

  if (until > steamCooldownUntil) {
    steamCooldownUntil = until;
    console.warn(
      `[crawl] rate limited (429) — pausing ALL crawling `
      + `until ${new Date(until).toISOString()} `
      + `(${Math.round(ms / 1000)}s)`
    );
  }
}

async function crawlRegion(cc) {

  let accumulated = [];
  let steamTotal = 0;
  let start = 0;
  let useJson = true;
  let page = 1; // only used by the full-page fallback
  let complete = false;

  console.log(`[crawl] starting ${cc}`);

  while (true) {

    let pageResult;

    try {

      pageResult = useJson
        ? await fetchSteamSearchJsonPage({
            cc,
            start,
            count: CRAWL_PAGE_SIZE,
          })
        : await fetchSteamFullPage({ cc, page });

    } catch (error) {

      if (error.status === 429) {
        enterCooldown(error.retryAfter);

        console.warn(
          `[crawl] ${cc}: rate limited, stopping crawl `
          + `(had ${accumulated.length} deals so far)`
        );

        complete = false;
        break;
      }

      if (useJson && start === 0) {

        console.warn(
          `[crawl] ${cc}: AJAX JSON endpoint failed `
          + `(${error.message}), falling back to full-page scrape`
        );

        useJson = false;
        continue;
      }

      console.warn(
        `[crawl] ${cc}: stopping EARLY (incomplete) after `
        + `failure (${error.message}) — accumulated `
        + `${accumulated.length} deals so far, Steam `
        + `reported ${steamTotal} total matching`
      );

      complete = false;
      break;
    }

    const { rawDeals, rawRowCount, steamTotal: pageTotal } =
      pageResult;

    if (start === 0 && page === 1) {
      steamTotal = pageTotal;
    }

    const filtered = rawDeals.filter(
      deal => deal.discount_percent > 0
    );

    accumulated = accumulated.concat(filtered);
    console.log(`[crawl] ph: page fetched, ${accumulated.length} deals so far (steamTotal: ${steamTotal})`);

    if (rawRowCount === 0) {
      complete = true;
      break;
    }

    if (useJson) {
      start += CRAWL_PAGE_SIZE;
      if (steamTotal > 0 && start >= steamTotal) {
        complete = true;
        break;
      }
    } else {
      page += 1;
      if (rawRowCount < CRAWL_PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    await sleep(CRAWL_FETCH_DELAY_MS);
  }

  console.log(
    `[crawl] ${cc}: ${complete ? "done" : "STOPPED INCOMPLETE"}, `
    + `${accumulated.length} discounted deals `
    + `(steamTotal reported: ${steamTotal})`
  );

  return {
    deals: accumulated,
    steamTotal,
    complete,
    updatedAt: Date.now(),
  };
}

async function refreshRegion(cc) {

  if (isInCooldown()) {
    console.log(
      `[crawl] skipping ${cc} — rate-limit cooldown `
      + `active until ${new Date(steamCooldownUntil).toISOString()}`
    );
    return;
  }

  if (inFlightCrawls.has(cc)) {
    return inFlightCrawls.get(cc);
  }

  const crawlPromise = (async () => {

    const result = await crawlRegion(cc);

    if (result.deals.length === 0) {
      console.warn(
        `[cache] ${cc}: crawl produced no deals, `
        + `keeping previous cache if any`
      );
      return;
    }

    regionCache.set(cc, result);
    await saveRegionCacheToKV(cc, result);

  })().finally(() => {
    inFlightCrawls.delete(cc);
  });

  inFlightCrawls.set(cc, crawlPromise);

  return crawlPromise;
}

async function getRegionData(cc) {

  if (regionCache.has(cc)) {
    return regionCache.get(cc);
  }

  await refreshRegion(cc);

  return regionCache.get(cc) || null;
}

const RECRAWL_INTERVAL_MS = 10 * 60 * 1000; // 30 minutes

async function refreshPhRegion() {
  try {
    await refreshRegion(STEAM_CC);
  } catch (error) {
    console.error(
      `[cache] background refresh of ${STEAM_CC} failed: `
      + error.message
    );
  }
}

const server = http.createServer(
  async (req, res) => {

    if (req.url.startsWith("/api/steam")) {

      try {

        const url = new URL(
          req.url,
          `http://localhost:${PORT}`
        );

        const cc = STEAM_CC;

        const requestedPage =
          Math.max(
            1,
            Number(
              url.searchParams.get("page")
            ) || 1
          );

        const sort =
          url.searchParams.get("sort")
          || "discount";

        const search =
          url.searchParams
            .get("search")
            ?.trim() || "";

        const regionData =
          await getRegionData(cc);

        if (!regionData) {
          throw new Error(
            `No data available for region "${cc}" `
            + `(initial crawl failed)`
          );
        }

        const searchLower =
          search.toLowerCase();

        let deals = search
          ? regionData.deals.filter(
              d =>
                d.name
                  .toLowerCase()
                  .includes(searchLower)
            )
          : regionData.deals.slice();

        if (sort === "discount") {

          deals.sort((a, b) => {

            if (
              b.discount_percent !==
              a.discount_percent
            ) {
              return (
                b.discount_percent -
                a.discount_percent
              );
            }

            return (
              a.final_price - b.final_price
            );
          });

        } else if (sort === "price-asc") {

          deals.sort(
            (a, b) =>
              a.final_price - b.final_price
          );

        } else if (sort === "price-desc") {

          deals.sort(
            (b, a) =>
              a.final_price - b.final_price
          );

        } else if (sort === "review-asc") {

          deals.sort(
            (b, a) =>
              a.review_count - b.review_count
          );

        } else if (sort === "name-asc") {

          deals.sort((a, b) =>
            a.name.localeCompare(b.name)
          );
        } else if (sort === "name-desc") {

          deals.sort((b, a) =>
            a.name.localeCompare(b.name)
          );
        } 

        const total = deals.length;

        const total_pages =
          total > 0
            ? Math.ceil(total / SITE_PER_PAGE)
            : 1;

        const globalStart =
          (requestedPage - 1) * SITE_PER_PAGE;

        const pageDeals = deals.slice(
          globalStart,
          globalStart + SITE_PER_PAGE
        );

        const result = {
          page: requestedPage,
          per_page: SITE_PER_PAGE,
          total,
          total_pages,
          cc,
          sort,
          search,
          updated_at: new Date(
            regionData.updatedAt
          ).toISOString(),

          data_complete:
            regionData.complete !== false,

          deals: pageDeals,
        };

        res.writeHead(200, {
          "Content-Type":
            "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });

        res.end(JSON.stringify(result));

      } catch (error) {

        console.error(
          "Steam API error:",
          error
        );

        res.writeHead(502, {
          "Content-Type":
            "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });

        res.end(
          JSON.stringify({
            error: "Steam request failed",
            message: error.message,
          })
        );
      }

      return;
    }

    if (
      req.url === "/" ||
      req.url === "/index.html"
    ) {

      try {

        const file = fs.readFileSync(
          path.join(__dirname, "index.html")
        );

        res.writeHead(200, {
          "Content-Type":
            "text/html; charset=utf-8",
        });

        res.end(file);

      } catch (error) {

        console.error(error);
        res.writeHead(500);
        res.end("Could not load index.html");
      }

      return;
    }

    if (req.url === "/css/style.css") {
      const cssPath = path.join(CSS_DIR, "style.css");

      fs.readFile(cssPath, "utf8", (err, css) => {

        if (err) {
          res.writeHead(404, {
          "Content-Type": "text/plain"
          });

          res.end("CSS file not found");
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/css"
        });

        res.end(css);
      });

      return;
    }

    if (req.url === "/js/main.compat.js") {
      const jsPath = path.join(JS_DIR, "main.compat.js");

      fs.readFile(jsPath, "utf8", (err, js) => {

      if (err) {
        res.writeHead(404, {
          "Content-Type": "text/plain"
        });

        res.end("JS file not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/javascript"
      });

        res.end(js);

      });

      return;

    }

    res.writeHead(404);
    res.end("Not found");
  }
);

require('dotenv').config();

(async () => {
  await loadRegionCacheFromKV(STEAM_CC);
  server.listen(PORT, () => {
    console.log(
      `DISCOUNT FLOOR running at http://localhost:${PORT}`
    );
  });
  refreshPhRegion();
  setInterval(refreshPhRegion, RECRAWL_INTERVAL_MS);
})();