/* ==========================================================================
   LIAD — מערכת ניהול

   מסך בחירה ראשי → שני עולמות:
     • ניהול החנות   — מוצרים, מלאי, גוונים, קטגוריות, קופונים, הזמנות, לידים
     • ניהול דף הבית — טקסטים, תמונות, סדר סקשנים, מוצרים מוצגים, באנרים, פופאפים

   כל הכתיבה עוברת דרך js/admin-store.js, שהוא נקודת האמת היחידה.
   אחרי כל שמירה משודר ADMIN_EVENT, וכל טאב פתוח של האתר מתעדכן מיד.

   תוכן עניינים:
   01. עזרים — DOM, קבצים, מודאל
   02. ניתוב בין המסכים
   03. חנות | מוצרים
   04. חנות | קטגוריות
   05. חנות | קופונים
   06. חנות | הזמנות
   07. חנות | לידים
   08. דף הבית | טקסטים ותמונות
   09. דף הבית | סדר סקשנים
   10. דף הבית | מוצרים מוצגים
   11. דף הבית | באנרים
   12. דף הבית | הודעות קופצות
   13. פרסום, גיבוי ואיפוס
   14. הפעלה
   ========================================================================== */

import { $, $$, html, esc, money, CONFIG, loadCatalog, toast } from "./store.js";
import { initAccessibility } from "./accessibility.js";
import { CATEGORY_LABELS } from "./product-card.js";
import {
  ADMIN_EVENT, MAX_ACTIVE_POPUPS,
  applyCatalogPatch, getCatalogPatch, saveProduct, addProduct, deleteProduct,
  restoreProduct, resetCatalog, exportCatalog,
  getCategoryMeta, saveCategory, resetCategory, listCategories,
  getCoupons, saveCoupon, deleteCoupon,
  getHomepagePatch, saveHomepage, resetHomepage,
  getPopups, savePopup, deletePopup,
  getLeads, loadLeads, deleteLead,
  getOrders, setOrderStatus, clearOrders, orderStatusMeta, ORDER_STATUSES, ORDER_CANCELLED,
  exportAll, importAll,
} from "./admin-store.js";
import { openInvoice, downloadInvoice, sendInvoice } from "./invoice.js";
import { initSync, pull, syncStatus, SYNC_STATUS_EVENT } from "./sync.js";
import { signIn, signOut, isSignedIn, currentUser, ensureSession } from "./supabase.js";
import { hasBackend } from "./config.js";
import { HOME_TEXT_GROUPS, HOME_IMAGES, HOME_SECTIONS, MAX_BANNERS } from "./home-schema.js";

/** כמה שורות להציג בטבלת המוצרים בכל פעם */
const PAGE = 40;

/** גודל מרבי לתמונה שמועלית — מעבר לזה מכסת האחסון של הדפדפן נגמרת */
const MAX_IMAGE_PX = 1400;

const state = {
  screen: "home",      // home | shop | homepage
  panel: "products",
  base: [],            // הקטלוג מהקובץ, בלי שינויי הניהול
  products: [],        // הקטלוג אחרי שינויי הניהול
  shown: PAGE,
  filters: { search: "", category: "", shade: "", stock: "" },
};


/* ==========================================================================
   01. עזרים
   ========================================================================== */

function download(filename, content, type = "application/json") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

/**
 * קורא תמונה שהמשתמשת בחרה, מקטין אותה ומחזיר data URL.
 *
 * ההקטנה חיונית: התמונות נשמרות ב-localStorage, שמוגבל לכמה מגה־בייט.
 * צילום ישר מהטלפון היה ממלא את המכסה בתמונה אחת.
 */
function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("זה לא קובץ תמונה"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("לא הצלחתי לקרוא את הקובץ"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("הקובץ אינו תמונה תקינה"));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------------- מודאל */

let modalSubmit = null;

function openModal(title, bodyHTML, { onSave, saveLabel = "שמירה", extra = "" } = {}) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHTML;
  $("#modalFoot").innerHTML =
    `${extra}<button class="btn btn--outline btn--sm" data-modal-cancel type="button">ביטול</button>` +
    (onSave ? `<button class="btn btn--gold btn--sm" data-modal-save type="button">${esc(saveLabel)}</button>` : "");
  modalSubmit = onSave ?? null;
  $("#adminModal").hidden = false;
  document.body.style.overflow = "hidden";
  $("#modalBody").querySelector("input, textarea, select")?.focus();
}

function closeModal() {
  $("#adminModal").hidden = true;
  document.body.style.overflow = "";
  modalSubmit = null;
}

