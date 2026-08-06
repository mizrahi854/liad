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
import { listCategories, ADMIN_EVENT } from "./admin-store.js";
import { initMotion, refreshMotion } from "./motion.js";

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
  const heroCount = $("#heroCount");
  if (heroCount) heroCount.textContent = products.length;

  buildFilterOptions();
  buildCategoryRail();
  wireControls();

  // עריכה במערכת הניהול (שם קטגוריה, הסתרה, מלאי) משתקפת מיד בחנות
  document.addEventListener(ADMIN_EVENT, () => {
    loadCatalog().then((fresh) => {
      if (!fresh) return;
      state.all = fresh;
      buildCategoryRail();
      applyFilters();
    });
  });

  const initialCategory = new URLSearchParams(location.search).get("category");
  if (initialCategory) {
    state.categories.add(initialCategory);
    const box = $(`#categoryFilters input[value="${initialCategory}"]`);
    if (box) box.checked = true;
  }

  applyFilters();

  // התוכן כבר על הדף — עכשיו אפשר למדוד ולהפעיל את התנועה
  initMotion();
}

/* ---------------------------------------------------------------- סינון */

function buildFilterOptions() {
  const brandCounts = new Map();
  state.all.forEach((p) => brandCounts.set(p.brand, (brandCounts.get(p.brand) || 0) + 1));

  // הקטגוריות מגיעות דרך שכבת הניהול, כדי שהשם והסדר יהיו זהים לכל מקום באתר
  const catBox = $("#categoryFilters");
  catBox.innerHTML = "";
  listCategories(state.all, CATEGORY_LABELS)
    .filter((c) => !c.hidden)
    .forEach((c) => {
      catBox.append(html`
        <label class="filter-option">
          <input type="checkbox" name="category" value="${esc(c.slug)}">
          <span>${esc(c.label)}</span>
          <span class="filter-option__count">${c.count}</span>
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

/* ---------------------------------------------------------------- ניווט קטגוריות */

/*
 * ריבועי הקטגוריות בראש החנות. הם נבנים מהקטלוג עצמו — כך אף פעם לא
 * תופיע קטגוריה ריקה — ומכבדים את מה שהוגדר במערכת הניהול: שם התצוגה,
 * הסדר, ואילו קטגוריות מוסתרות מהתפריט.
 *
 * התמונה של כל ריבוע היא הצילום של המוצר הראשון בקטגוריה. אין כאן
 * נכס חדש לתחזק, והריבוע תמיד מייצג משהו שבאמת קיים במלאי.
 */
function buildCategoryRail() {
  const rail = $("#categoryRail");
  if (!rail) return;

  const cats = listCategories(state.all, CATEGORY_LABELS).filter((c) => !c.hidden);
  const cover = (slug) => state.all.find((p) => p.category === slug && p.image)?.image ?? "";

  /*
   * "כל המוצרים" מקבל פסיפס של ארבעה צילומים מקטגוריות שונות, במקום
   * ריבוע ריק. זה מייצג בדיוק את מה שהוא מבטיח — את כל החנות — ולא
   * דורש נכס חדש לתחזוקה.
   */
  const mosaic = cats.slice(0, 4).map((c) => cover(c.slug)).filter(Boolean);

  rail.innerHTML = "";
  rail.append(html`
    <a class="category-card category-card--all" href="#" data-filter-shortcut="all"
       data-reveal="up" data-tilt="4">
      <span class="category-card__media category-card__media--mosaic">
        ${mosaic.length === 4
          ? mosaic.map((src) => `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`).join("")
          : '<span class="category-card__blank"></span>'}
      </span>
      <span class="category-card__body">
        <span class="category-card__title">כל המוצרים</span>
        <span class="category-card__count">${state.all.length}</span>
      </span>
    </a>`);

  cats.forEach((c) => {
    rail.append(html`
      <a class="category-card" href="index.html?category=${encodeURIComponent(c.slug)}"
         data-filter-shortcut="${esc(c.slug)}" data-reveal="up" data-tilt="4">
        <span class="category-card__media">
          <img src="${esc(cover(c.slug))}" alt="" loading="lazy" decoding="async" width="300" height="300">
        </span>
        <span class="category-card__body">
          <span class="category-card__title">${esc(c.label)}</span>
          <span class="category-card__count">${c.count}</span>
        </span>
      </a>`);
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

  // חצי ניווט הקטגוריות — ב-RTL הכיוונים הפוכים
  const rail = $("#categoryRail");
  if (rail) {
    const step = () => rail.clientWidth * 0.7;
    $("[data-rail-prev]")?.addEventListener("click", () => rail.scrollBy({ left: step(), behavior: "smooth" }));
    $("[data-rail-next]")?.addEventListener("click", () => rail.scrollBy({ left: -step(), behavior: "smooth" }));
  }

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

  // הכרטיסים נוצרו עכשיו — מכניסים אותם למנוע התנועה
  refreshMotion(grid);

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
