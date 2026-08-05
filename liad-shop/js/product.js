/* ==========================================================================
   LIAD — חנות | דף מוצר (PDP)
   מרכיב את הדף מתוך הקטלוג לפי ?id= שב-URL.
   ========================================================================== */

import {
  $, $$, html, esc, money, CONFIG,
  loadCatalog, getCart, addToCart, availableStock, toast,
} from "./store.js";
import { createGallery } from "./gallery.js";
import { initCartDrawer, updateCartCount } from "./cart-ui.js";
import { initShared } from "./shared.js";
import { productCard, CATEGORY_LABELS } from "./product-card.js";
import { initMotion, refreshMotion } from "./motion.js";

const MAX_RELATED = 8;

let product = null;
let quantity = 1;

/* ---------------------------------------------------------------- אתחול */

async function init() {
  initShared();
  initCartDrawer();
  updateCartCount();

  const id = new URLSearchParams(location.search).get("id");
  const catalog = await loadCatalog();

  if (!catalog) return renderError("הקטלוג לא נטען", "יש להריץ את הדף דרך שרת מקומי.");

  product = catalog.find((p) => p.id === id);
  if (!product) {
    return renderError("המוצר לא נמצא", "ייתכן שהקישור ישן או שהמוצר הוסר.");
  }

  document.title = `${product.title} | LIAD`;
  renderProduct();
  renderRelated(catalog);

  // התוכן כבר על הדף — עכשיו אפשר למדוד ולהפעיל את התנועה
  initMotion();

  document.addEventListener("cart:change", syncStockUI);
}

function renderError(title, message) {
  $("#pdp").removeAttribute("aria-busy");
  $("#pdp").innerHTML = `
    <div style="grid-column:1/-1;padding:5rem 1rem;text-align:center">
      <h1 style="font-family:var(--font-display);font-size:1.75rem">${esc(title)}</h1>
      <p style="margin-top:.75rem;color:var(--muted-foreground)">${esc(message)}</p>
      <a class="btn btn--gold" href="index.html" style="margin-top:1.5rem">חזרה לחנות</a>
    </div>`;
}

/* ---------------------------------------------------------------- המוצר */

/** מאחד את התמונה הראשית והגלריה לרשימה אחת עם תפקידים */
function galleryImages(p) {
  const roles = [p.imageRole || "bottle"];
  const list = [{ src: p.image, role: roles[0] }];
  (p.gallery || []).forEach((src) => list.push({ src, role: "swatch" }));
  return list;
}

function renderProduct() {
  const pdp = $("#pdp");
  const left = availableStock(product);
  const soldOut = (product.stock ?? 0) === 0;

  pdp.removeAttribute("aria-busy");
  pdp.innerHTML = `
    <nav class="breadcrumb" aria-label="מסלול ניווט">
      <a href="index.html">החנות</a>
      <span aria-hidden="true">/</span>
      <a href="index.html?category=${encodeURIComponent(product.category)}">
        ${esc(CATEGORY_LABELS[product.category] || product.category)}
      </a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(product.title)}</span>
    </nav>

    <div class="pdp__media" id="pdpGallery" data-reveal="scale"></div>

    <div class="pdp__panel">
      <div class="pdp__sticky" data-reveal-stagger="0.06">
        <p class="pdp__brand">${esc(product.brand)}</p>
        <h1 class="pdp__title">${esc(product.title)}</h1>

        <div class="pdp__pricing">
          <p class="pdp__price">${money(product.price)}</p>
          <span class="pdp__stock ${soldOut ? "is-out" : left <= 3 ? "is-low" : ""}" id="stockBadge">
            ${stockLabel(soldOut, left)}
          </span>
        </div>

        <p class="pdp__desc">${esc(product.description)}</p>

        <dl class="pdp__specs">
          ${product.shade ? `<div><dt>גוון</dt><dd>${esc(product.shade)}</dd></div>` : ""}
          <div><dt>מותג</dt><dd>${esc(product.brand)}</dd></div>
          <div><dt>קו מוצר</dt><dd>${esc(product.line)}</dd></div>
        </dl>

        <div class="pdp__buy">
          <div class="qty qty--lg" id="qtyControl">
            <button type="button" data-qty="dec" aria-label="הפחתת כמות">−</button>
            <output id="qtyValue" aria-live="polite">1</output>
            <button type="button" data-qty="inc" aria-label="הוספת כמות">+</button>
          </div>
          <button class="btn btn--gold pdp__add" id="addToCart" ${soldOut ? "disabled" : ""}>
            ${soldOut ? "אזל מהמלאי" : "הוספה לסל"}
          </button>
        </div>

        <ul class="pdp__assurances">
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>
              <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
              <circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
            </svg>
            משלוח חינם מעל ${money(CONFIG.freeShippingFrom)}
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            רכישה מאובטחת ללא הרשמה
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/>
              <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>
            </svg>
            איסוף עצמי מבנימינה
          </li>
        </ul>
      </div>
    </div>`;

  createGallery($("#pdpGallery"), {
    images: galleryImages(product),
    alt: product.title,
  });

  wireQuantity();
  wireAddToCart();
  setupBuyBar();
}