function wireModal() {
  $("#modalClose").addEventListener("click", closeModal);
  $("#adminModal").addEventListener("click", (e) => {
    if (e.target.id === "adminModal") closeModal();
  });
  $("#modalFoot").addEventListener("click", (e) => {
    if (e.target.closest("[data-modal-cancel]")) closeModal();
    if (e.target.closest("[data-modal-save]")) {
      try {
        if (modalSubmit?.() !== false) closeModal();
      } catch (err) {
        toast(err.message || "השמירה נכשלה", "info");
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#adminModal").hidden) closeModal();
  });
}

/* ---------------------------------------------------------------- טפסים */

function field(label, name, value = "", { type = "text", hint = "", ...attrs } = {}) {
  const extras = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  const control = type === "textarea"
    ? `<textarea class="admin-textarea" name="${esc(name)}" ${extras}>${esc(value)}</textarea>`
    : `<input class="admin-input" type="${esc(type)}" name="${esc(name)}" value="${esc(value)}" ${extras}>`;
  return `
    <label class="admin-field">
      <span class="admin-field__label">${esc(label)}</span>
      ${control}
      ${hint ? `<span class="admin-field__label" style="margin-top:.25rem">${esc(hint)}</span>` : ""}
    </label>`;
}

function select(label, name, value, options) {
  return `
    <label class="admin-field">
      <span class="admin-field__label">${esc(label)}</span>
      <select class="admin-select" name="${esc(name)}">
        ${options.map(([v, t]) =>
          `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(t)}</option>`).join("")}
      </select>
    </label>`;
}

function checkbox(label, name, checked) {
  return `<label class="admin-check"><input type="checkbox" name="${esc(name)}"${checked ? " checked" : ""}><span>${esc(label)}</span></label>`;
}

/** אוסף את ערכי הטופס שבתוך המודאל */
function formValues() {
  const out = {};
  $$("#modalBody [name]").forEach((el) => {
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  });
  return out;
}


/* ==========================================================================
   01ב. התחברות ומצב הסנכרון

   בלי מסד נתונים מחובר, הניהול עובד כמו קודם — מקומית, בלי התחברות.
   כשיש מסד, ההרשאות נאכפות בשרת (RLS): בלי התחברות אפשר רק לקרוא,
   ולכן כל ניסיון לשמור ייכשל. עדיף לומר את זה מראש מאשר לתת ללקוחה
   לערוך עשר דקות ואז לגלות שכלום לא נשמר.
   ========================================================================== */

function paintSyncStatus() {
  const box = $("#syncStatus");
  if (!box) return;

  if (!hasBackend()) {
    box.innerHTML = `<span class="sync-dot sync-dot--local"></span>שמירה מקומית בלבד`;
    box.title = "כדי לסנכרן בין מכשירים יש למלא את liad-shop/js/config.js";
    return;
  }

  const { online, error, pushing } = syncStatus();

  if (!isSignedIn()) {
    box.innerHTML = `<span class="sync-dot sync-dot--warn"></span>לא מחוברת — לצפייה בלבד`;
  } else if (error || !online) {
    box.innerHTML = `<span class="sync-dot sync-dot--warn"></span>אין חיבור לשרת`;
    box.title = error ?? "";
  } else {
    box.innerHTML = `<span class="sync-dot sync-dot--ok"></span>${pushing ? "שומר…" : "מסונכרן"}`;
    box.title = "";
  }
}

function wireAuth() {
  const button = $("#authButton");
  if (!button) return;

  const paint = () => {
    button.hidden = !hasBackend();
    button.textContent = isSignedIn() ? "יציאה" : "התחברות";
  };
  paint();

  button.addEventListener("click", async () => {
    if (isSignedIn()) {
      if (!confirm("לצאת מהמערכת?")) return;
      await signOut();
      paint();
      paintSyncStatus();
      toast("יצאת מהמערכת");
      return;
    }
    loginDialog(() => { paint(); paintSyncStatus(); });
  });
}

function loginDialog(onDone) {
  openModal("התחברות לניהול", `
    <div class="admin-grid">
      <p class="muted" style="font-size:.875rem;line-height:1.6">
        זו ההתחברות שיצרת ב-Supabase. בלעדיה אפשר רק לצפות — כל שמירה תיחסם.
      </p>
      ${field("אימייל", "email", "", { type: "email", autocomplete: "username" })}
      ${field("סיסמה", "password", "", { type: "password", autocomplete: "current-password" })}
      <p class="form-status" id="loginError" role="status" aria-live="polite"></p>
    </div>`, {
    saveLabel: "התחברות",
    onSave() {
      const { email, password } = formValues();
      const error = $("#loginError");

      // הכניסה אסינכרונית, ולכן סוגרים את המודאל רק אחרי שהיא הצליחה
      signIn(email.trim(), password)
        .then(async () => {
          closeModal();
          await initSync();
          await loadLeads().catch(() => {});
          onDone?.();
          refresh();
          toast("התחברת. השינויים יסונכרנו לכל המכשירים.");
        })
        .catch((err) => {
          error.dataset.state = "error";
          error.textContent = err.message;
        });

      return false;   // המודאל נסגר בעצמו בהצלחה
    },
  });
}


/* ==========================================================================
   02. ניתוב בין המסכים
   ========================================================================== */

const SHOP_PANELS = [
  { id: "products",   label: "מוצרים",   render: renderProducts },
  { id: "categories", label: "קטגוריות", render: renderCategories },
  { id: "coupons",    label: "קופונים",  render: renderCoupons },
  { id: "orders",     label: "הזמנות",   render: renderOrders },
  { id: "leads",      label: "לידים",    render: renderLeads },
];

const HOME_PANELS = [
  { id: "texts",    label: "טקסטים",       render: renderTexts },
  { id: "images",   label: "תמונות",       render: renderImages },
  { id: "sections", label: "סדר הסקשנים",  render: renderSections },
  { id: "featured", label: "מוצרים מוצגים", render: renderFeatured },
  { id: "banners",  label: "באנרים",       render: renderBanners },
  { id: "popups",   label: "הודעות קופצות", render: renderPopups },
];

const panels = () => (state.screen === "shop" ? SHOP_PANELS : HOME_PANELS);

function go(screen, panel) {
  state.screen = screen;
  state.panel = panel || panels()[0].id;
  location.hash = screen === "home" ? "" : `#${screen}/${state.panel}`;
  draw();
}

function readHash() {
  const [screen, panel] = location.hash.replace(/^#/, "").split("/");
  if (screen === "shop" || screen === "homepage") {
    state.screen = screen;
    state.panel = panels().some((p) => p.id === panel) ? panel : panels()[0].id;
  } else {
    state.screen = "home";
  }
}

function draw() {
  const isHome = state.screen === "home";
  $("#screenHome").hidden = !isHome;
  $("#screenWork").hidden = isHome;

  $("#crumbs").innerHTML = isHome
    ? ""
    : `<button type="button" data-goto="home">מערכת ניהול</button>
       <span aria-hidden="true">›</span>
       <span>${state.screen === "shop" ? "ניהול החנות" : "ניהול דף הבית"}</span>`;

  if (isHome) return;

  const list = panels();
  $("#adminNav").innerHTML = list.map((p) => `
    <button class="admin-nav__item" type="button" data-panel="${p.id}"
            aria-current="${p.id === state.panel}">
      ${esc(p.label)}${panelCount(p.id) != null ? `<span class="admin-nav__count">${panelCount(p.id)}</span>` : ""}
    </button>`).join("");

  list.find((p) => p.id === state.panel).render();
}

function panelCount(id) {
  switch (id) {
    case "products": return state.products.length;
    case "categories": return listCategories(state.products, CATEGORY_LABELS).length;
    case "coupons": return getCoupons().length;
    case "orders": return getOrders().length;
    case "leads": return getLeads().length;
    case "popups": return getPopups().length;
    default: return null;
  }
}

/** מרענן את הקטלוג בזיכרון אחרי שינוי, ומצייר מחדש */
function refresh() {
  state.products = applyCatalogPatch(state.base);
  draw();
}


/* ==========================================================================
   03. חנות | מוצרים
   ========================================================================== */

function filteredProducts() {
  const { search, category, shade, stock } = state.filters;
  let list = state.products;

  if (category) list = list.filter((p) => p.category === category);
  if (shade) list = list.filter((p) => (p.shade ?? "") === shade);
  if (stock === "out") list = list.filter((p) => (p.stock ?? 0) === 0);
  if (stock === "low") list = list.filter((p) => (p.stock ?? 0) > 0 && p.stock <= 3);
  if (stock === "in") list = list.filter((p) => (p.stock ?? 0) > 0);

  if (search) {
    const q = search.toLowerCase();
    list = list.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.brand ?? "").toLowerCase().includes(q) ||
      (p.shade ?? "").toLowerCase().includes(q) ||
      (p.line ?? "").toLowerCase().includes(q));
  }
  return list;
}

function renderProducts() {
  const cats = listCategories(state.products, CATEGORY_LABELS);
  const shades = [...new Set(state.products.map((p) => p.shade).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "he", { numeric: true }));
  const removed = getCatalogPatch().removed;

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">מוצרים</h1>
        <p class="admin__subtitle">הוספה, עריכה, מלאי וגוונים. כל שינוי מופיע בחנות מיד.</p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn btn--gold btn--sm" id="addProduct" type="button">+ מוצר חדש</button>
        <button class="btn btn--outline btn--sm" id="publishCatalog" type="button">פרסום הקטלוג</button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat"><p class="stat__label">בקטלוג</p><p class="stat__value">${state.products.length}</p></div>
      <div class="stat"><p class="stat__label">אזלו</p><p class="stat__value">${state.products.filter((p) => (p.stock ?? 0) === 0).length}</p></div>
      <div class="stat"><p class="stat__label">מלאי נמוך</p><p class="stat__value">${state.products.filter((p) => (p.stock ?? 0) > 0 && p.stock <= 3).length}</p></div>
      <div class="stat"><p class="stat__label">קטגוריות</p><p class="stat__value">${cats.length}</p></div>
    </div>

    <div class="toolbar">
      <input class="admin-input" type="search" id="pSearch" placeholder="חיפוש מהיר — שם, מותג או גוון"
             value="${esc(state.filters.search)}" style="max-width:18rem" aria-label="חיפוש מוצר">
      <select class="admin-select" id="pCategory" style="max-width:12rem" aria-label="סינון לפי קטגוריה">
        <option value="">כל הקטגוריות</option>
        ${cats.map((c) => `<option value="${esc(c.slug)}"${c.slug === state.filters.category ? " selected" : ""}>${esc(c.label)} (${c.count})</option>`).join("")}
      </select>
      <select class="admin-select" id="pShade" style="max-width:10rem" aria-label="סינון לפי גוון">
        <option value="">כל הגוונים</option>
        ${shades.map((s) => `<option value="${esc(s)}"${s === state.filters.shade ? " selected" : ""}>גוון ${esc(s)}</option>`).join("")}
      </select>
      <select class="admin-select" id="pStock" style="max-width:10rem" aria-label="סינון לפי מלאי">
        <option value="">כל המלאי</option>
        <option value="in"${state.filters.stock === "in" ? " selected" : ""}>יש במלאי</option>
        <option value="low"${state.filters.stock === "low" ? " selected" : ""}>מלאי נמוך</option>
        <option value="out"${state.filters.stock === "out" ? " selected" : ""}>אזל</option>
      </select>
      <span class="toolbar__spacer"></span>
      <button class="btn btn--outline btn--sm" id="clearFilters" type="button">ניקוי סינון</button>
    </div>

    ${removed.length ? `
      <div class="notice notice--danger">
        ${removed.length} מוצרים מוסתרים מהחנות.
        <button class="btn btn--outline btn--sm" id="restoreAll" type="button" style="margin-inline-start:.5rem">החזרת כולם</button>
      </div>` : ""}

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th style="width:3.5rem"></th>
            <th>מוצר</th>
            <th style="width:6rem">מותג</th>
            <th style="width:8rem">קטגוריה</th>
            <th style="width:5rem">גוון</th>
            <th style="width:6rem">מחיר</th>
            <th style="width:6rem">מלאי</th>
            <th style="width:6rem"></th>
          </tr>
        </thead>
        <tbody id="pBody"></tbody>
      </table>
    </div>

    <div style="margin-top:1rem;text-align:center">
      <button class="btn btn--outline btn--sm" id="pMore" type="button" hidden>הצגת עוד</button>
    </div>`;

  drawProductRows();
  wireProductControls();
}

function drawProductRows() {
  const list = filteredProducts();
  const body = $("#pBody");

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8" class="admin-table__empty">לא נמצאו מוצרים</td></tr>`;
    $("#pMore").hidden = true;
    return;
  }

  const added = new Set(getCatalogPatch().added.map((p) => p.id));
  body.innerHTML = "";

  list.slice(0, state.shown).forEach((p) => {
    const out = (p.stock ?? 0) === 0;
    body.append(html`
      <tr data-id="${esc(p.id)}">
        <td><img class="thumb" src="${esc(p.image)}" alt="" loading="lazy"></td>
        <td>
          <span class="row-title">${esc(p.title)}</span>
          ${added.has(p.id) ? '<span class="pill pill--new">חדש</span>' : ""}
        </td>
        <td class="muted nowrap">${esc(p.brand)}</td>
        <td class="muted nowrap">${esc(CATEGORY_LABELS[p.category] || p.category)}</td>
        <td class="num">${esc(p.shade ?? "—")}</td>
        <td class="num nowrap">${money(p.price)}</td>
        <td>
          <input class="admin-input admin-input--sm${out ? " admin-input--zero" : ""}"
                 type="number" min="0" value="${p.stock ?? 0}" data-stock aria-label="מלאי">
        </td>
        <td>
          <div class="row-actions">
            <button class="icon-action" type="button" data-edit aria-label="עריכה" title="עריכה">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>
              </svg>
            </button>
            <button class="icon-action icon-action--danger" type="button" data-delete aria-label="מחיקה" title="מחיקה">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>`);
  });

  $("#pMore").hidden = state.shown >= list.length;
  $("#pMore").textContent = `הצגת עוד (${list.length - state.shown} נותרו)`;
}

