/* ==========================================================================
   LIAD — חנות | דף הקטלוג
   סינון, מיון, חיפוש והוספה לעגלה.
   ========================================================================== */

import {
  $, $$, html, esc, money,
  loadCatalog, getCart, addToCart, availableStock, toast,
} from "./store.js";
import { initCartDrawer, updateCartCount } from "./cart-ui.js";
import { initShared } from "./shared.js";
import { productCard, CATEGORY_LABELS } from "./product-card.js";

const PAGE_SIZE = 24;

const state = {
  all: [],
  filtered: [],
  shown: PAGE_SIZE,
  categories: new Set(),
  brands: new Set(),
  inStockOnly: false,
  search: "",
  sort: "featured",
};

/* ---------------------------------------------------------------- אתחול */

async function init() {
  initShared();
  initCartDrawer();
  updateCartCount();

  const products = await loadCatalog();
  const grid = $("#productGrid");

  if (!products) {
    grid.innerHTML = `
      <div class="empty-state">
        <strong>הקטלוג לא נטען</strong>
        צריך להריץ את הדף דרך שרת מקומי (Live Server ב-VS Code), ולא לפתוח את הקובץ ישירות.
      </div>`;
    $("#resultsCount").textContent = "";
    return;
  }

  state.all = products;
  buildFilterOptions();
  wireControls();

  const initialCategory = new URLSearchParams(location.search).get("category");
  if (initialCategory) {
    state.categories.add(initialCategory);
    const box = $(`#categoryFilters input[value="${initialCategory}"]`);
    if (box) box.checked = true;
  }

  applyFilters();
}

/* ---------------------------------------------------------------- סינון */

function buildFilterOptions() {
  const catCounts = new Map();
  const brandCounts = new Map();

  state.all.forEach((p) => {
    catCounts.set(p.category, (catCounts.get(p.category) || 0) + 1);
    brandCounts.set(p.brand, (brandCounts.get(p.brand) || 0) + 1);
  });

  const catBox = $("#categoryFilters");
  [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      catBox.append(html`
        <label class="filter-option">
          <input type="checkbox" name="category" value="${esc(cat)}">
          <span>${esc(CATEGORY_LABELS[cat] || cat)}</span>
          <span class="filter-option__count">${count}</span>
        </label>
      `);
    });

  const brandBox = $("#brandFilters");
  [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([brand, count]) => {
      brandBox.append(html`
        <label class="filter-option">
          <input type="checkbox" name="brand" value="${esc(brand)}">
          <span>${esc(brand)}</span>
          <span class="filter-option__count">${count}</span>
        </label>
      `);
    });
}

function wireControls() {
  $("#categoryFilters").addEventListener("change", (e) => {
    toggleSet(state.categories, e.target.value, e.target.checked);
    applyFilters();
  });

  $("#brandFilters").addEventListener("change", (e) => {
    toggleSet(state.brands, e.target.value, e.target.checked);
    applyFilters();
  });

  $("#inStockOnly").addEventListener("change", (e) => {
    state.inStockOnly = e.target.checked;
    applyFilters();
  });

  let searchTimer;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim().toLowerCase();
      applyFilters();
    }, 200);
  });

  $("#sortSelect").addEventListener("change", (e) => {
    state.sort = e.target.value;
    applyFilters();
  });

  $("#filterReset").addEventListener("click", resetFilters);

  $("#loadMore").addEventListener("click", () => {
    state.shown += PAGE_SIZE;
    renderGrid();
  });

  // פתיחת הסינון במובייל
  const toggle = $("#filtersToggle");
  toggle?.addEventListener("click", () => {
    const panel = $("#filtersPanel");
    const open = panel.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  // קיצורי דרך מהתפריט
  $$("[data-filter-shortcut]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      resetFilters();
      const cat = link.dataset.filterShortcut;
      if (cat && cat !== "all") {
        state.categories.add(cat);
        const box = $(`#categoryFilters input[value="${cat}"]`);
        if (box) box.checked = true;
      }
      applyFilters();
      $(".shop-layout").scrollIntoView({ behavior: "smooth", block: "start" });
      $("#navMobile")?.classList.remove("is-open");
      document.body.style.overflow = "";
    });
  });
}

function toggleSet(set, value, on) {
  on ? set.add(value) : set.delete(value);
}

function resetFilters() {
  state.categories.clear();
  state.brands.clear();
  state.inStockOnly = false;
  state.search = "";
  state.sort = "featured";
  $$('#filtersPanel input[type="checkbox"]').forEach((c) => (c.checked = false));
  $("#searchInput").value = "";
  $("#sortSelect").value = "featured";
  applyFilters();
}

function applyFilters() {
  let list = state.all;

  if (state.categories.size) list = list.filter((p) => state.categories.has(p.category));
  if (state.brands.size) list = list.filter((p) => state.brands.has(p.brand));
  if (state.inStockOnly) list = list.filter((p) => (p.stock ?? 0) > 0);

  if (state.search) {
    const q = state.search;
    list = list.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      (p.shade || "").toLowerCase().includes(q)
    );
  }

  const sorters = {
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    "name": (a, b) => a.title.localeCompare(b.title, "he"),
    // מומלץ: קודם מה שבמלאי, ואז לפי מותג ושם
    "featured": (a, b) =>
      (b.stock > 0) - (a.stock > 0) ||
      a.brand.localeCompare(b.brand) ||
      a.title.localeCompare(b.title, "he"),
  };

  state.filtered = [...list].sort(sorters[state.sort] || sorters.featured);
  state.shown = PAGE_SIZE;
  renderGrid();
  updateCategoryCardState();
}

function updateCategoryCardState() {
  $$('.category-card').forEach((card) => {
    const cat = card.dataset.filterShortcut;
    const isActive = cat === "all"
      ? state.categories.size === 0 && !state.brands.size && !state.inStockOnly && !state.search && state.sort === "featured"
      : state.categories.has(cat);
    card.classList.toggle("is-active", isActive);
  });
}

/* ---------------------------------------------------------------- תצוגה */

function renderGrid() {
  const grid = $("#productGrid");
  const list = state.filtered.slice(0, state.shown);
  const cart = getCart();

  $("#resultsCount").textContent = state.filtered.length
    ? `${state.filtered.length} מוצרים`
    : "";

  if (!state.filtered.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <strong>לא נמצאו מוצרים</strong>
        נסו לשנות את הסינון או את מילת החיפוש.
      </div>`;
    $("#loadMore").hidden = true;
    return;
  }

  grid.innerHTML = "";
  list.forEach((p) => grid.append(productCard(p, cart)));

  $("#loadMore").hidden = state.shown >= state.filtered.length;
}

/* ---------------------------------------------------------------- הוספה לסל */

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".card__add");
  if (!btn) return;

  const id = btn.closest(".card")?.dataset.id;
  const product = state.all.find((p) => p.id === id);
  if (!product) return;

  const result = addToCart(product, 1);
  if (!result.ok) {
    toast("אין יותר מלאי מהמוצר הזה", "info");
    return;
  }

  btn.textContent = "נוסף ✓";
  btn.classList.add("is-added");
  toast(`${product.title} נוסף לעגלה`, "cart");
  document.dispatchEvent(new CustomEvent("cart:added"));

  setTimeout(() => renderGrid(), 900);
});

document.addEventListener("DOMContentLoaded", init);
