/* ==========================================================================
   LIAD — שכבת הנתונים של מערכת הניהול
   נקודת האמת היחידה לכל מה שהלקוחה משנה בממשק הניהול.

   למה מודול נפרד:
     גם החנות, גם דף הבית וגם הניהול קוראים מכאן. כל השמירה עוברת דרך
     read/write שבתחתית הקובץ, ולכן החלפת מקום האחסון לא דרשה לגעת
     בשום מסך.

   איפה זה נשמר:
     ב-Supabase, דרך js/sync.js. כל שינוי מופיע בכל המכשירים.
     אם החיבור לא הוגדר (liad-shop/js/config.js ריק) הכול נשמר
     בדפדפן בלבד, בדיוק כמו קודם — האתר חייב לעבוד גם ככה.

   מבנה השכבות של הקטלוג:
     קטלוג הבסיס (data/products.json)
       + edits   — שינויים למוצרים קיימים
       + added   — מוצרים חדשים שנוצרו בניהול
       − removed — מוצרים שנמחקו
     = הקטלוג שהחנות מציגה בפועל
   ========================================================================== */

import {
  stateRead, stateWrite,
  ordersCache, saveOrderRemote, patchOrderRemote, fetchOrder as fetchOrderRemote,
  clearOrdersRemote,
  couponsCache, setCouponsCache, saveCouponRemote, deleteCouponRemote,
  fetchLeads, deleteLeadRemote, recordLeadRemote,
} from "./sync.js";

export const ADMIN_KEYS = {
  catalog: "liad:admin-catalog",
  categories: "liad:admin-categories",
  coupons: "liad:admin-coupons",
  homepage: "liad:admin-homepage",
  popups: "liad:admin-popups",
  leads: "liad:leads",
};

/** מקסימום פופאפים פעילים בו-זמנית */
export const MAX_ACTIVE_POPUPS = 5;

/** משודר אחרי כל שינוי, כדי שכל מסך פתוח יתעדכן מיד */
export const ADMIN_EVENT = "liad:admin-change";

/* ==========================================================================
   קטלוג המוצרים
   ========================================================================== */

const EMPTY_CATALOG = { edits: {}, added: [], removed: [] };

export function getCatalogPatch() {
  const patch = read(ADMIN_KEYS.catalog, EMPTY_CATALOG);
  return {
    edits: patch.edits ?? {},
    added: Array.isArray(patch.added) ? patch.added : [],
    removed: Array.isArray(patch.removed) ? patch.removed : [],
  };
}

/**
 * מחיל את שינויי הניהול על קטלוג הבסיס.
 * @param {Array} base המוצרים מ-data/products.json
 * @returns {Array} הקטלוג שהחנות אמורה להציג
 */
export function applyCatalogPatch(base = []) {
  const patch = getCatalogPatch();
  const removed = new Set(patch.removed);

  const merged = base
    .filter((p) => !removed.has(p.id))
    .map((p) => (patch.edits[p.id] ? { ...p, ...patch.edits[p.id] } : p));

  // מוצרים חדשים נכנסים בראש הרשימה, כדי שיהיה קל למצוא אותם
  return [...patch.added.filter((p) => !removed.has(p.id)), ...merged];
}

/**
 * שומר שינוי למוצר קיים, או למוצר חדש שנוצר כאן.
 * @param {string} id
 * @param {Object} fields רק השדות שהשתנו
 */
export function saveProduct(id, fields) {
  const patch = getCatalogPatch();
  const addedIndex = patch.added.findIndex((p) => p.id === id);

  if (addedIndex >= 0) {
    // מוצר שנוצר בניהול נשמר במלואו, בלי שכבת edits מיותרת
    patch.added[addedIndex] = { ...patch.added[addedIndex], ...fields };
  } else {
    patch.edits[id] = { ...(patch.edits[id] ?? {}), ...fields };
  }

  write(ADMIN_KEYS.catalog, patch);
}

/** מוסיף מוצר חדש. מחזיר את המוצר שנוצר. */
export function addProduct(product) {
  const patch = getCatalogPatch();
  const id = product.id || makeId(product.title);

  const record = {
    stock: 0,
    price: 0,
    brand: "",
    category: "gel-polish",
    gallery: [],
    ...product,
    id,
  };

  patch.added.unshift(record);
  // מוצר שנמחק בעבר ונוצר מחדש באותו מזהה — צריך לחזור לחיים
  patch.removed = patch.removed.filter((x) => x !== id);
  write(ADMIN_KEYS.catalog, patch);
  return record;
}