function wireProductControls() {
  let timer;
  $("#pSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      state.shown = PAGE;
      drawProductRows();
    }, 180);
  });

  const bind = (id, key) => $(id).addEventListener("change", (e) => {
    state.filters[key] = e.target.value;
    state.shown = PAGE;
    drawProductRows();
  });
  bind("#pCategory", "category");
  bind("#pShade", "shade");
  bind("#pStock", "stock");

  $("#clearFilters").addEventListener("click", () => {
    state.filters = { search: "", category: "", shade: "", stock: "" };
    state.shown = PAGE;
    renderProducts();
  });

  $("#pMore").addEventListener("click", () => {
    state.shown += PAGE;
    drawProductRows();
  });

  $("#addProduct").addEventListener("click", () => productForm(null));

  $("#publishCatalog").addEventListener("click", () => {
    download("products.json", exportCatalog(state.base));
    toast("הקובץ ירד. יש להחליף אותו ב-liad-shop/data/products.json");
  });

  $("#restoreAll")?.addEventListener("click", () => {
    getCatalogPatch().removed.forEach(restoreProduct);
    toast("המוצרים הוחזרו");
  });

  // עדכון מלאי ישירות בטבלה — הפעולה הכי שכיחה, ולכן בלי מודאל
  $("#pBody").addEventListener("change", (e) => {
    const input = e.target.closest("[data-stock]");
    if (!input) return;
    const id = input.closest("tr").dataset.id;
    const value = Math.max(0, parseInt(input.value, 10) || 0);
    saveProduct(id, { stock: value });
    input.classList.toggle("admin-input--zero", value === 0);
    toast(`המלאי עודכן ל-${value}`);
  });

  $("#pBody").addEventListener("click", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const product = state.products.find((p) => p.id === row.dataset.id);
    if (!product) return;

    if (e.target.closest("[data-edit]")) productForm(product);
    if (e.target.closest("[data-delete]")) {
      if (!confirm(`להסיר את "${product.title}" מהחנות?`)) return;
      deleteProduct(product.id);
      toast("המוצר הוסר");
    }
  });
}

/** טופס מוצר. product=null פירושו מוצר חדש. */
function productForm(product) {
  const isNew = !product;
  const p = product ?? { title: "", brand: "", category: "gel-polish", shade: "", line: "", price: 0, stock: 0, description: "", image: "" };
  const cats = listCategories(state.products, CATEGORY_LABELS);

  openModal(isNew ? "מוצר חדש" : "עריכת מוצר", `
    <div class="admin-grid">
      ${field("שם המוצר", "title", p.title, { required: "required" })}
      <div class="admin-grid admin-grid--2">
        ${field("מותג", "brand", p.brand)}
        ${select("קטגוריה", "category", p.category,
          cats.map((c) => [c.slug, c.label]).concat(
            Object.entries(CATEGORY_LABELS).filter(([slug]) => !cats.some((c) => c.slug === slug))))}
      </div>
      <div class="admin-grid admin-grid--2">
        ${field("מספר גוון", "shade", p.shade ?? "", { hint: "אפשר להשאיר ריק למוצר שאינו גוון" })}
        ${field("קו מוצר", "line", p.line ?? "")}
      </div>
      <div class="admin-grid admin-grid--2">
        ${field("מחיר (₪)", "price", p.price, { type: "number", min: "0", step: "0.5" })}
        ${field("מלאי", "stock", p.stock ?? 0, { type: "number", min: "0" })}
      </div>
      ${field("תיאור", "description", p.description ?? "", { type: "textarea" })}

      <div class="admin-field">
        <span class="admin-field__label">תמונת המוצר</span>
        <div class="image-drop">
          <img class="image-drop__preview" id="imgPreview" alt="" src="${esc(p.image || "")}">
          <div class="image-drop__body">
            <input class="admin-input" type="file" id="imgFile" accept="image/*">
            <p class="image-drop__hint">אפשר גם להדביק נתיב ידני בשדה שמתחת. התמונה מוקטנת אוטומטית.</p>
            <input class="admin-input" type="text" name="image" value="${esc(p.image || "")}" style="margin-top:.5rem">
          </div>
        </div>
      </div>
    </div>`, {
    saveLabel: isNew ? "יצירת המוצר" : "שמירה",
    onSave() {
      const v = formValues();
      if (!v.title.trim()) throw new Error("צריך שם למוצר");

      const fields = {
        title: v.title.trim(),
        brand: v.brand.trim(),
        category: v.category,
        shade: v.shade.trim() || null,
        line: v.line.trim() || v.title.trim(),
        price: Math.max(0, Number(v.price) || 0),
        stock: Math.max(0, parseInt(v.stock, 10) || 0),
        description: v.description.trim(),
        image: v.image.trim(),
      };

      if (isNew) addProduct(fields);
      else saveProduct(p.id, fields);
      toast(isNew ? "המוצר נוסף" : "המוצר עודכן");
    },
  });

  $("#imgFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readImage(file);
      $("#imgPreview").src = dataUrl;
      $('#modalBody [name="image"]').value = dataUrl;
    } catch (err) {
      toast(err.message, "info");
    }
  });
}


/* ==========================================================================
   04. חנות | קטגוריות
   ========================================================================== */

