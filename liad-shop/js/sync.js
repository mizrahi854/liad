/* ==========================================================================
   LIAD — סנכרון בין המכשירים

   הבעיה שזה פותר: עד עכשיו כל מה שנערך בניהול נשמר בדפדפן אחד בלבד.
   מכאן והלאה הכול נשמר ב-Supabase, וכל מכשיר רואה את אותו דבר.

   העיקרון המרכזי: **מטמון בזיכרון, כתיבה מיידית, דחיפה ברקע.**

     קריאה  — מהמטמון. מיידית, ולכן כל הקוד הקיים באתר נשאר סינכרוני
              ולא היה צריך לשכתב אותו.
     כתיבה  — נכנסת למטמון ול-localStorage מיד, והמסך מתעדכן בו ברגע.
              במקביל יוצאת בקשה לשרת. אם היא נכשלת — היא נשמרת בתור
              וננסה שוב, כך שניתוק רשת של רגע לא מאבד עריכה.
     משיכה  — כל SYNC_INTERVAL, וגם כשחוזרים לטאב. כך עריכה בטלפון
              מופיעה במחשב בלי לרענן.

   בלי חיבור מוגדר (config.js ריק) הכול עובד בדיוק כמו קודם — שמירה
   מקומית בלבד. שום דבר לא נשבר, וזה מכוון: האתר חייב לעבוד גם לפני
   שמישהו טרח לחבר מסד נתונים.
   ========================================================================== */

import { hasBackend, SYNC_INTERVAL } from "./config.js";
import { select, upsert, update, remove, rpc, isSignedIn } from "./supabase.js";

/** מפתחות התוכן שנשמרים ב-site_state */
export const STATE_KEYS = [
  "admin-catalog",
  "admin-categories",
  "admin-homepage",
  "admin-popups",
];

/** משודר אחרי כל שינוי — מקומי או מרחוק */
export const SYNC_EVENT = "liad:admin-change";

/** משודר כשמצב החיבור משתנה, כדי שהניהול יוכל להראות אותו */
export const SYNC_STATUS_EVENT = "liad:sync-status";


/* ==========================================================================
   מצב
   ========================================================================== */

/** @type {Map<string, any>} */
const cache = new Map();

/** @type {Object[]} */
let orders = [];

/** @type {Object[]} */
let coupons = [];

/** עריכות שטרם הגיעו לשרת. key -> value */
const pending = new Map();

let status = { online: hasBackend(), pushing: false, error: null, lastSync: null };
let timer = null;

function announce() {
  document.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

function setStatus(patch) {
  status = { ...status, ...patch };
  document.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: status }));
}

export const syncStatus = () => status;


/* ==========================================================================
   אחסון מקומי — גיבוי, וגם המצב היחיד כשאין חיבור
   ========================================================================== */