/**
 * מוחק מוצר.
 * מוצר מקטלוג הבסיס לא באמת נמחק מהקובץ — הוא נכנס לרשימת removed,
 * וכך אפשר להחזיר אותו בלי לאבד את הנתונים המקוריים.
 */
export function deleteProduct(id) {
  const patch = getCatalogPatch();
  patch.added = patch.added.filter((p) => p.id !== id);
  delete patch.edits[id];
  if (!patch.removed.includes(id)) patch.removed.push(id);
  write(ADMIN_KEYS.catalog, patch);
}

/** מחזיר מוצר שנמחק */
export function restoreProduct(id) {
  const patch = getCatalogPatch();
  patch.removed = patch.removed.filter((x) => x !== id);
  write(ADMIN_KEYS.catalog, patch);
}

/** מבטל את כל שינויי הקטלוג וחוזר לקובץ המקורי */
export function resetCatalog() {
  write(ADMIN_KEYS.catalog, EMPTY_CATALOG);
}

/* ==========================================================================
   קטגוריות

   הקטגוריות לא נשמרות כרשימה נפרדת אלא נגזרות מהמוצרים — כך אי אפשר
   להגיע למצב של קטגוריה שמופיעה בתפריט ואין בה כלום. מה שנשמר כאן
   הוא רק מה שהלקוחה שינתה: שם התצוגה, הסדר, והאם להסתיר מהחנות.
   ========================================================================== */

/**
 * @typedef {Object} CategoryMeta
 * @property {string} [label]  שם תצוגה חלופי
 * @property {number} [order]  מיקום בתפריט. נמוך = מוקדם
 * @property {boolean} [hidden]
 */

/** @returns {Record<string, CategoryMeta>} */
export function getCategoryMeta() {
  const data = read(ADMIN_KEYS.categories, {});
  return data && typeof data === "object" ? data : {};
}

export function saveCategory(slug, meta) {
  const all = getCategoryMeta();
  all[slug] = { ...(all[slug] ?? {}), ...meta };
  write(ADMIN_KEYS.categories, all);
}

export function resetCategory(slug) {
  const all = getCategoryMeta();
  delete all[slug];
  write(ADMIN_KEYS.categories, all);
}

/**
 * הקטגוריות כפי שהחנות אמורה להציג אותן: עם השם, הכמות והסדר הנכונים.
 * @param {Array} products הקטלוג אחרי שינויי הניהול
 * @param {Record<string,string>} fallbackLabels שמות ברירת המחדל מהקוד
 */
export function listCategories(products = [], fallbackLabels = {}) {
  const meta = getCategoryMeta();
  const counts = new Map();
  products.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1));

  return [...counts.entries()]
    .map(([slug, count]) => ({
      slug,
      count,
      label: meta[slug]?.label || fallbackLabels[slug] || slug,
      hidden: meta[slug]?.hidden === true,
      order: meta[slug]?.order ?? 500,
    }))
    .sort((a, b) => a.order - b.order || b.count - a.count);
}

/* ==========================================================================
   קופונים
   ========================================================================== */

/**
 * @typedef {Object} Coupon
 * @property {string} code
 * @property {"percent"|"fixed"} type
 * @property {number} value
 * @property {string|null} expiresAt   תאריך בפורמט YYYY-MM-DD
 * @property {number|null} maxUses     null = ללא הגבלה
 * @property {number} used
 * @property {boolean} firstOrderOnly
 * @property {boolean} active
 */

/*
 * הקופונים יושבים בטבלה משלהם ולא ב-site_state, כי הצ׳קאאוט צריך לבדוק
 * מולם תוקף ומכסת שימושים — וזו בדיקה שחייבת להיות אמיתית ולא מקומית.
 */
export function getCoupons() {
  const list = couponsCache();
  if (list.length) return list;

  // ברירת מחדל: הקופון שהיה קשיח בקוד, כדי שקמפיין קיים לא ייפול
  const seed = [{
    code: "LIAD10",
    type: "percent",
    value: 10,
    expiresAt: null,
    maxUses: null,
    used: 0,
    firstOrderOnly: true,
    active: true,
    label: "10% לרכישה ראשונה",
  }];
  setCouponsCache(seed);
  return seed;
}

export function saveCoupon(coupon) {
  const list = [...getCoupons()];
  const code = String(coupon.code || "").trim().toUpperCase();
  if (!code) return null;

  const record = {
    type: "percent",
    value: 0,
    expiresAt: null,
    maxUses: null,
    used: 0,
    firstOrderOnly: false,
    active: true,
    ...coupon,
    code,
  };
  record.label = record.label || defaultCouponLabel(record);

  const index = list.findIndex((c) => c.code === code);
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);

  setCouponsCache(list);
  saveCouponRemote(record).catch((err) => console.error("[LIAD] שמירת הקופון נכשלה:", err));
  announce();
  return record;
}