function renderCategories() {
  const cats = listCategories(state.products, CATEGORY_LABELS);

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">קטגוריות</h1>
        <p class="admin__subtitle">
          הקטגוריות נגזרות מהמוצרים עצמם. כאן קובעים איך הן נקראות, באיזה
          סדר הן מופיעות בחנות, ואילו מהן מוסתרות.
        </p>
      </div>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>שם בחנות</th>
            <th style="width:9rem">מזהה</th>
            <th style="width:6rem">מוצרים</th>
            <th style="width:6rem">סדר</th>
            <th style="width:8rem">בתפריט</th>
            <th style="width:5rem"></th>
          </tr>
        </thead>
        <tbody>
          ${cats.map((c) => `
            <tr data-slug="${esc(c.slug)}">
              <td><input class="admin-input" type="text" value="${esc(c.label)}" data-label aria-label="שם הקטגוריה"></td>
              <td class="muted nowrap">${esc(c.slug)}</td>
              <td class="num">${c.count}</td>
              <td><input class="admin-input admin-input--sm" type="number" value="${c.order}" data-order aria-label="סדר"></td>
              <td>${checkbox("מוצגת", `show-${c.slug}`, !c.hidden).replace('name=', 'data-show name=')}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-action" type="button" data-reset title="חזרה לברירת מחדל" aria-label="חזרה לברירת מחדל">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  const body = $("#adminMain .admin-table tbody");

  body.addEventListener("change", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const slug = row.dataset.slug;

    if (e.target.matches("[data-label]")) saveCategory(slug, { label: e.target.value.trim() });
    if (e.target.matches("[data-order]")) saveCategory(slug, { order: parseInt(e.target.value, 10) || 500 });
    if (e.target.matches("[data-show]")) saveCategory(slug, { hidden: !e.target.checked });
    toast("הקטגוריה עודכנה");
  });

  body.addEventListener("click", (e) => {
    if (!e.target.closest("[data-reset]")) return;
    resetCategory(e.target.closest("tr").dataset.slug);
    toast("הקטגוריה חזרה לברירת המחדל");
  });
}


/* ==========================================================================
   05. חנות | קופונים
   ========================================================================== */

function renderCoupons() {
  const coupons = getCoupons();

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">קופונים</h1>
        <p class="admin__subtitle">הקוד שהלקוחה מקלידה בעמוד התשלום. שינוי כאן תקף מיד.</p>
      </div>
      <button class="btn btn--gold btn--sm" id="addCoupon" type="button">+ קופון חדש</button>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th style="width:8rem">קוד</th>
            <th style="width:8rem">הנחה</th>
            <th>תנאים</th>
            <th style="width:7rem">שימושים</th>
            <th style="width:6rem">סטטוס</th>
            <th style="width:6rem"></th>
          </tr>
        </thead>
        <tbody>
          ${coupons.length ? coupons.map((c) => `
            <tr data-code="${esc(c.code)}">
              <td><strong style="font-family:var(--font-wordmark);letter-spacing:.08em">${esc(c.code)}</strong></td>
              <td class="num">${c.type === "percent" ? `${c.value}%` : money(c.value)}</td>
              <td class="muted">
                ${c.firstOrderOnly ? "רכישה ראשונה בלבד · " : ""}
                ${c.expiresAt ? `בתוקף עד ${esc(c.expiresAt)}` : "ללא תאריך תפוגה"}
              </td>
              <td class="num">${c.used ?? 0}${c.maxUses != null ? ` / ${c.maxUses}` : ""}</td>
              <td><span class="pill ${c.active ? "pill--ok" : "pill--off"}">${c.active ? "פעיל" : "כבוי"}</span></td>
              <td>
                <div class="row-actions">
                  <button class="icon-action" type="button" data-edit aria-label="עריכה">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>
                    </svg>
                  </button>
                  <button class="icon-action icon-action--danger" type="button" data-delete aria-label="מחיקה">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>`).join("")
            : `<tr><td colspan="6" class="admin-table__empty">אין עדיין קופונים</td></tr>`}
        </tbody>
      </table>
    </div>`;

  $("#addCoupon").addEventListener("click", () => couponForm(null));

  $("#adminMain").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-code]");
    if (!row) return;
    const coupon = getCoupons().find((c) => c.code === row.dataset.code);
    if (!coupon) return;

    if (e.target.closest("[data-edit]")) couponForm(coupon);
    if (e.target.closest("[data-delete]")) {
      if (!confirm(`למחוק את הקופון ${coupon.code}?`)) return;
      deleteCoupon(coupon.code);
      toast("הקופון נמחק");
    }
  });
}

function couponForm(coupon) {
  const isNew = !coupon;
  const c = coupon ?? { code: "", type: "percent", value: 10, expiresAt: "", maxUses: "", firstOrderOnly: false, active: true, label: "" };

  openModal(isNew ? "קופון חדש" : `עריכת ${c.code}`, `
    <div class="admin-grid">
      ${field("קוד הקופון", "code", c.code, { required: "required", ...(isNew ? {} : { readonly: "readonly" }) })}
      <div class="admin-grid admin-grid--2">
        ${select("סוג ההנחה", "type", c.type, [["percent", "אחוזים"], ["fixed", "סכום קבוע בשקלים"]])}
        ${field("גובה ההנחה", "value", c.value, { type: "number", min: "0", step: "0.5" })}
      </div>
      ${field("כיתוב שיוצג ללקוחה", "label", c.label ?? "", { hint: "אפשר להשאיר ריק — ייווצר אוטומטית" })}
      <div class="admin-grid admin-grid--2">
        ${field("בתוקף עד", "expiresAt", c.expiresAt ?? "", { type: "date" })}
        ${field("מקסימום שימושים", "maxUses", c.maxUses ?? "", { type: "number", min: "1", hint: "ריק = ללא הגבלה" })}
      </div>
      <div class="admin-grid admin-grid--2">
        ${checkbox("תקף לרכישה ראשונה בלבד", "firstOrderOnly", c.firstOrderOnly)}
        ${checkbox("קופון פעיל", "active", c.active)}
      </div>
    </div>`, {
    saveLabel: isNew ? "יצירת הקופון" : "שמירה",
    onSave() {
      const v = formValues();
      const code = v.code.trim().toUpperCase();
      if (!code) throw new Error("צריך קוד לקופון");
      if (isNew && getCoupons().some((x) => x.code === code)) throw new Error("כבר קיים קופון עם הקוד הזה");

      saveCoupon({
        code,
        type: v.type,
        value: Math.max(0, Number(v.value) || 0),
        label: v.label.trim() || undefined,
        expiresAt: v.expiresAt || null,
        maxUses: v.maxUses === "" ? null : Math.max(1, parseInt(v.maxUses, 10) || 1),
        firstOrderOnly: v.firstOrderOnly,
        active: v.active,
        used: coupon?.used ?? 0,
      });
      toast(isNew ? "הקופון נוצר" : "הקופון עודכן");
    },
  });
}


/* ==========================================================================
   06. חנות | הזמנות
   ========================================================================== */

