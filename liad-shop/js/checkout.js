/* ==========================================================================
   LIAD — חנות | דף התשלום
   ולידציה, קופון, חישוב סכום ושמירת ההזמנה. ללא הרשמה.
   ========================================================================== */

import {
  $, $$, html, esc, money, CONFIG,
  getCart, clearCart, calcTotals, validateCoupon,
  saveOrder, newOrderId, toast,
} from "./store.js";
import { initShared } from "./shared.js";
import { addLead, redeemCoupon } from "./admin-store.js";
import { initMotion } from "./motion.js";

const state = {
  coupon: null,
  shipping: "delivery",
};

/* ---------------------------------------------------------------- אתחול */

function init() {
  initShared();

  const cart = getCart();
  const form = $("#checkoutForm");
  const empty = $("#emptyState");

  if (!cart.length) {
    empty.hidden = false;
    form.hidden = true;
    return;
  }

  form.hidden = false;
  empty.hidden = true;

  renderSummaryItems(cart);
  wireShipping();
  wireCoupon();
  wireValidation();
  form.addEventListener("submit", onSubmit);
  refreshTotals();
  initMotion();
}

/* ---------------------------------------------------------------- סיכום */

function renderSummaryItems(cart) {
  const box = $("#summaryItems");
  box.innerHTML = "";
  cart.forEach((line) => {
    box.append(html`
      <div class="line-item" style="grid-template-columns:3.5rem 1fr">
        <div class="line-item__media">
          <img src="${esc(line.image)}" alt="${esc(line.title)}" loading="lazy">
        </div>
        <div>
          <p class="line-item__title" style="font-size:.8125rem">${esc(line.title)}</p>
          <div class="line-item__row" style="margin-top:.375rem">
            <span class="line-item__meta">כמות: ${line.qty}</span>
            <span class="line-item__price" style="font-size:.875rem">${money(line.price * line.qty)}</span>
          </div>
        </div>
      </div>
    `);
  });
}

function refreshTotals() {
  const totals = calcTotals(getCart(), state.coupon, state.shipping);

  $("#sumSubtotal").textContent = money(totals.subtotal);
  $("#sumShipping").textContent = totals.shipping === 0 ? "חינם" : money(totals.shipping);
  $("#sumTotal").textContent = money(totals.total);

  const row = $("#discountRow");
  if (totals.discount > 0) {
    row.hidden = false;
    $("#discountLabel").textContent = `הנחה (${totals.coupon.code})`;
    $("#sumDiscount").textContent = `−${money(totals.discount)}`;
  } else {
    row.hidden = true;
  }

  const label = $("#shippingPriceLabel");
  if (label) {
    label.textContent = totals.qualifiesFreeShipping ? "חינם" : money(CONFIG.shippingFlat);
  }
}

/* ---------------------------------------------------------------- משלוח */

function wireShipping() {
  $$('input[name="shipping"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      state.shipping = radio.value;
      const isDelivery = radio.value === "delivery";
      $("#addressFields").style.display = isDelivery ? "" : "none";
      ["city", "street"].forEach((id) => {
        $(`#${id}`).required = isDelivery;
      });
      refreshTotals();
    });
  });
}

/* ---------------------------------------------------------------- קופון */

function wireCoupon() {
  const input = $("#couponInput");
  const status = $("#couponStatus");

  $("#couponApply").addEventListener("click", () => {
    const code = input.value.trim();
    if (!code) return;

    const result = validateCoupon(code);
    if (!result.ok) {
      status.dataset.state = "error";
      status.textContent = result.message;
      return;
    }

    state.coupon = code.toUpperCase();
    status.dataset.state = "success";
    status.textContent = `הקופון הוחל — ${result.rule.label}`;
    input.disabled = true;
    $("#couponApply").disabled = true;
    refreshTotals();
    toast("הקופון הוחל בהצלחה");
  });
}

/* ---------------------------------------------------------------- ולידציה */

