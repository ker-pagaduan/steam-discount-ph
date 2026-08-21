function money(cents, currencySymbol) {
  if (cents === 0) return "FREE";
  return currencySymbol + (Math.round(cents) / 100).toFixed(2);
}
function escapeHtml(str) {
  const contentHTML = document.createElement("div");
  contentHTML.textContent = str ?? "";
  return contentHTML.innerHTML;
}
function cardHtml(game, priceSymbol) {
  const img = game.large_capsule_image || game.header_image || game.small_capsule_image || "";
  const finalIsFree = game.final_price === 0;
  return `
    <a
      class="card"
      href="https://store.steampowered.com/app/${game.id}"
      target="_blank"
      rel="noopener"
    >
      <div class="imgwrap">
 
        <img
          src="${escapeHtml(img)}"
          alt="${escapeHtml(game.name)}"
          loading="lazy"
        />
 
        <div class="badge">
          -${game.discount_percent}%
        </div>
 
      </div>
 
      <div class="body">
 
        <div class="title">
          ${escapeHtml(game.name)}
        </div>
        <div class="review">
          ${escapeHtml(game.review_rating)}
        </div>
        <div class="priceline">
 
          <span class="orig">
            ${money(game.original_price, priceSymbol)}
          </span>
 
          <span class="final ${finalIsFree ? "free" : ""}">
            ${money(game.final_price, priceSymbol)}
          </span>
 
        </div>
 
        <div class="meter">
          <i
            style="width:${Math.min(game.discount_percent, 100)}%"
          ></i>
        </div>
 
      </div>
    </a>
  `;
}
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
const CURRENCY_SYMBOL = "₱";
let allDeals = [];
function renderGrid() {
  const sym = CURRENCY_SYMBOL;
  const content = document.getElementById("content");
  if (!allDeals.length) {
    content.innerHTML = `
      <div class="state">
        No titles match your search or is not on sale.
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
function loadingCards(n = 20) {
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
const PER_PAGE = 20;
let currentPage = 1;
let totalPages = 1;
let totalDeals = 0;
async function load(page = 1) {
  const cc = "ph";
  const sort = document.getElementById("sortSelect").value;
  const search = document.getElementById("searchBox").value.trim();
  currentPage = page;
  loadingCards();
  try {
    const data = await fetchDeals({
      cc,
      page,
      sort,
      search
    });
    allDeals = data.deals ?? [];
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
function renderPagination() {
  const content = document.getElementById("content");
  const oldPagination = document.getElementById("pagination");
  if (oldPagination) {
    oldPagination.remove();
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
      background:${active ? "var(--active-button)" : disabled ? "var(--bg-raised)" : "var(--card)"};
 
      border:1px solid ${active ? "var(--active-line)" : "var(--line)"};
 
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
  addButton("← Prev", currentPage - 1, currentPage === 1);
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
  for (let page = start; page <= end; page++) {
    addButton(String(page), page, false, page === currentPage);
  }
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
  addButton("Next →", currentPage + 1, currentPage === totalPages);
  content.appendChild(pagination);
}
document.getElementById("sortSelect").addEventListener("change", () => {
  load(1);
});
let searchTimer;
document.getElementById("searchBox").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    load(1);
  }, 350);
});
load(1);