function renderOrders() {
  const orders = getOrders().slice().reverse();
  const revenue = orders.reduce((sum, o) => sum + (o.totals?.total ?? 0), 0);

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">הזמנות</h1>
        <p class="admin__subtitle">ההזמנות שבוצעו בדפדפן הזה. עד לחיבור שרת אין מאגר משותף.</p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn btn--outline btn--sm" id="exportOrders" type="button">ייצוא ל-CSV</button>
        <button class="btn btn--outline btn--sm" id="clearOrders" type="button">מחיקת הכל</button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat"><p class="stat__label">הזמנות</p><p class="stat__value">${orders.length}</p></div>
      <div class="stat"><p class="stat__label">סך מכירות</p><p class="stat__value">${money(revenue)}</p></div>
      <div class="stat"><p class="stat__label">ממוצע להזמנה</p><p class="stat__value">${money(orders.length ? revenue / orders.length : 0)}</p></div>
      <div class="stat"><p class="stat__label">פריטים</p><p class="stat__value">${orders.reduce((s, o) => s + o.items.reduce((n, i) => n + i.qty, 0), 0)}</p></div>
    </div>

    <div id="ordersList">
      ${orders.length ? orders.map(orderCard).join("")
        : `<div class="admin-card admin-table__empty">אין עדיין הזמנות</div>`}
    </div>`;

  $("#exportOrders").addEventListener("click", exportOrdersCsv);
  $("#clearOrders").addEventListener("click", async () => {
    if (!confirm("למחוק את כל ההזמנות? הפעולה בלתי הפיכה.")) return;
    try {
      await clearOrders();
      renderOrders();
      toast("ההזמנות נמחקו");
    } catch (err) {
      toast(err.message || "המחיקה נכשלה", "info");
    }
  });

  wireOrderCards();
}

function orderCard(o) {
  const address = o.shipping.method === "delivery"
    ? `${o.shipping.address.street}, ${o.shipping.address.city}`
    : `איסוף — ${o.shipping.address.pickup}`;

  const status = o.status ?? "received";
  const meta = orderStatusMeta(status);
  const options = [...ORDER_STATUSES, ORDER_CANCELLED];

  return `
    <details class="admin-card" style="margin-bottom:.625rem;padding:0" data-order="${esc(o.id)}">
      <summary style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;padding:.875rem 1.125rem;cursor:pointer">
        <span>
          <strong style="font-family:var(--font-wordmark);letter-spacing:.05em">${esc(o.id)}</strong>
          <span class="muted" style="margin-inline-start:.75rem;font-size:.8125rem">
            ${esc(o.customer.firstName)} ${esc(o.customer.lastName)} · ${new Date(o.createdAt).toLocaleDateString("he-IL")}
          </span>
        </span>
        <span style="display:flex;align-items:center;gap:.75rem">
          <span class="pill ${status === ORDER_CANCELLED.id ? "pill--off" : "pill--ok"}">${esc(meta.label)}</span>
          <strong class="num">${money(o.totals.total)}</strong>
        </span>
      </summary>

      <div style="padding:0 1.125rem 1.125rem;font-size:.875rem">

        <!-- סטטוס: מה שהלקוחה רואה בעמוד המעקב -->
        <div class="order-row" style="padding:.875rem 0;border-top:1px solid var(--border)">
          <label class="admin-field" style="max-width:16rem">
            <span class="admin-field__label">סטטוס ההזמנה</span>
            <select class="admin-select" data-status>
              ${options.map((s) =>
                `<option value="${esc(s.id)}"${s.id === status ? " selected" : ""}>${esc(s.label)}</option>`).join("")}
            </select>
          </label>
          <a class="btn btn--outline btn--sm" href="order.html?id=${encodeURIComponent(o.id)}"
             target="_blank" rel="noopener">מה שהלקוחה רואה</a>
        </div>

        <div class="muted" style="display:grid;gap:.375rem;padding:.875rem 0;border-top:1px solid var(--border)">
          <div>טלפון: <a href="tel:${esc(o.customer.phone)}" style="color:var(--foreground)">${esc(o.customer.phone)}</a></div>
          <div>אימייל: <a href="mailto:${esc(o.customer.email)}" style="color:var(--foreground)">${esc(o.customer.email)}</a></div>
          <div>${o.shipping.method === "delivery" ? "משלוח" : "איסוף"}: <span style="color:var(--foreground)">${esc(address)}</span></div>
          ${o.notes ? `<div>הערות: <span style="color:var(--foreground)">${esc(o.notes)}</span></div>` : ""}
        </div>

        <ul style="padding-top:.625rem;border-top:1px solid var(--border)">
          ${o.items.map((i) => `
            <li style="display:flex;justify-content:space-between;gap:1rem;padding:.1875rem 0">
              <span>${esc(i.title)} × ${i.qty}</span><span class="num">${money(i.lineTotal)}</span>
            </li>`).join("")}
        </ul>

        <!-- החשבונית של ההזמנה הזו, ישירות מכאן -->
        <div class="order-row" style="margin-top:.875rem;padding-top:.875rem;border-top:1px solid var(--border)">
          <button class="btn btn--gold btn--sm" type="button" data-invoice-open>פתיחת החשבונית</button>
          <button class="btn btn--outline btn--sm" type="button" data-invoice-save>הורדת PDF</button>
          <button class="btn btn--outline btn--sm" type="button" data-invoice-wa>שליחה בוואטסאפ</button>
          <button class="btn btn--outline btn--sm" type="button" data-invoice-mail>שליחה למייל</button>
        </div>
        <p class="muted" style="margin-top:.5rem;font-size:.75rem" data-invoice-hint></p>
      </div>
    </details>`;
}

/* מחבר את פקדי הסטטוס והחשבונית שבתוך כרטיסי ההזמנות */
function wireOrderCards() {
  const list = $("#ordersList");
  if (!list) return;

  list.addEventListener("change", async (e) => {
    const select = e.target.closest("[data-status]");
    if (!select) return;
    const id = select.closest("[data-order]").dataset.order;
    const label = orderStatusMeta(select.value).label;
    try {
      await setOrderStatus(id, select.value);
      renderOrders();
      toast(`הסטטוס עודכן ל"${label}"`);
    } catch (err) {
      // כמעט תמיד: אין התחברות, ולכן ה-RLS חסם את העדכון
      renderOrders();
      toast(err.message || "עדכון הסטטוס נכשל. ייתכן שצריך להתחבר.", "info");
    }
  });

  list.addEventListener("click", async (e) => {
    const card = e.target.closest("[data-order]");
    if (!card) return;
    const order = getOrders().find((o) => o.id === card.dataset.order);
    if (!order) return;

    const hint = card.querySelector("[data-invoice-hint]");
    const run = async (action, done) => {
      hint.textContent = "מכין את החשבונית…";
      try {
        await action();
        hint.textContent = done;
      } catch (err) {
        console.error("[LIAD] החשבונית נכשלה:", err);
        hint.textContent = "לא הצלחנו להכין את החשבונית.";
      }
    };

    if (e.target.closest("[data-invoice-open]")) {
      await run(() => openInvoice(order), "החשבונית נפתחה בלשונית חדשה.");
    }
    if (e.target.closest("[data-invoice-save]")) {
      await run(() => downloadInvoice(order), "הקובץ ירד.");
    }
    if (e.target.closest("[data-invoice-wa]")) {
      await run(async () => {
        const { how } = await sendInvoice(order, "whatsapp");
        hint.dataset.how = how;
      }, "וואטסאפ נפתח מול מספר הלקוחה. אם הקובץ לא צורף אוטומטית — הוא ירד למחשב, נשאר לגרור אותו לצ׳אט.");
    }
    if (e.target.closest("[data-invoice-mail]")) {
      await run(async () => {
        const { how } = await sendInvoice(order, "email");
        hint.dataset.how = how;
      }, "המייל נפתח מול כתובת הלקוחה. אם הקובץ לא צורף אוטומטית — הוא ירד למחשב, נשאר לצרף אותו.");
    }
  });
}

function exportOrdersCsv() {
  const orders = getOrders();
  if (!orders.length) return toast("אין הזמנות לייצוא", "info");

  const head = ["מספר הזמנה", "תאריך", "שם", "טלפון", "אימייל", "אופן קבלה", "כתובת", "פריטים", "הנחה", "משלוח", "סה\"כ"];
  const rows = orders.map((o) => [
    o.id,
    new Date(o.createdAt).toLocaleString("he-IL"),
    `${o.customer.firstName} ${o.customer.lastName}`,
    o.customer.phone,
    o.customer.email,
    o.shipping.method === "delivery" ? "משלוח" : "איסוף עצמי",
    o.shipping.method === "delivery"
      ? `${o.shipping.address.street}, ${o.shipping.address.city}`
      : o.shipping.address.pickup,
    o.items.map((i) => `${i.title} x${i.qty}`).join(" | "),
    o.totals.discount ?? 0,
    o.totals.shipping ?? 0,
    o.totals.total,
  ]);

  const csv = [head, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  download("orders.csv", "﻿" + csv, "text/csv");
  toast("קובץ ההזמנות הורד");
}


/* ==========================================================================
   07. חנות | לידים
   ========================================================================== */

const LEAD_SOURCES = {
  newsletter: "רשימת תפוצה",
  "promo-popup": "פופאפ הנחה",
  popup: "הודעה קופצת",
  checkout: "רכישה",
};

let leadFilter = { search: "", source: "" };

function renderLeads() {
  const all = getLeads();
  const sources = [...new Set(all.flatMap((l) => l.sources ?? []))];

  let list = all;
  if (leadFilter.source) list = list.filter((l) => (l.sources ?? []).includes(leadFilter.source));
  if (leadFilter.search) {
    const q = leadFilter.search.toLowerCase();
    list = list.filter((l) =>
      (l.name ?? "").toLowerCase().includes(q) ||
      (l.email ?? "").toLowerCase().includes(q) ||
      (l.phone ?? "").includes(q));
  }

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">רשימת הלקוחות</h1>
        <p class="admin__subtitle">כל מי שהשאירה פרטים — בטופס הרשמה, בפופאפ ההנחה או בקנייה.</p>
      </div>
      <button class="btn btn--outline btn--sm" id="exportLeads" type="button">ייצוא ל-CSV</button>
    </div>

    <div class="stat-row">
      <div class="stat"><p class="stat__label">סה״כ</p><p class="stat__value">${all.length}</p></div>
      <div class="stat"><p class="stat__label">עם אימייל</p><p class="stat__value">${all.filter((l) => l.email).length}</p></div>
      <div class="stat"><p class="stat__label">עם טלפון</p><p class="stat__value">${all.filter((l) => l.phone).length}</p></div>
      <div class="stat"><p class="stat__label">מרכישה</p><p class="stat__value">${all.filter((l) => (l.sources ?? []).includes("checkout")).length}</p></div>
    </div>

    <div class="toolbar">
      <input class="admin-input" type="search" id="lSearch" placeholder="חיפוש — שם, אימייל או טלפון"
             value="${esc(leadFilter.search)}" style="max-width:18rem" aria-label="חיפוש ליד">
      <select class="admin-select" id="lSource" style="max-width:13rem" aria-label="סינון לפי מקור">
        <option value="">כל המקורות</option>
        ${sources.map((s) => `<option value="${esc(s)}"${s === leadFilter.source ? " selected" : ""}>${esc(LEAD_SOURCES[s] || s)}</option>`).join("")}
      </select>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>שם</th>
            <th style="width:14rem">אימייל</th>
            <th style="width:9rem">טלפון</th>
            <th style="width:12rem">מאיפה הגיעה</th>
            <th style="width:8rem">תאריך</th>
            <th style="width:4rem"></th>
          </tr>
        </thead>
        <tbody>
          ${list.length ? list.map((l) => `
            <tr data-id="${esc(l.id)}">
              <td>${esc(l.name || "—")}</td>
              <td>${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : "—"}</td>
              <td class="num">${l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : "—"}</td>
              <td>${(l.sources ?? []).map((s) => `<span class="pill pill--ok">${esc(LEAD_SOURCES[s] || s)}</span>`).join(" ")}</td>
              <td class="muted nowrap">${new Date(l.createdAt).toLocaleDateString("he-IL")}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-action icon-action--danger" type="button" data-delete aria-label="מחיקה">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>`).join("")
            : `<tr><td colspan="6" class="admin-table__empty">אין עדיין לקוחות ברשימה</td></tr>`}
        </tbody>
      </table>
    </div>`;

  let timer;
  $("#lSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { leadFilter.search = e.target.value.trim(); renderLeads(); }, 200);
  });
  $("#lSource").addEventListener("change", (e) => { leadFilter.source = e.target.value; renderLeads(); });

  $("#adminMain").addEventListener("click", (e) => {
    if (!e.target.closest("[data-delete]")) return;
    const id = e.target.closest("tr").dataset.id;
    if (!confirm("למחוק את הרשומה?")) return;
    deleteLead(id)
      .then(() => { renderLeads(); toast("הרשומה נמחקה"); })
      .catch((err) => toast(err.message || "המחיקה נכשלה", "info"));
  });

  $("#exportLeads").addEventListener("click", () => {
    if (!all.length) return toast("אין רשומות לייצוא", "info");
    const head = ["שם", "אימייל", "טלפון", "מקורות", "נרשמה בתאריך"];
    const rows = all.map((l) => [
      l.name ?? "", l.email ?? "", l.phone ?? "",
      (l.sources ?? []).map((s) => LEAD_SOURCES[s] || s).join(" | "),
      new Date(l.createdAt).toLocaleString("he-IL"),
    ]);
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    download("leads.csv", "﻿" + csv, "text/csv");
    toast("הקובץ הורד");
  });
}


/* ==========================================================================
   08. דף הבית | טקסטים ותמונות
   ========================================================================== */

function renderTexts() {
  const patch = getHomepagePatch();

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">טקסטים בדף הבית</h1>
        <p class="admin__subtitle">שדה ריק = נשאר הטקסט המקורי. השינוי מופיע בדף מיד.</p>
      </div>
      <button class="btn btn--outline btn--sm" id="resetTexts" type="button">איפוס כל הטקסטים</button>
    </div>

    ${HOME_TEXT_GROUPS.map((group) => `
      <section class="admin-card" style="margin-bottom:1rem">
        <h2 class="admin__title" style="font-size:1rem;margin-bottom:.875rem">${esc(group.title)}</h2>
        <div class="admin-grid">
          ${group.fields.map((f) => `
            <label class="admin-field">
              <span class="admin-field__label">${esc(f.label)}</span>
              ${f.type === "textarea"
                ? `<textarea class="admin-textarea" data-text-key="${esc(f.key)}" placeholder="הטקסט המקורי">${esc(patch.text[f.key] ?? "")}</textarea>`
                : `<input class="admin-input" type="text" data-text-key="${esc(f.key)}" placeholder="הטקסט המקורי" value="${esc(patch.text[f.key] ?? "")}">`}
              ${f.hint ? `<span class="admin-field__label" style="margin-top:.25rem">${esc(f.hint)}</span>` : ""}
            </label>`).join("")}
        </div>
      </section>`).join("")}`;

  $("#adminMain").addEventListener("change", (e) => {
    const key = e.target.dataset?.textKey;
    if (!key) return;
    const text = { ...getHomepagePatch().text };
    const value = e.target.value.trim();
    if (value) text[key] = value; else delete text[key];
    saveHomepage({ text });
    toast("הטקסט עודכן בדף הבית");
  });

  $("#resetTexts").addEventListener("click", () => {
    if (!confirm("להחזיר את כל הטקסטים למקור?")) return;
    saveHomepage({ text: {} });
    renderTexts();
    toast("הטקסטים אופסו");
  });
}