export function deleteCoupon(code) {
  const wanted = String(code).toUpperCase();
  setCouponsCache(getCoupons().filter((c) => c.code !== wanted));
  deleteCouponRemote(wanted).catch((err) => console.error("[LIAD] מחיקת הקופון נכשלה:", err));
  announce();
}

/**
 * בודק קופון מול כל הכללים.
 * @returns {{ok:boolean, reason?:string, coupon?:Coupon}}
 */
export function validateCoupon(code, { firstOrder = false } = {}) {
  const wanted = String(code || "").trim().toUpperCase();
  const coupon = getCoupons().find((c) => c.code === wanted);

  if (!coupon) return { ok: false, reason: "הקוד לא נמצא" };
  if (!coupon.active) return { ok: false, reason: "הקופון אינו פעיל" };

  if (coupon.expiresAt) {
    // סוף היום של תאריך התפוגה — קופון שתקף "עד ה-31" תקף כל ה-31
    const end = new Date(`${coupon.expiresAt}T23:59:59`);
    if (Date.now() > end.getTime()) return { ok: false, reason: "תוקף הקופון פג" };
  }

  if (coupon.maxUses != null && coupon.used >= coupon.maxUses) {
    return { ok: false, reason: "הקופון מוצה" };
  }

  if (coupon.firstOrderOnly && !firstOrder) {
    return { ok: false, reason: "הקופון תקף לרכישה ראשונה בלבד" };
  }

  return { ok: true, coupon };
}

/** מעלה את מונה השימושים אחרי הזמנה שהושלמה */
export function redeemCoupon(code) {
  const list = [...getCoupons()];
  const coupon = list.find((c) => c.code === String(code || "").toUpperCase());
  if (!coupon) return;
  coupon.used = (coupon.used ?? 0) + 1;
  setCouponsCache(list);
  saveCouponRemote(coupon).catch((err) => console.error("[LIAD] עדכון מונה הקופון נכשל:", err));
}

function defaultCouponLabel(c) {
  return c.type === "percent" ? `${c.value}% הנחה` : `${c.value} ₪ הנחה`;
}

/* ==========================================================================
   דף הבית
   ========================================================================== */

/*
 * ה-patch מוחל על data/content.json של דף הבית.
 * שומרים רק את מה ששונה בפועל, כדי שעדכון לקובץ המקורי לא יידרס.
 */
const EMPTY_HOMEPAGE = {
  text: {}, images: {}, sections: {}, order: [], featured: null, banners: [],
};

export function getHomepagePatch() {
  const patch = read(ADMIN_KEYS.homepage, EMPTY_HOMEPAGE);
  return {
    text: patch.text ?? {},
    images: patch.images ?? {},
    sections: patch.sections ?? {},
    order: Array.isArray(patch.order) ? patch.order : [],
    banners: Array.isArray(patch.banners) ? patch.banners : [],
    featured: patch.featured ?? null,
  };
}

export function saveHomepage(partial) {
  write(ADMIN_KEYS.homepage, { ...getHomepagePatch(), ...partial });
}

export function resetHomepage() {
  write(ADMIN_KEYS.homepage, EMPTY_HOMEPAGE);
}

/* ==========================================================================
   פופאפים
   ========================================================================== */

/**
 * @typedef {Object} Popup
 * @property {string} id
 * @property {string} title
 * @property {string} value      הכיתוב הגדול (למשל "10%")
 * @property {string} text
 * @property {string} buttonText
 * @property {string} code       קוד ההנחה שמוצג אחרי ההרשמה
 * @property {{name:boolean,email:boolean,phone:boolean}} fields
 * @property {number} delaySeconds
 * @property {boolean} active
 */

export function getPopups() {
  const list = read(ADMIN_KEYS.popups, null);
  if (Array.isArray(list)) return list;

  const seed = [{
    id: "promo-default",
    title: "הנחה לרכישה הראשונה",
    value: "10%",
    text: "השאירו אימייל וקבלו קוד הנחה חד־פעמי של 10% — ואיתו גם המדריך הדיגיטלי שלנו במתנה.",
    buttonText: "קבלו את הקוד",
    code: "LIAD10",
    fields: { name: false, email: true, phone: false },
    delaySeconds: 45,
    active: true,
  }];
  write(ADMIN_KEYS.popups, seed);
  return seed;
}