function localRead(key, fallback) {
  try {
    const raw = localStorage.getItem(`liad:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function localWrite(key, value) {
  try {
    localStorage.setItem(`liad:${key}`, JSON.stringify(value));
  } catch (err) {
    // המקרה הריאלי: מכסת האחסון נגמרה בגלל תמונות שהועלו כ-data URL
    console.error("[LIAD] השמירה המקומית נכשלה:", err);
    throw new Error("אין מספיק מקום אחסון בדפדפן. נסו למחוק תמונות כבדות.");
  }
}


/* ==========================================================================
   תוכן האתר — קריאה וכתיבה
   ========================================================================== */

/**
 * קריאה סינכרונית מהמטמון.
 * לפני שהסנכרון הראשון הסתיים מוחזר מה שיש מקומית, כדי שהדף לא יהבהב.
 *
 * הבדיקה היא על undefined ולא על cache.has: ערך undefined במטמון פירושו
 * "עוד לא נקרא", ואם נחזיר אותו כמות שהוא נדרוס את ברירת המחדל שהקורא
 * ביקש — וכל מי שמצפה לאובייקט יקבל undefined ויתפוצץ.
 */
export function stateRead(key, fallback) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const local = localRead(key, fallback);
  if (local !== undefined) cache.set(key, local);
  return local;
}

/**
 * כתיבה. נכנסת מיד למטמון ולמקומי, ונדחפת לשרת ברקע.
 * @param {boolean} [quiet] בלי לשדר אירוע — לשימוש בייבוא מרוכז
 */
export function stateWrite(key, value, { quiet = false } = {}) {
  cache.set(key, value);
  localWrite(key, value);

  if (hasBackend()) {
    pending.set(key, value);
    flush();
  }

  if (!quiet) announce();
}

/** דוחף לשרת את כל מה שממתין. בטוח לקרוא לו שוב ושוב. */
async function flush() {
  if (!hasBackend() || status.pushing || !pending.size) return;

  setStatus({ pushing: true });
  const batch = [...pending.entries()];

  try {
    await upsert("site_state", batch.map(([key, value]) => ({ key, value })));
    batch.forEach(([key, value]) => {
      // מוחקים רק אם לא נכתב ערך חדש יותר בזמן שהבקשה רצה
      if (pending.get(key) === value) pending.delete(key);
    });
    setStatus({ pushing: false, error: null, lastSync: Date.now() });
  } catch (err) {
    console.error("[LIAD] הדחיפה לשרת נכשלה:", err);
    setStatus({ pushing: false, error: err.message });
    // נשארים בתור, וננסה שוב במחזור הבא
  }
}


/* ==========================================================================
   משיכה מהשרת
   ========================================================================== */

/** מושך את תוכן האתר. לא דורס עריכות שעדיין ממתינות לדחיפה. */
async function pullState() {
  const rows = await select("site_state", "select=key,value");
  let changed = false;

  rows.forEach(({ key, value }) => {
    if (pending.has(key)) return;
    if (JSON.stringify(cache.get(key)) === JSON.stringify(value)) return;
    cache.set(key, value);
    localWrite(key, value);
    changed = true;
  });

  return changed;
}

async function pullCoupons() {
  const rows = await select("coupons", "select=*&order=created_at.asc");
  const next = rows.map(fromCouponRow);
  const changed = JSON.stringify(next) !== JSON.stringify(coupons);
  coupons = next;
  localWrite("admin-coupons", coupons);
  return changed;
}

/** ההזמנות נמשכות רק כשבעלת החנות מחוברת — לקונה אין גישה לרשימה */
async function pullOrders() {
  if (!isSignedIn()) return false;
  const rows = await select("orders", "select=*&order=created_at.desc&limit=500");
  const next = rows.map(fromOrderRow);
  const changed = JSON.stringify(next) !== JSON.stringify(orders);
  orders = next;
  localWrite("orders", orders);
  return changed;
}

/**
 * מחזור סנכרון אחד.
 * @param {{silent?: boolean}} [options] silent — בלי לשדר אירוע ריענון
 */
export async function pull({ silent = false } = {}) {
  if (!hasBackend()) return false;

  try {
    const results = await Promise.all([pullState(), pullCoupons(), pullOrders()]);
    setStatus({ online: true, error: null, lastSync: Date.now() });
    const changed = results.some(Boolean);
    if (changed && !silent) announce();
    return changed;
  } catch (err) {
    console.error("[LIAD] המשיכה מהשרת נכשלה:", err);
    setStatus({ online: false, error: err.message });
    return false;
  }
}


/* ==========================================================================
   הזמנות
   ========================================================================== */

const toOrderRow = (o) => ({
  id: o.id,
  created_at: o.createdAt,
  customer: o.customer ?? {},
  shipping: o.shipping ?? {},
  items: o.items ?? [],
  totals: o.totals ?? {},
  payment: o.payment ?? {},
  notes: o.notes ?? "",
  status: o.status ?? "received",
  status_history: o.statusHistory ?? [],
});

const fromOrderRow = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  customer: r.customer,
  shipping: r.shipping,
  items: r.items,
  totals: r.totals,
  payment: r.payment,
  notes: r.notes,
  status: r.status,
  statusHistory: r.status_history ?? [],
});

/** ההזמנות שבמטמון — סינכרוני, לשימוש מסך הניהול */
export const ordersCache = () => orders;

/** שומר הזמנה חדשה. נשמרת מקומית תמיד, ובשרת אם הוא מחובר. */
export async function saveOrderRemote(order) {
  orders = [order, ...orders.filter((o) => o.id !== order.id)];
  localWrite("orders", orders);

  if (hasBackend()) {
    try {
      await upsert("orders", toOrderRow(order));
      setStatus({ online: true, error: null });
    } catch (err) {
      // ההזמנה לא תאבד: היא שמורה מקומית, ותיסנכרן בפעם הבאה
      console.error("[LIAD] שמירת ההזמנה בשרת נכשלה:", err);
      setStatus({ online: false, error: err.message });
    }
  }

  announce();
  return order;
}

/** מעדכן סטטוס. דורש התחברות — RLS חוסם אנונימיים. */
export async function patchOrderRemote(id, patch) {
  orders = orders.map((o) => (o.id === id ? { ...o, ...patch } : o));
  localWrite("orders", orders);

  if (hasBackend()) {
    await update("orders", `id=eq.${encodeURIComponent(id)}`, {
      status: patch.status,
      status_history: patch.statusHistory,
    });
  }

  announce();
}

/**
 * מחפש הזמנה אחת לפי מספר — זה מה שדף המעקב עושה.
 * חיפוש בשרת קודם, כי הקונה עשויה לעקוב ממכשיר אחר לגמרי.
 */
export async function fetchOrder(id) {
  const wanted = String(id || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!wanted) return null;

  if (hasBackend()) {
    try {
      const rows = await select("orders", `id=eq.${encodeURIComponent(wanted)}&select=*&limit=1`);
      if (rows.length) return fromOrderRow(rows[0]);
    } catch (err) {
      console.error("[LIAD] חיפוש ההזמנה בשרת נכשל:", err);
    }
  }

  // גיבוי: אולי ההזמנה בוצעה במכשיר הזה ועוד לא הספיקה להסתנכרן
  const local = localRead("orders", []);
  return (Array.isArray(local) ? local : [])
    .find((o) => String(o.id).toUpperCase().replace(/\s+/g, "") === wanted) ?? null;
}

export async function clearOrdersRemote() {
  orders = [];
  localWrite("orders", []);
  if (hasBackend()) await remove("orders", "id=neq.__none__");
  announce();
}


/* ==========================================================================
   קופונים
   ========================================================================== */

const toCouponRow = (c) => ({
  code: c.code,
  type: c.type,
  value: c.value,
  label: c.label ?? null,
  expires_at: c.expiresAt || null,
  max_uses: c.maxUses ?? null,
  used: c.used ?? 0,
  first_order_only: Boolean(c.firstOrderOnly),
  active: c.active !== false,
});

const fromCouponRow = (r) => ({
  code: r.code,
  type: r.type,
  value: Number(r.value),
  label: r.label ?? "",
  expiresAt: r.expires_at,
  maxUses: r.max_uses,
  used: r.used ?? 0,
  firstOrderOnly: r.first_order_only,
  active: r.active,
});

export const couponsCache = () => coupons;

export function setCouponsCache(list) {
  coupons = list;
  localWrite("admin-coupons", list);
}

export async function saveCouponRemote(coupon) {
  if (!hasBackend()) return;
  await upsert("coupons", toCouponRow(coupon));
}

export async function deleteCouponRemote(code) {
  if (!hasBackend()) return;
  await remove("coupons", `code=eq.${encodeURIComponent(code)}`);
}


/* ==========================================================================
   לידים
   ========================================================================== */

/**
 * רושם ליד.
 *
 * עובר דרך פונקציה בצד השרת ולא דרך INSERT ישיר, כי כדי למנוע כפילות
 * צריך לקרוא את הרשימה — ולקונה אין (ובצדק) הרשאת קריאה לרשימת
 * הלקוחות. הפונקציה עושה את ההשוואה בשרת ולא מחזירה כלום.
 */
export async function recordLeadRemote({ name = "", email = "", phone = "", source = "newsletter" }) {
  if (!hasBackend()) return;
  try {
    await rpc("record_lead", { p_name: name, p_email: email, p_phone: phone, p_source: source });
  } catch (err) {
    console.error("[LIAD] רישום הליד בשרת נכשל:", err);
  }
}

/** רשימת הלקוחות — רק לבעלת החנות */
export async function fetchLeads() {
  if (!hasBackend() || !isSignedIn()) return localRead("leads", []);
  const rows = await select("leads", "select=*&order=created_at.desc&limit=1000");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    sources: r.sources ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function deleteLeadRemote(id) {
  if (!hasBackend()) return;
  await remove("leads", `id=eq.${encodeURIComponent(id)}`);
}


/* ==========================================================================
   הפעלה
   ========================================================================== */

/**
 * מפעיל את הסנכרון. בטוח לקרוא לו מכל דף.
 * @param {{orders?: boolean}} [options]
 */
export async function initSync() {
  /*
   * המטמון של site_state מתמלא מעצמו בקריאה הראשונה, ולכן אין כאן
   * טעינה מוקדמת: כל קורא מביא איתו את ברירת המחדל שלו, וטעינה מראש
   * הייתה מאבדת אותה.
   */
  coupons = localRead("admin-coupons", []) ?? [];
  orders = localRead("orders", []) ?? [];

  if (!hasBackend()) {
    setStatus({ online: false, error: null });
    return false;
  }

  const ok = await pull({ silent: true });

  // משיכה תקופתית — רק כשהטאב באמת מולנו
  clearInterval(timer);
  timer = setInterval(() => {
    if (!document.hidden) pull();
    flush();
  }, SYNC_INTERVAL);

  // חזרה לטאב אחרי שהיינו במקום אחר — בודקים מיד
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { pull(); flush(); }
  });

  // חזרה מניתוק רשת
  window.addEventListener("online", () => { pull(); flush(); });

  return ok;
}