function renderImages() {
  const patch = getHomepagePatch();

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">תמונות דף הבית</h1>
        <p class="admin__subtitle">בחרי תמונה מהמחשב. היא תוקטן אוטומטית ותוחלף בדף מיד.</p>
      </div>
    </div>

    <div class="admin-grid admin-grid--2">
      ${HOME_IMAGES.map((img) => `
        <div class="admin-card" data-image-key="${esc(img.key)}">
          <p style="font-weight:600;margin-bottom:.625rem">${esc(img.label)}</p>
          <div class="image-drop">
            <img class="image-drop__preview" alt="" src="${esc(patch.images[img.key] ?? "")}" data-preview>
            <div class="image-drop__body">
              <input class="admin-input" type="file" accept="image/*" data-file>
              <p class="image-drop__hint">
                ${img.hint ? esc(img.hint) + " · " : ""}
                ${patch.images[img.key] ? "תמונה מותאמת פעילה" : "כרגע מוצגת התמונה המקורית"}
              </p>
              ${patch.images[img.key] ? `<button class="btn btn--outline btn--sm" type="button" data-clear style="margin-top:.5rem">חזרה למקורית</button>` : ""}
            </div>
          </div>
        </div>`).join("")}
    </div>`;

  $("#adminMain").addEventListener("change", async (e) => {
    if (!e.target.matches("[data-file]")) return;
    const card = e.target.closest("[data-image-key]");
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readImage(file);
      const images = { ...getHomepagePatch().images, [card.dataset.imageKey]: dataUrl };
      saveHomepage({ images });
      renderImages();
      toast("התמונה הוחלפה בדף הבית");
    } catch (err) {
      toast(err.message, "info");
    }
  });

  $("#adminMain").addEventListener("click", (e) => {
    if (!e.target.closest("[data-clear]")) return;
    const key = e.target.closest("[data-image-key]").dataset.imageKey;
    const images = { ...getHomepagePatch().images };
    delete images[key];
    saveHomepage({ images });
    renderImages();
    toast("התמונה המקורית חזרה");
  });
}


/* ==========================================================================
   09. דף הבית | סדר הסקשנים
   ========================================================================== */

function renderSections() {
  const patch = getHomepagePatch();
  const order = patch.order.length
    ? [...patch.order.filter((id) => HOME_SECTIONS.some((s) => s.id === id)),
       ...HOME_SECTIONS.map((s) => s.id).filter((id) => !patch.order.includes(id))]
    : HOME_SECTIONS.map((s) => s.id);

  const byId = Object.fromEntries(HOME_SECTIONS.map((s) => [s.id, s]));

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">סדר הסקשנים</h1>
        <p class="admin__subtitle">החצים מזיזים סקשן למעלה או למטה. אפשר גם להסתיר סקשן לגמרי.</p>
      </div>
      <button class="btn btn--outline btn--sm" id="resetOrder" type="button">חזרה לסדר המקורי</button>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th style="width:3rem">#</th><th>סקשן</th><th style="width:8rem">מוצג</th><th style="width:7rem"></th></tr>
        </thead>
        <tbody>
          ${order.map((id, i) => `
            <tr data-id="${esc(id)}">
              <td class="num muted">${i + 1}</td>
              <td>${esc(byId[id].label)}</td>
              <td>${checkbox("מוצג", `vis-${id}`, patch.sections[id]?.hidden !== true).replace("name=", "data-visible name=")}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-action" type="button" data-up ${i === 0 ? "disabled" : ""} aria-label="הזזה למעלה">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  <button class="icon-action" type="button" data-down ${i === order.length - 1 ? "disabled" : ""} aria-label="הזזה למטה">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  $("#adminMain").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const i = order.indexOf(row.dataset.id);
    const j = e.target.closest("[data-up]") ? i - 1 : e.target.closest("[data-down]") ? i + 1 : -1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    saveHomepage({ order });
    renderSections();
  });

  $("#adminMain").addEventListener("change", (e) => {
    if (!e.target.matches("[data-visible]")) return;
    const id = e.target.closest("tr").dataset.id;
    const sections = { ...getHomepagePatch().sections, [id]: { hidden: !e.target.checked } };
    saveHomepage({ sections });
    toast(e.target.checked ? "הסקשן חזר לדף" : "הסקשן הוסתר");
  });

  $("#resetOrder").addEventListener("click", () => {
    saveHomepage({ order: [], sections: {} });
    renderSections();
    toast("הסדר אופס");
  });
}