/** רק הפופאפים הפעילים, חתוך למקסימום המותר */
export function getActivePopups() {
  return getPopups().filter((p) => p.active).slice(0, MAX_ACTIVE_POPUPS);
}

/**
 * שומר פופאפ.
 * @returns {{ok:boolean, reason?:string}}
 */
export function savePopup(popup) {
  const list = getPopups();
  const id = popup.id || makeId(popup.title || "popup");
  const index = list.findIndex((p) => p.id === id);

  // מגבלת החמישה נאכפת כאן ולא רק ב-UI, כדי שלא ייווצר מצב לא חוקי
  if (popup.active) {
    const activeOthers = list.filter((p) => p.active && p.id !== id).length;
    if (activeOthers >= MAX_ACTIVE_POPUPS) {
      return { ok: false, reason: `אפשר עד ${MAX_ACTIVE_POPUPS} הודעות פעילות. כבו אחת קודם.` };
    }
  }

  const record = {
    fields: { name: false, email: true, phone: false },
    delaySeconds: 45,
    active: true,
    ...popup,
    id,
  };

  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);

  write(ADMIN_KEYS.popups, list);
  return { ok: true };
}

export function deletePopup(id) {
  write(ADMIN_KEYS.popups, getPopups().filter((p) => p.id !== id));
}

/* ==========================================================================
   סטטוס הזמנה

   הלקוחה של החנות משנה את הסטטוס במערכת הניהול, והקונה עוקבת אחריו
   בעמוד המעקב (order.html) לפי מספר ההזמנה.

   הסטטוסים מסודרים לפי סדר ההתקדמות הטבעי, ולכן אפשר לגזור מהם גם את
   שלבי הציר בעמוד המעקב — בלי לתחזק שתי רשימות.
   ========================================================================== */

/** @type {{id:string,label:string,note:string,icon:string}[]} */
export const ORDER_STATUSES = [
  { id: "received",  label: "ההזמנה התקבלה", note: "קיבלנו את ההזמנה והיא ממתינה לטיפול." },
  { id: "preparing", label: "בהכנה",          note: "אורזים את המוצרים שלך." },
  { id: "ready",     label: "מוכנה",          note: "ההזמנה ארוזה וממתינה ליציאה." },
  { id: "shipped",   label: "יצאה למשלוח",    note: "ההזמנה בדרך אלייך." },
  { id: "delivered", label: "נמסרה",          note: "ההזמנה הגיעה. תודה!" },
];

/** סטטוס סיום שאינו חלק מהציר הרגיל */
export const ORDER_CANCELLED = { id: "cancelled", label: "בוטלה", note: "ההזמנה בוטלה." };

export function orderStatusMeta(id) {
  return ORDER_STATUSES.find((s) => s.id === id)
    ?? (id === ORDER_CANCELLED.id ? ORDER_CANCELLED : ORDER_STATUSES[0]);
}

/** ההזמנות שבמטמון — סינכרוני, לשימוש מסכי הניהול */
export function getOrders() {
  return ordersCache();
}

/**
 * מחפש הזמנה לפי מספר. מתעלם מרווחים ומאותיות גדולות/קטנות, כי הקונה
 * מקלידה את המספר ביד מתוך הודעה או מסך.
 *
 * אסינכרוני, כי הקונה עשויה לעקוב ממכשיר אחר לגמרי — ואז ההזמנה
 * קיימת רק בשרת.
 */
export function findOrder(id) {
  return fetchOrderRemote(id);
}

/**
 * מעדכן סטטוס ושומר את ההיסטוריה, כדי שעמוד המעקב יוכל להראות
 * *מתי* כל שלב קרה ולא רק איפה ההזמנה נמצאת עכשיו.
 */
export async function setOrderStatus(id, status, { note = "" } = {}) {
  const order = ordersCache().find((o) => o.id === id);
  if (!order) return null;

  const statusHistory = [
    ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
    { status, note, at: new Date().toISOString() },
  ];

  await patchOrderRemote(id, { status, statusHistory, updatedAt: new Date().toISOString() });
  return { ...order, status, statusHistory };
}

/** שומר הזמנה חדשה */
export function saveOrder(order) {
  return saveOrderRemote(order);
}

export function clearOrders() {
  return clearOrdersRemote();
}

/* ==========================================================================
   לידים
   ========================================================================== */

/**
 * @typedef {Object} Lead
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string} phone
 * @property {string} source   newsletter | popup | checkout
 * @property {string} createdAt
 */

/*
 * רשימת הלקוחות היא נכס עסקי, ולכן היא היחידה שאנונימית לא יכולה
 * לקרוא — גם לא דרך קוד המקור של האתר. הקריאה דורשת התחברות, והכתיבה
 * עוברת דרך פונקציה בשרת שמונעת כפילויות בלי לחשוף שום רשומה.
 */

