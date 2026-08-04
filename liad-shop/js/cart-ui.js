/* ==========================================================================
   LIAD — חנות | ממשק העגלה
   מגירת העגלה, מונה הפריטים והכללים המשותפים. משמש בכל דפי החנות.
   ========================================================================== */

import {
  $, $$, html, esc, money, CONFIG,
  getCart, setQty, removeFromCart, cartCount, calcTotals, toast,
} from "./store.js";

/* ---------------------------------------------------------------- מגירה */

export function initCartDrawer() {
  const drawer = $("#cartDrawer");
  const backdrop = $("#cartBackdrop");
  if (!drawer || !backdrop) return;

  const open = () => {
    drawer.classList.add("is-open");
    backdrop.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };

  const close = () => {
    drawer.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  $("#cartOpen")?.addEventListener("click", open);
  $("#cartClose")?.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("is-open")) close();
  });

  // פתיחה אוטומטית אחרי הוספה לעגלה
  document.addEventListener("cart:added", open);

  renderCart();
  document.addEventListener("cart:change", renderCart);

  return { open, close };
}

/* ---------------------------------------------------------------- תצוגה */

export function renderCart() {
  const body = $("#cartBody");
  const foot = $("#cartFoot");
  if (!body) return;

  const cart = getCart();
  updateCartCount();

  if (!cart.length) {
    body.innerHTML = `
      <div style="padding:3rem 1rem;text-align:center;color:var(--muted-foreground)">
        <p style="font-family:var(--font-display);font-size:1.125rem;color:var(--foreground)">העגלה ריקה</p>
        <p style="margin-top:.5rem;font-size:.875rem">הוסיפו מוצרים כדי להמשיך</p>
      </div>`;
    if (foot) foot.hidden = true;
    return;
  }

  body.innerHTML = "";
  cart.forEach((line) => {
    const atMax = line.qty >= (line.stock ?? 99);
    body.append(html`
      <div class="line-item" data-id="${esc(line.id)}">
        <div class="line-item__media">
          <img src="${esc(line.image)}" alt="${esc(line.title)}" loading="lazy">
        </div>
        <div>
          <p class="line-item__title">${esc(line.title)}</p>
          <p class="line-item__meta">${esc(line.brand)}${line.shade ? ` · גוון ${esc(line.shade)}` : ""}</p>
          <div class="line-item__row">
            <div class="qty">
              <button type="button" data-act="dec" aria-label="הפחתת כמות">−</button>
              <output aria-live="polite">${line.qty}</output>
              <button type="button" data-act="inc" aria-label="הוספת כמות" ${atMax ? "disabled" : ""}>+</button>
            </div>
            <span class="line-item__price">${money(line.price * line.qty)}</span>
          </div>
          <div class="line-item__row">
            <button type="button" class="line-item__remove" data-act="remove">הסרה</button>
            ${atMax ? `<span style="font-size:.75rem;color:var(--muted-foreground)">זה כל המלאי</span>` : ""}
          </div>
        </div>
      </div>
    `);
  });

  const totals = calcTotals(cart);
  $("#cartSubtotal").textContent = money(totals.subtotal);
  $("#cartTotal").textContent = money(totals.total);

  const hint = $("#shippingHint");
  if (hint) {
    if (totals.qualifiesFreeShipping) {
      hint.innerHTML = `<div class="shipping-hint">יש לכן משלוח חינם 🎉</div>`;
    } else {
      const pct = Math.min(100, (totals.subtotal / CONFIG.freeShippingFrom) * 100);
      hint.innerHTML = `
        <div class="shipping-hint">
          עוד ${money(totals.freeShippingGap)} ותקבלו משלוח חינם
          <div class="progress"><div class="progress__bar" style="width:${pct}%"></div></div>
        </div>`;
    }
  }

  if (foot) foot.hidden = false;
}

/* ---------------------------------------------------------------- פעולות */

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const item = btn.closest(".line-item");
  if (!item) return;

  const id = item.dataset.id;
  const line = getCart().find((l) => l.id === id);
  if (!line) return;

  switch (btn.dataset.act) {
    case "inc": setQty(id, line.qty + 1); break;
    case "dec": setQty(id, line.qty - 1); break;
    case "remove":
      removeFromCart(id);
      toast("המוצר הוסר מהעגלה", "info");
      break;
  }
});

/* ---------------------------------------------------------------- מונה */

export function updateCartCount() {
  const el = $("#cartCount");
  if (!el) return;
  const count = cartCount();
  el.textContent = String(count);
  el.classList.toggle("is-visible", count > 0);
}