/* ==========================================================================
   10. דף הבית | מוצרים מוצגים
   ========================================================================== */

function renderFeatured() {
  const chosen = getHomepagePatch().featured ?? [];
  const byId = Object.fromEntries(state.products.map((p) => [p.id, p]));

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">מוצרים מוצגים בדף הבית</h1>
        <p class="admin__subtitle">
          המוצרים שייפתחו את הקרוסלה. אחריהם הקרוסלה ממשיכה אוטומטית עם
          מוצרים נוספים מהחנות, כדי שהיא לעולם לא תעצור ולא תישאר ריקה.
        </p>
      </div>
      <button class="btn btn--outline btn--sm" id="resetFeatured" type="button">חזרה לברירת המחדל</button>
    </div>

    <section class="admin-card" style="margin-bottom:1rem">
      <p style="font-weight:600;margin-bottom:.625rem">נבחרו (${chosen.length})</p>
      ${chosen.length ? `
        <div class="table-wrap" style="max-height:20rem">
          <table class="admin-table">
            <tbody>
              ${chosen.map((id, i) => {
                const p = byId[id];
                return `
                <tr data-id="${esc(id)}">
                  <td style="width:3rem" class="num muted">${i + 1}</td>
                  <td style="width:3.5rem">${p ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : ""}</td>
                  <td>${p ? esc(p.title) : `<span class="muted">מוצר שנמחק (${esc(id)})</span>`}</td>
                  <td style="width:7rem">
                    <div class="row-actions">
                      <button class="icon-action" type="button" data-up ${i === 0 ? "disabled" : ""} aria-label="למעלה">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                      </button>
                      <button class="icon-action icon-action--danger" type="button" data-remove aria-label="הסרה">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>`
        : `<p class="muted">לא נבחרו מוצרים — הקרוסלה משתמשת ברשימה שב-data/content.json.</p>`}
    </section>

    <section class="admin-card">
      <p style="font-weight:600;margin-bottom:.625rem">הוספה מהקטלוג</p>
      <div class="toolbar">
        <input class="admin-input" type="search" id="fSearch" placeholder="חיפוש מוצר…" style="max-width:20rem" aria-label="חיפוש מוצר">
      </div>
      <div class="table-wrap" style="max-height:24rem"><table class="admin-table"><tbody id="fResults"></tbody></table></div>
    </section>`;

  const drawResults = (q = "") => {
    const list = state.products
      .filter((p) => !chosen.includes(p.id))
      .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q))
      .slice(0, 60);

    $("#fResults").innerHTML = list.length ? list.map((p) => `
      <tr data-add="${esc(p.id)}">
        <td style="width:3.5rem"><img class="thumb" src="${esc(p.image)}" alt="" loading="lazy"></td>
        <td>${esc(p.title)}</td>
        <td class="num nowrap" style="width:6rem">${money(p.price)}</td>
        <td style="width:5rem"><button class="btn btn--outline btn--sm" type="button">הוספה</button></td>
      </tr>`).join("")
      : `<tr><td class="admin-table__empty">לא נמצאו מוצרים</td></tr>`;
  };
  drawResults();

  let timer;
  $("#fSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => drawResults(e.target.value.trim().toLowerCase()), 180);
  });

  $("#adminMain").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      saveHomepage({ featured: [...chosen, add.dataset.add] });
      renderFeatured();
      toast("המוצר נוסף לקרוסלה");
      return;
    }

    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const next = [...chosen];
    const i = next.indexOf(row.dataset.id);

    if (e.target.closest("[data-remove]")) next.splice(i, 1);
    else if (e.target.closest("[data-up]") && i > 0) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    else return;

    saveHomepage({ featured: next });
    renderFeatured();
  });

  $("#resetFeatured").addEventListener("click", () => {
    saveHomepage({ featured: null });
    renderFeatured();
    toast("הקרוסלה חזרה לברירת המחדל");
  });
}


/* ==========================================================================
   11. דף הבית | באנרים
   ========================================================================== */

