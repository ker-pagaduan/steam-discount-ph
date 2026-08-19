let allDeals = [];
let currentPage = 1;
let totalPages = 1;
let totalDeals = 0;
const PER_PAGE = 20;
function money(cents, currencySymbol) {
  if (cents === 0) return "FREE";
  return currencySymbol + Math.round(cents * 100) / 100;
}
const CURRENCY_SYMBOL = "₱";
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}
function renderSkeleton(n = 20) {
  const content = document.getElementById("content");
  let html = `<div class="grid">`;
  for (let i = 0; i < n; i++) {
    html += `
      <div class="skeleton">
        <div class="imgwrap"></div>
        <div class="body">
          <div class="bar" style="width:90%"></div>
          <div class="bar" style="width:60%"></div>
          <div class="bar" style="width:40%"></div>
        </div>
      </div>
    `;
  }
  html += `</div>`;
  content.innerHTML = html;
}
function cardHtml(g, sym) {
  const img = g.large_capsule_image || g.header_image || g.small_capsule_image || "";
  const finalIsFree = g.final_price === 0;
  return `
    <a
      class="card"
      href="https://store.steampowered.com/app/${g.id}"
      target="_blank"
      rel="noopener"
    >
      <div class="imgwrap">
 
        <img
          src="${escapeHtml(img)}"
          alt="${escapeHtml(g.name)}"
          loading="lazy"
        />
 
        <div class="badge">
          -${g.discount_percent}%
        </div>
 
      </div>
 
      <div class="body">
 
        <div class="title">
          ${escapeHtml(g.name)}
        </div>
        
        <div class="priceline">
 
          <span class="orig">
            ${money(g.original_price, sym)}
          </span>
 
          <span class="final ${finalIsFree ? "free" : ""}">
            ${money(g.final_price, sym)}
          </span>
 
        </div>
 
        <div class="meter">
          <i
            style="width:${Math.min(g.discount_percent, 100)}%"
          ></i>
        </div>
 
      </div>
    </a>
  `;
}

/*
 * Fetch from our Node backend.
 *
 * Browser:
 *
 * /api/steam
 *
 * Node:
 *
 * Steam
 */
async function fetchDeals({
  cc,
  page = 1,
  sort = "discount",
  search = ""
}) {
  const params = new URLSearchParams({
    cc,
    page: String(page),
    sort,
    search
  });
  const response = await fetch(`/api/steam?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.message || data.error);
  }
  return data;
}

/*
 * Render exactly what the backend sent.
 *
 * IMPORTANT:
 * We do NOT filter or sort here.
 *
 * The server handles:
 * - search
 * - sorting
 * - pagination
 */
function renderGrid() {
  const sym = CURRENCY_SYMBOL;
  const content = document.getElementById("content");
  if (!allDeals.length) {
    content.innerHTML = `
      <div class="state">
        No titles match your search.
      </div>
    `;
    return;
  }
  content.innerHTML = `
    <div class="grid">
      ${allDeals.map(g => cardHtml(g, sym)).join("")}
    </div>
  `;
}

/*
 * Main AJAX loader.
 */
async function load(page = 1) {
  const cc = "ph";
  const sort = document.getElementById("sortSelect").value;
  const search = document.getElementById("searchBox").value.trim();
  currentPage = page;
  renderSkeleton();
  try {
    const data = await fetchDeals({
      cc,
      page,
      sort,
      search
    });

    /*
     * Backend response:
     *
     * {
     *   page,
     *   per_page,
     *   total,
     *   total_pages,
     *   deals
     * }
     */

    allDeals = data.deals || [];
    console.log("STEAM API RESPONSE:", data);
    console.log("DEALS:", allDeals);
    console.log("DEAL COUNT:", allDeals.length);
    totalDeals = Number(data.total) || 0;
    totalPages = Number(data.total_pages) || Math.ceil(totalDeals / PER_PAGE);
    currentPage = Number(data.page) || page;
    renderGrid();
    renderPagination();
    document.getElementById("countPill").innerHTML = `
      <b>${totalDeals.toLocaleString()}</b>
      deals
    `;
  } catch (err) {
    console.error("Steam feed error:", err);
    allDeals = [];
    document.getElementById("content").innerHTML = `
      <div class="state error">
 
        Steam feed unavailable.
 
        <br>
 
        <button
          class="retry-btn"
          onclick="load(${currentPage})"
        >
          Retry
        </button>
 
      </div>
    `;
    document.getElementById("countPill").innerHTML = `<b>0</b> deals`;
  }
}

/*
 * AJAX pagination.
 */
function renderPagination() {
  const content = document.getElementById("content");

  /*
   * Remove old pagination.
   */
  const old = document.getElementById("pagination");
  if (old) {
    old.remove();
  }
  if (totalPages <= 1) {
    return;
  }
  const pagination = document.createElement("div");
  pagination.id = "pagination";
  pagination.style.cssText = `
    display:flex;
    justify-content:center;
    align-items:center;
    gap:6px;
    margin-top:28px;
    padding:10px 0;
    flex-wrap:wrap;
  `;
  function addButton(label, page, disabled = false, active = false) {
    const button = document.createElement("button");
    button.textContent = label;
    button.disabled = disabled;
    button.style.cssText = `
      background:${active ? "var(--red)" : disabled ? "var(--bg-raised)" : "var(--card)"};
 
      border:1px solid ${active ? "var(--red)" : "var(--line)"};
 
      color:${active ? "#fff" : disabled ? "var(--text-dim)" : "var(--text)"};
 
      padding:8px 12px;
 
      border-radius:5px;
 
      font-family:'JetBrains Mono', monospace;
 
      font-size:12px;
 
      cursor:${disabled ? "default" : "pointer"};
 
      transition:
        background .15s ease,
        border-color .15s ease;
    `;
    if (!disabled) {
      button.addEventListener("click", () => {
        load(page);
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      });
    }
    pagination.appendChild(button);
  }

  /*
   * Previous
   */
  addButton("← Prev", currentPage - 1, currentPage === 1);

  /*
   * Calculate visible page numbers.
   */
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, currentPage + 2);

  /*
   * Always show page 1.
   */
  if (start > 1) {
    addButton("1", 1, false, currentPage === 1);
    if (start > 2) {
      const dots = document.createElement("span");
      dots.textContent = "…";
      dots.style.cssText = `
        color:var(--text-dim);
        padding:0 4px;
      `;
      pagination.appendChild(dots);
    }
  }

  /*
   * Main page numbers.
   */
  for (let page = start; page <= end; page++) {
    addButton(String(page), page, false, page === currentPage);
  }

  /*
   * Always show last page.
   */
  if (end < totalPages) {
    if (end < totalPages - 1) {
      const dots = document.createElement("span");
      dots.textContent = "…";
      dots.style.cssText = `
        color:var(--text-dim);
        padding:0 4px;
      `;
      pagination.appendChild(dots);
    }
    addButton(String(totalPages), totalPages, false, currentPage === totalPages);
  }

  /*
   * Next
   */
  addButton("Next →", currentPage + 1, currentPage === totalPages);
  content.appendChild(pagination);
}

/*
 * Sort change.
 *
 * Immediately reload page 1.
 */
document.getElementById("sortSelect").addEventListener("change", () => {
  load(1);
});

/*
 * Search.
 *
 * AJAX after 350ms.
 */
let searchTimer;
document.getElementById("searchBox").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    load(1);
  }, 350);
});

/*
 * Initial load.
 */
load(1);
