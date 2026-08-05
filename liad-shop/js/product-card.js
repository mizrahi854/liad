/* ==========================================================================
   LIAD — חנות | רכיב כרטיס מוצר
   מקור אמת אחד לכרטיס. משמש גם בקטלוג וגם ב"מוצרים קשורים" בדף המוצר.

   מאפייני התמונה:
     • תמונה ראשונה  = בקבוק / אריזה
     • תמונה שנייה   = סווטצ׳ (מוחלפת ב-hover בדסקטופ)
     • טעינה עצלה, blur placeholder, יחס גובה-רוחב קבוע נגד קפיצות פריסה
   ========================================================================== */

import { html, esc, money, availableStock } from "./store.js";

export const CATEGORY_LABELS = {
  "gel-polish": "לק ג׳ל",
  "builder-gel": "ג׳ל בנייה",
  "bases": "בייסים וטופים",
  "polygel": "פוליג׳ל",
  "regular-polish": "לק רגיל",
  "nail-art": "ציור ואומנות",
  "starter-kits": "מארזים",
  "machines": "מכונות ומכשור",
  "lamps": "מנורות",
  "hygiene": "חיטוי ועיקור",
  "files": "פצירות ובאפרים",
  "tools": "כלי עבודה",
  "disposable": "חד פעמי",
  "tips": "טיפס",
};

/**
 * בונה כרטיס מוצר.
 * @param {Object} product
 * @param {Array}  cart  העגלה הנוכחית, לחישוב המלאי שנותר
 * @returns {DocumentFragment}
 */
export function productCard(product, cart = []) {
  const left = availableStock(product, cart);
  const soldOut = (product.stock ?? 0) === 0;
  const hoverSrc = product.gallery?.[0] ?? null;

  const flags = [];
  if (soldOut) flags.push('<span class="flag flag--out">אזל מהמלאי</span>');
  else if (left <= 3) flags.push(`<span class="flag flag--low">נותרו ${left}</span>`);

  const href = `product.html?id=${encodeURIComponent(product.id)}`;

  return html`
    <article class="card" data-id="${esc(product.id)}" data-reveal="up" data-tilt="5">
      <a class="card__link" href="${href}" aria-label="${esc(product.title)}">
        <div class="card__media">
          <img class="card__img card__img--primary"
               src="${esc(product.image)}"
               alt="${esc(product.title)}"
               width="600" height="600"
               loading="lazy" decoding="async">
          ${hoverSrc ? `
          <img class="card__img card__img--hover"
               src="${esc(hoverSrc)}"
               alt="" aria-hidden="true"
               width="600" height="600"
               loading="lazy" decoding="async">` : ""}
          <div class="card__flags">${flags.join("")}</div>
        </div>
      </a>

      <div class="card__body">
        <p class="card__brand">${esc(product.brand)}</p>
        <h3 class="card__title">
          <a class="card__title-link" href="${href}">${esc(product.title)}</a>
        </h3>
        <p class="card__price">${money(product.price)}</p>
        <button class="card__add" type="button" ${soldOut || left === 0 ? "disabled" : ""}>
          ${soldOut ? "אזל מהמלאי" : left === 0 ? "הכול בעגלה" : "הוספה לסל"}
        </button>
      </div>
    </article>`;
}