let leadsCache = [];

/** הרשימה שבמטמון. יש לקרוא ל-loadLeads() לפני, כדי למלא אותה. */
export function getLeads() {
  return leadsCache;
}

/** מושך את רשימת הלקוחות מהשרת */
export async function loadLeads() {
  leadsCache = await fetchLeads();
  return leadsCache;
}

/**
 * רושם ליד. אותו אדם לא נרשם פעמיים —
 * פנייה חוזרת מעדכנת את הרשומה הקיימת ומוסיפה את המקור.
 */
export function addLead({ name = "", email = "", phone = "", source = "newsletter" }) {
  const key = (email || phone).trim().toLowerCase();
  if (!key) return null;

  recordLeadRemote({ name, email, phone, source });

  // מראה מקומי, כדי שהרשימה תתעדכן מיד גם לפני המשיכה הבאה
  const existing = leadsCache.find(
    (l) => (l.email || l.phone || "").trim().toLowerCase() === key
  );

  if (existing) {
    existing.name = name || existing.name;
    existing.phone = phone || existing.phone;
    existing.email = email || existing.email;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  const lead = {
    id: `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    email,
    phone,
    sources: [source],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  leadsCache.unshift(lead);
  return lead;
}

export async function deleteLead(id) {
  leadsCache = leadsCache.filter((l) => l.id !== id);
  await deleteLeadRemote(id);
  announce();
}

/* ==========================================================================
   פרסום — ייצוא וייבוא
   ========================================================================== */

/**
 * מייצר את קובץ הקטלוג המלא להעלאה לשרת.
 * זו הדרך להפוך שינוי מקומי לשינוי שכל הלקוחות רואות.
 */
export function exportCatalog(base = []) {
  return JSON.stringify({ products: applyCatalogPatch(base) }, null, 1);
}

/** גיבוי מלא של כל מה שנוהל כאן */
export function exportAll() {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    catalog: getCatalogPatch(),
    categories: getCategoryMeta(),
    coupons: getCoupons(),
    homepage: getHomepagePatch(),
    popups: getPopups(),
    leads: getLeads(),
  }, null, 1);
}

/** שחזור מגיבוי. מחזיר true אם הקובץ היה תקין. */
export function importAll(json) {
  let data;
  try {
    data = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return false;
  }
  if (!data || typeof data !== "object") return false;

  if (data.catalog) write(ADMIN_KEYS.catalog, data.catalog, { quiet: true });
  if (data.categories) write(ADMIN_KEYS.categories, data.categories, { quiet: true });
  if (data.coupons) write(ADMIN_KEYS.coupons, data.coupons, { quiet: true });
  if (data.homepage) write(ADMIN_KEYS.homepage, data.homepage, { quiet: true });
  if (data.popups) write(ADMIN_KEYS.popups, data.popups, { quiet: true });
  if (data.leads) write(ADMIN_KEYS.leads, data.leads, { quiet: true });

  announce();
  return true;
}

/* ==========================================================================
   שמירה — הנקודה היחידה שתשתנה כשיהיה שרת
   ========================================================================== */

/*
 * שתי הפונקציות האלה הן הגשר אל מסד הנתונים.
 *
 * הן נשארו סינכרוניות בכוונה: כל האתר קורא מהן בלי await, והפיכתן
 * לאסינכרוניות הייתה מחייבת לשכתב כל מסך. במקום זה js/sync.js מחזיק
 * מטמון בזיכרון — קריאה מיידית ממנו, וכתיבה שנדחפת לשרת ברקע.
 *
 * המפתחות כאן נושאים קידומת "liad:" מסיבות היסטוריות; שכבת הסנכרון
 * עובדת בלעדיה, ולכן מסירים אותה כאן במקום אחד.
 */

const bare = (key) => String(key).replace(/^liad:/, "");

function read(key, fallback) {
  return stateRead(bare(key), fallback);
}

function write(key, value, { quiet = false } = {}) {
  stateWrite(bare(key), value, { quiet });
}

function announce() {
  document.dispatchEvent(new CustomEvent(ADMIN_EVENT));
}

/* ---------------------------------------------------------------- עזרים */

/** מזהה יציב מתוך טקסט חופשי, עם סיומת אקראית קצרה נגד התנגשויות */
function makeId(text) {
  const slug = String(text || "item")
    .trim()
    .toLowerCase()
    .replace(/["'׳״]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "item"}-${Math.random().toString(36).slice(2, 6)}`;
}