function stockLabel(soldOut, left) {
  if (soldOut) return "אזל מהמלאי";
  if (left === 0) return "הכול כבר בעגלה";
  if (left <= 3) return `נותרו ${left} במלאי`;
  return "במלאי";
}

/* ---------------------------------------------------------------- כמות */

function wireQuantity() {
  $("#qtyControl").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-qty]");
    if (!btn) return;
    const max = Math.max(1, availableStock(product));
    quantity = btn.dataset.qty === "inc"
      ? Math.min(quantity + 1, max)
      : Math.max(1, quantity - 1);
    $("#qtyValue").textContent = String(quantity);
    syncStockUI();
  });
}

/* ---------------------------------------------------------------- הוספה לסל */

function wireAddToCart() {
  const add = () => {
    const result = addToCart(product, quantity);
    if (!result.ok) return toast("אין יותר מלאי מהמוצר הזה", "info");

    toast(`${product.title} נוסף לעגלה`, "cart");
    document.dispatchEvent(new CustomEvent("cart:added"));

    quantity = 1;
    $("#qtyValue").textContent = "1";
    syncStockUI();
  };

  $("#addToCart").addEventListener("click", add);
  $("#buyBarAdd").addEventListener("click", add);
}

/** מעדכן מלאי, כפתורים ותוויות אחרי כל שינוי בעגלה */
function syncStockUI() {
  const left = availableStock(product);
  const soldOut = (product.stock ?? 0) === 0;
  const disabled = soldOut || left === 0;

  const badge = $("#stockBadge");
  if (badge) {
    badge.textContent = stockLabel(soldOut, left);
    badge.className = `pdp__stock ${soldOut ? "is-out" : left <= 3 ? "is-low" : ""}`;
  }

  [$("#addToCart"), $("#buyBarAdd")].forEach((btn) => {
    if (!btn) return;
    btn.disabled = disabled;
    btn.textContent = soldOut ? "אזל מהמלאי" : left === 0 ? "הכול בעגלה" : "הוספה לסל";
  });

  if (quantity > Math.max(1, left)) {
    quantity = Math.max(1, left);
    $("#qtyValue").textContent = String(quantity);
  }

  const inc = $('#qtyControl [data-qty="inc"]');
  if (inc) inc.disabled = quantity >= left;
}

/* ---------------------------------------------------------------- סרגל קנייה */

/**
 * הסרגל הדביק במובייל מופיע רק אחרי שכפתור ההוספה הראשי יצא מהמסך,
 * כדי שלא יוצגו שני כפתורים זהים באותו רגע.
 *
 * המדידה נעשית ישירות מול מיקום הכפתור בגלילה, ולא דרך IntersectionObserver:
 * ה-observer לא נתמך/לא יורה בחלק מהסביבות, ואז הסרגל היה נעלם בשקט —
 * כלומר במובייל לא הייתה שום דרך להוסיף לסל אחרי גלילה.
 */
function setupBuyBar() {
  const bar = $("#buyBar");
  const anchor = $("#addToCart");
  if (!bar || !anchor) return;

  $("#buyBarTitle").textContent = product.title;
  $("#buyBarPrice").textContent = money(product.price);

  let ticking = false;

  const update = () => {
    ticking = false;
    const rect = anchor.getBoundingClientRect();
    // הכפתור הראשי נראה? אין צורך בסרגל.
    const visible = rect.bottom > 80 && rect.top < window.innerHeight;
    bar.hidden = visible;
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
}

/* ---------------------------------------------------------------- מוצרים קשורים */

function renderRelated(catalog) {
  const related = catalog
    .filter((p) => p.id !== product.id && p.line === product.line)
    .slice(0, MAX_RELATED);

  if (!related.length) return;

  const grid = $("#relatedGrid");
  const cart = getCart();
  related.forEach((p) => grid.append(productCard(p, cart)));
  $("#relatedSection").hidden = false;
  refreshMotion(grid);
}

/* מאפשר הוספה לסל מכרטיסי המוצרים הקשורים */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".card__add");
  if (!btn) return;
  const id = btn.closest(".card")?.dataset.id;
  loadCatalog().then((catalog) => {
    const item = catalog?.find((p) => p.id === id);
    if (!item) return;
    if (!addToCart(item, 1).ok) return toast("אין יותר מלאי מהמוצר הזה", "info");
    toast(`${item.title} נוסף לעגלה`, "cart");
    document.dispatchEvent(new CustomEvent("cart:added"));
  });
});

document.addEventListener("DOMContentLoaded", init);
