/* ==========================================================================
   LIAD — חנות | ליבת החנות
   מודול משותף לכל הדפים: קטלוג, עגלה, מלאי, קופונים, משלוח.

   חשוב: אין התחברות ואין חשבון משתמש. העגלה נשמרת ב-localStorage בלבד.

   הקטלוג והקופונים עוברים דרך js/admin-store.js, כך שמה שמנוהל
   במערכת הניהול משפיע ישירות על מה שהחנות מציגה ומחשבת.
   ========================================================================== */

import { applyCatalogPatch, validateCoupon as checkCoupon } from "./admin-store.js";
import { saveOrderRemote, fetchOrder, ordersCache } from "./sync.js";

/* ---------------------------------------------------------------- הגדרות */

export const CONFIG = {
  currency: "₪",
  freeShippingFrom: 329.9,
  shippingFlat: 29.9,
  pickupLocations: ["מתחם הפיל, בנימינה"],

  storageKeys: {
    cart: "liad:cart",
    orders: "liad:orders",
    promoSeen: "liad:promo-dismissed-at",
    subscribed: "liad:subscribed",
    lastActive: "liad:last-active",
  },
};

/* ---------------------------------------------------------------- עזרים */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function money(value) {
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded)
    ? rounded.toLocaleString("he-IL")
    : rounded.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${text} ${CONFIG.currency}`;
}

export function esc(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function html(strings, ...values) {
  const markup = strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("[LIAD] לא ניתן לשמור ב-localStorage:", err);
  }
}

/* ---------------------------------------------------------------- קטלוג */

let catalogCache = null;

/**
 * טוען את הקטלוג ומחיל עליו את שינויי מערכת הניהול.
 *
 * @param {{raw?: boolean}} [options] raw=true מחזיר את קובץ הבסיס בלי
 *        שינויי הניהול — משמש את מסך הניהול עצמו ואת הייצוא.
 */
export async function loadCatalog({ raw = false } = {}) {
  if (!catalogCache) {
    try {
      const res = await fetch("data/products.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      catalogCache = data.products || [];
    } catch (err) {
      console.error("[LIAD] טעינת הקטלוג נכשלה:", err);
      return null;
    }
  }
  return raw ? catalogCache : applyCatalogPatch(catalogCache);
}

/** מלאי בפועל = המלאי בקטלוג פחות מה שכבר בעגלה */
export function availableStock(product, cart = getCart()) {
  const inCart = cart.find((l) => l.id === product.id)?.qty ?? 0;
  return Math.max(0, (product.stock ?? 0) - inCart);
}

/* ---------------------------------------------------------------- עגלה */

export function getCart() {
  const cart = readJSON(CONFIG.storageKeys.cart, []);
  return Array.isArray(cart) ? cart : [];
}

function saveCart(cart) {
  writeJSON(CONFIG.storageKeys.cart, cart);
  localStorage.setItem(CONFIG.storageKeys.lastActive, String(Date.now()));
  document.dispatchEvent(new CustomEvent("cart:change", { detail: { cart } }));
}

export function addToCart(product, qty = 1) {
  const cart = getCart();
  const line = cart.find((l) => l.id === product.id);
  const stock = product.stock ?? 0;

  const current = line?.qty ?? 0;
  const next = Math.min(current + qty, stock);
  if (next === current) return { ok: false, reason: "out-of-stock" };

  if (line) {
    line.qty = next;
  } else {
    cart.push({
      id: product.id,
      title: product.title,
      price: product.price,
      image: product.image,
      brand: product.brand,
      shade: product.shade ?? null,
      stock,
      qty: next,
    });
  }
  saveCart(cart);
  return { ok: true, qty: next };
}

export function setQty(id, qty) {
  const cart = getCart();
  const line = cart.find((l) => l.id === id);
  if (!line) return;
  const clamped = Math.max(0, Math.min(qty, line.stock ?? 99));
  if (clamped === 0) return removeFromCart(id);
  line.qty = clamped;
  saveCart(cart);
}

export function removeFromCart(id) {
  saveCart(getCart().filter((l) => l.id !== id));
}

export function clearCart() {
  saveCart([]);
}

export function cartCount(cart = getCart()) {
  return cart.reduce((sum, l) => sum + l.qty, 0);
}

/* ---------------------------------------------------------------- חישוב סכום */

export function isFirstOrder() {
  return ordersCache().length === 0;
}

/**
 * מחשב את סכום ההזמנה.
 * @param {string|null} couponCode
 * @param {"delivery"|"pickup"} shippingMethod
 */
export function calcTotals(cart = getCart(), couponCode = null, shippingMethod = "delivery") {
  const subtotal = cart.reduce((sum, l) => sum + l.price * l.qty, 0);

  let discount = 0;
  let coupon = null;

  // הקופונים מנוהלים במערכת הניהול, ולכן הבדיקה עוברת דרכה
  const check = couponCode
    ? checkCoupon(couponCode, { firstOrder: isFirstOrder() })
    : { ok: false };

  if (check.ok) {
    const rule = check.coupon;
    discount = rule.type === "percent" ? (subtotal * rule.value) / 100 : rule.value;
    discount = Math.min(discount, subtotal);
    coupon = { ...rule };
  }

  const afterDiscount = subtotal - discount;

  let shipping = 0;
  if (shippingMethod === "delivery" && cart.length) {
    shipping = afterDiscount >= CONFIG.freeShippingFrom ? 0 : CONFIG.shippingFlat;
  }

  return {
    subtotal,
    discount,
    coupon,
    shipping,
    total: afterDiscount + shipping,
    freeShippingGap: Math.max(0, CONFIG.freeShippingFrom - afterDiscount),
    qualifiesFreeShipping: afterDiscount >= CONFIG.freeShippingFrom,
  };
}

export function validateCoupon(code) {
  const result = checkCoupon(code, { firstOrder: isFirstOrder() });
  return result.ok
    ? { ok: true, rule: result.coupon }
    : { ok: false, message: result.reason };
}

/* ---------------------------------------------------------------- הזמנות */

/*
 * ההזמנות עוברות דרך שכבת הסנכרון: הן נשמרות מקומית מיד וגם נדחפות
 * לשרת, כדי שהן ייראו בניהול ובמעקב מכל מכשיר.
 */
export function saveOrder(order) {
  return saveOrderRemote(order);
}

export function getOrder(id) {
  return fetchOrder(id);
}

export function newOrderId() {
  const now = new Date();
  const stamp = `${now.getFullYear()}`.slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LIAD-${stamp}-${rand}`;
}

/* ---------------------------------------------------------------- Toast */

export function toast(message, icon = "check") {
  let stack = $(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }

  const icons = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    cart: '<path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.1 6h17.8"/><path d="M3.4 5.5a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.7a2 2 0 0 0-.4-1.2l-2-2.7A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  };

  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon] || icons.check}</svg>` +
    `<span>${esc(message)}</span>`;

  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 2600);
}