const VALIDATORS = {
  firstName: (v) => (v.trim().length >= 2 ? "" : "שם פרטי חייב להכיל לפחות 2 תווים"),
  lastName: (v) => (v.trim().length >= 2 ? "" : "שם משפחה חייב להכיל לפחות 2 תווים"),
  phone: (v) =>
    /^0\d{1,2}-?\d{7}$/.test(v.replace(/[\s-]/g, "").replace(/^(\d{2,3})/, "$1"))
      ? ""
      : "מספר טלפון לא תקין",
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "כתובת אימייל לא תקינה"),
  city: (v) => (v.trim().length >= 2 ? "" : "יש להזין עיר"),
  street: (v) => (v.trim().length >= 2 ? "" : "יש להזין רחוב ומספר"),
};

function validateField(input) {
  const validator = VALIDATORS[input.name];
  if (!validator || !input.required) return true;

  const message = validator(input.value);
  const errorEl = $(`.field-error[data-for="${input.name}"]`);
  if (errorEl) errorEl.textContent = message;
  input.setAttribute("aria-invalid", message ? "true" : "false");
  return !message;
}

function wireValidation() {
  Object.keys(VALIDATORS).forEach((name) => {
    const input = $(`[name="${name}"]`);
    input?.addEventListener("blur", () => validateField(input));
    input?.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") validateField(input);
    });
  });
}

/* ---------------------------------------------------------------- שליחה */

function onSubmit(e) {
  e.preventDefault();

  // ולידציה של כל השדות הרלוונטיים
  const fields = Object.keys(VALIDATORS)
    .map((n) => $(`[name="${n}"]`))
    .filter((el) => el && el.required);

  let firstBad = null;
  fields.forEach((input) => {
    if (!validateField(input) && !firstBad) firstBad = input;
  });

  const terms = $("#terms");
  const termsError = $('.field-error[data-for="terms"]');
  if (!terms.checked) {
    termsError.textContent = "צריך לאשר את התקנון כדי להמשיך";
    if (!firstBad) firstBad = terms;
  } else {
    termsError.textContent = "";
  }

  if (firstBad) {
    firstBad.focus();
    firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("יש שדות שצריך להשלים", "info");
    return;
  }

  const cart = getCart();
  const totals = calcTotals(cart, state.coupon, state.shipping);
  const form = $("#checkoutForm");
  const data = Object.fromEntries(new FormData(form).entries());

  const order = {
    id: newOrderId(),
    createdAt: new Date().toISOString(),
    customer: {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email,
    },
    shipping: {
      method: state.shipping,
      address: state.shipping === "delivery"
        ? { city: data.city, street: data.street, apartment: data.apartment, zip: data.zip }
        : { pickup: CONFIG.pickupLocations[0] },
    },
    notes: data.notes || "",
    items: cart.map((l) => ({
      id: l.id, title: l.title, qty: l.qty, price: l.price, lineTotal: l.price * l.qty,
    })),
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      coupon: totals.coupon?.code ?? null,
      shipping: totals.shipping,
      total: totals.total,
    },
    // מסמן בבירור שלא בוצע חיוב — כדי שלא ייווצר רושם מוטעה בדף הניהול
    payment: { status: "unpaid", provider: null, note: "סליקה טרם חוברה" },
  };

  saveOrder(order);

  // הלקוחה נכנסת לרשימת הלידים, והקופון מסמן שימוש — שניהם נצפים בניהול
  addLead({
    name: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
    email: data.email ?? "",
    phone: data.phone ?? "",
    source: "checkout",
  });
  if (order.totals.coupon) redeemCoupon(order.totals.coupon);

  clearCart();

  // כאן, כשיהיה שרת: שליחת ההזמנה למייל של הלקוחה + הורדת מלאי
  console.info("[LIAD] הזמנה נשמרה מקומית:", order.id);

  window.location.href = `confirmation.html?order=${encodeURIComponent(order.id)}`;
}

document.addEventListener("DOMContentLoaded", init);