function renderBanners() {
  const banners = getHomepagePatch().banners ?? [];

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">באנרים</h1>
        <p class="admin__subtitle">
          ההודעות שמתחלפות בשורה העליונה של הדף. עד ${MAX_BANNERS} הודעות.
          רשימה ריקה = נשארות ההודעות המקוריות.
        </p>
      </div>
      <button class="btn btn--gold btn--sm" id="addBanner" type="button" ${banners.length >= MAX_BANNERS ? "disabled" : ""}>
        + הודעה
      </button>
    </div>

    <div class="admin-card">
      ${banners.length ? `
        <div class="admin-grid">
          ${banners.map((text, i) => `
            <div style="display:flex;gap:.5rem;align-items:center" data-banner="${i}">
              <input class="admin-input" type="text" value="${esc(text)}" data-banner-text aria-label="טקסט הבאנר">
              <button class="icon-action icon-action--danger" type="button" data-remove aria-label="מחיקה">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>`).join("")}
        </div>`
        : `<p class="muted">אין באנרים מותאמים — מוצגות ההודעות המקוריות של הדף.</p>`}
    </div>`;

  $("#addBanner").addEventListener("click", () => {
    saveHomepage({ banners: [...banners, "הודעה חדשה"] });
    renderBanners();
  });

  $("#adminMain").addEventListener("change", (e) => {
    if (!e.target.matches("[data-banner-text]")) return;
    const i = Number(e.target.closest("[data-banner]").dataset.banner);
    const next = [...banners];
    next[i] = e.target.value;
    saveHomepage({ banners: next });
    toast("הבאנר עודכן");
  });

  $("#adminMain").addEventListener("click", (e) => {
    if (!e.target.closest("[data-remove]")) return;
    const i = Number(e.target.closest("[data-banner]").dataset.banner);
    saveHomepage({ banners: banners.filter((_, k) => k !== i) });
    renderBanners();
  });
}


/* ==========================================================================
   12. דף הבית | הודעות קופצות
   ========================================================================== */

function renderPopups() {
  const popups = getPopups();
  const active = popups.filter((p) => p.active).length;

  $("#adminMain").innerHTML = `
    <div class="admin__head">
      <div>
        <h1 class="admin__title">הודעות קופצות</h1>
        <p class="admin__subtitle">
          ${active} מתוך ${MAX_ACTIVE_POPUPS} פעילות. אפשר לבחור אילו שדות הלקוחה ממלאת —
          שם, אימייל וטלפון. העיצוב זהה לפופאפ הקיים.
        </p>
      </div>
      <button class="btn btn--gold btn--sm" id="addPopup" type="button">+ הודעה חדשה</button>
    </div>

    <div class="admin-grid admin-grid--2">
      ${popups.length ? popups.map((p) => `
        <article class="admin-card" data-popup="${esc(p.id)}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem">
            <div>
              <p style="font-weight:600">${esc(p.title)}</p>
              <p class="muted" style="font-size:.8125rem;margin-top:.25rem">
                ${esc(p.value || "")} · נפתחת אחרי ${p.delaySeconds} שניות
              </p>
            </div>
            <span class="pill ${p.active ? "pill--ok" : "pill--off"}">${p.active ? "פעילה" : "כבויה"}</span>
          </div>

          <p class="muted" style="font-size:.8125rem;margin-top:.625rem;line-height:1.5">${esc(p.text)}</p>

          <p style="margin-top:.625rem;display:flex;gap:.375rem;flex-wrap:wrap">
            ${p.fields?.name ? '<span class="pill pill--ok">שם</span>' : ""}
            ${p.fields?.email ? '<span class="pill pill--ok">אימייל</span>' : ""}
            ${p.fields?.phone ? '<span class="pill pill--ok">טלפון</span>' : ""}
          </p>

          <div class="admin-modal__foot" style="margin-top:1rem">
            <button class="btn btn--outline btn--sm" type="button" data-toggle>${p.active ? "כיבוי" : "הפעלה"}</button>
            <button class="btn btn--outline btn--sm" type="button" data-delete>מחיקה</button>
            <button class="btn btn--gold btn--sm" type="button" data-edit>עריכה</button>
          </div>
        </article>`).join("")
        : `<div class="admin-card admin-table__empty">אין עדיין הודעות</div>`}
    </div>`;

  $("#addPopup").addEventListener("click", () => popupForm(null));

  $("#adminMain").addEventListener("click", (e) => {
    const card = e.target.closest("[data-popup]");
    if (!card) return;
    const popup = getPopups().find((p) => p.id === card.dataset.popup);
    if (!popup) return;

    if (e.target.closest("[data-edit]")) popupForm(popup);

    if (e.target.closest("[data-toggle]")) {
      const result = savePopup({ ...popup, active: !popup.active });
      if (!result.ok) return toast(result.reason, "info");
      renderPopups();
      toast(popup.active ? "ההודעה כובתה" : "ההודעה הופעלה");
    }

    if (e.target.closest("[data-delete]")) {
      if (!confirm(`למחוק את "${popup.title}"?`)) return;
      deletePopup(popup.id);
      renderPopups();
      toast("ההודעה נמחקה");
    }
  });
}

function popupForm(popup) {
  const isNew = !popup;
  const p = popup ?? {
    title: "", value: "", text: "", buttonText: "שליחה", code: "",
    fields: { name: false, email: true, phone: false }, delaySeconds: 45, active: true,
  };

  openModal(isNew ? "הודעה קופצת חדשה" : "עריכת הודעה", `
    <div class="admin-grid">
      ${field("כותרת", "title", p.title, { required: "required" })}
      ${field("הכיתוב הגדול", "value", p.value, { hint: 'למשל "10%" — מוצג בזהב מעל הכותרת' })}
      ${field("טקסט", "text", p.text, { type: "textarea" })}
      <div class="admin-grid admin-grid--2">
        ${field("כיתוב הכפתור", "buttonText", p.buttonText)}
        ${field("קוד ההנחה שיוצג", "code", p.code, { hint: "ריק = לא מוצג קוד" })}
      </div>
      ${field("נפתחת אחרי (שניות)", "delaySeconds", p.delaySeconds, { type: "number", min: "0" })}

      <fieldset style="border:1px solid var(--border);padding:.875rem">
        <legend class="admin-field__label">שדות שהלקוחה ממלאת</legend>
        <div style="display:flex;gap:1.25rem;flex-wrap:wrap">
          ${checkbox("שם", "fName", p.fields?.name)}
          ${checkbox("אימייל", "fEmail", p.fields?.email)}
          ${checkbox("טלפון", "fPhone", p.fields?.phone)}
        </div>
      </fieldset>

      ${checkbox("הודעה פעילה", "active", p.active)}
    </div>`, {
    saveLabel: isNew ? "יצירת ההודעה" : "שמירה",
    onSave() {
      const v = formValues();
      if (!v.title.trim()) throw new Error("צריך כותרת להודעה");
      if (!v.fEmail && !v.fPhone && !v.fName) throw new Error("צריך לפחות שדה אחד למילוי");

      const result = savePopup({
        ...(popup ?? {}),
        title: v.title.trim(),
        value: v.value.trim(),
        text: v.text.trim(),
        buttonText: v.buttonText.trim() || "שליחה",
        code: v.code.trim(),
        delaySeconds: Math.max(0, parseInt(v.delaySeconds, 10) || 0),
        fields: { name: v.fName, email: v.fEmail, phone: v.fPhone },
        active: v.active,
      });

      if (!result.ok) throw new Error(result.reason);
      renderPopups();
      toast(isNew ? "ההודעה נוצרה" : "ההודעה עודכנה");
    },
  });
}


/* ==========================================================================
   13. פרסום, גיבוי ואיפוס
   ========================================================================== */

function backupDialog() {
  openModal("גיבוי ושחזור", `
    <div class="admin-grid">
      <div class="notice">
        <strong>גיבוי</strong> שומר את כל מה שערכת — מוצרים, קטגוריות, קופונים,
        דף הבית, הודעות ורשימת הלקוחות — לקובץ אחד.
      </div>

      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn btn--gold btn--sm" type="button" id="doExport">הורדת גיבוי</button>
        <label class="btn btn--outline btn--sm" style="cursor:pointer">
          שחזור מגיבוי
          <input type="file" id="doImport" accept="application/json" hidden>
        </label>
      </div>

      <div class="notice notice--danger" style="margin-top:1rem">
        <strong>איפוס</strong> מוחק את כל השינויים ומחזיר את האתר למצב שבקבצים.
        <div style="margin-top:.625rem;display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn--outline btn--sm" type="button" id="doResetCatalog">איפוס הקטלוג</button>
          <button class="btn btn--outline btn--sm" type="button" id="doResetHome">איפוס דף הבית</button>
        </div>
      </div>
    </div>`);

  $("#doExport").addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`liad-backup-${stamp}.json`, exportAll());
    toast("הגיבוי ירד");
  });

  $("#doImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (!importAll(text)) return toast("הקובץ אינו גיבוי תקין", "info");
    closeModal();
    boot();
    toast("הגיבוי שוחזר");
  });

  $("#doResetCatalog").addEventListener("click", () => {
    if (!confirm("לאפס את כל שינויי הקטלוג?")) return;
    resetCatalog();
    closeModal();
    toast("הקטלוג אופס");
  });

  $("#doResetHome").addEventListener("click", () => {
    if (!confirm("לאפס את כל שינויי דף הבית?")) return;
    resetHomepage();
    closeModal();
    toast("דף הבית אופס");
  });
}


/* ==========================================================================
   14. הפעלה
   ========================================================================== */

async function boot() {
  const base = await loadCatalog({ raw: true });
  state.base = base ?? [];
  state.products = applyCatalogPatch(state.base);

  if (!base) {
    $("#adminMain").innerHTML =
      `<div class="notice notice--danger">הקטלוג לא נטען. יש להריץ את הדף דרך שרת מקומי.</div>`;
  }

  // רשימת הלקוחות מוגנת, ולכן נמשכת רק אחרי התחברות
  if (isSignedIn()) await loadLeads().catch(() => {});

  draw();
}

async function init() {
  initAccessibility();
  wireModal();
  wireAuth();
  readHash();

  document.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) go(goto.dataset.goto);

    const panel = e.target.closest("[data-panel]");
    if (panel) go(state.screen, panel.dataset.panel);
  });

  $("#openBackup").addEventListener("click", backupDialog);
  window.addEventListener("hashchange", () => { readHash(); draw(); });

  // כל שמירה במערכת מרעננת את המסך, כך שמה שרואים הוא תמיד המצב האמיתי
  document.addEventListener(ADMIN_EVENT, refresh);
  document.addEventListener(SYNC_STATUS_EVENT, paintSyncStatus);

  await ensureSession();
  await initSync();
  paintSyncStatus();
  await boot();
}

document.addEventListener("DOMContentLoaded", init);
