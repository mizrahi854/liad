/* ==========================================================================
   LIAD — לקוח Supabase

   כתוב מאפס מעל fetch, בלי ספריית supabase-js.

   למה: הספרייה הרשמית שוקלת ~120KB ומביאה איתה websockets ו-polyfills
   שאנחנו לא צריכים. Supabase חושף PostgREST רגיל, וכל מה שהאתר עושה
   הוא קריאה, כתיבה והתחברות — שלושתם בקשות HTTP פשוטות. האתר הזה נבנה
   בלי ספריות, ואין סיבה שהחיבור למסד יהיה הדבר שישבור את זה.

   מה יש כאן:
     01. בקשות למסד (select / upsert / update / rpc)
     02. התחברות בעלת החנות (email + password)
     03. רענון אוטומטי של הטוקן

   שגיאות: כל פונקציה זורקת Error עם ההודעה של Supabase, כדי שהקוד
   שקורא לה יוכל להחליט מה להציג. אין כאן שום console.log שקט.
   ========================================================================== */

import { SUPABASE_URL, SUPABASE_ANON_KEY, hasBackend } from "./config.js";

const SESSION_KEY = "liad:session";

/* ==========================================================================
   01. מצב ההתחברות
   ========================================================================== */

/** @typedef {{access_token:string, refresh_token:string, expires_at:number, user:Object}} Session */

/** @type {Session|null} */
let session = readSession();

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(value) {
  session = value;
  try {
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    console.warn("[LIAD] שמירת ההתחברות נכשלה:", err);
  }
  document.dispatchEvent(new CustomEvent("liad:auth", { detail: { session: value } }));
}

/** האם בעלת החנות מחוברת כרגע */
export function isSignedIn() {
  return Boolean(session?.access_token);
}

export function currentUser() {
  return session?.user ?? null;
}

/* ==========================================================================
   02. בקשות
   ========================================================================== */

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    // בלי התחברות פועלים כאנונימיים, וה-RLS מגביל בהתאם
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * בקשה גולמית. מרעננת את הטוקן פעם אחת אם הוא פג ומנסה שוב.
 * @returns {Promise<any>}
 */
async function request(path, options = {}, retry = true) {
  if (!hasBackend()) throw new Error("החיבור למסד הנתונים אינו מוגדר");

  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: headers(options.headers),
  });

  // טוקן שפג — מרעננים פעם אחת ומנסים שוב
  if ((res.status === 401 || res.status === 403) && retry && session?.refresh_token) {
    if (await refresh()) return request(path, options, false);
  }

  if (!res.ok) {
    let message = `שגיאת רשת (${res.status})`;
    try {
      const body = await res.json();
      message = body.message || body.error_description || body.hint || message;
    } catch { /* התשובה לא JSON — נשארים עם ההודעה הכללית */ }
    throw new Error(message);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * שליפה.
 * @param {string} table
 * @param {string} [query] מחרוזת שאילתה של PostgREST, למשל "id=eq.5&select=*"
 */
export function select(table, query = "select=*") {
  return request(`/rest/v1/${table}?${query}`);
}

/**
 * הוספה או עדכון לפי המפתח הראשי.
 * @param {string} table
 * @param {Object|Object[]} rows
 */
export function upsert(table, rows) {
  return request(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
}

/**
 * עדכון שורות קיימות.
 * @param {string} table
 * @param {string} query תנאי סינון, למשל "id=eq.LIAD-1"
 * @param {Object} patch
 */
export function update(table, query, patch) {
  return request(`/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

/**
 * מחיקה.
 * @param {string} table
 * @param {string} query תנאי סינון. חובה — בלעדיו הייתה נמחקת הטבלה כולה.
 */
export function remove(table, query) {
  if (!query) throw new Error("מחיקה בלי תנאי סינון אינה מותרת");
  return request(`/rest/v1/${table}?${query}`, { method: "DELETE" });
}

/** קריאה לפונקציה שרצה בצד השרת */
export function rpc(fn, args = {}) {
  return request(`/rest/v1/rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

/* ==========================================================================
   03. התחברות
   ========================================================================== */

function storeAuth(data) {
  writeSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // שומרים רגע תפוגה מוחלט, כדי לדעת מתי לרענן בלי לנחש
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    user: data.user ?? null,
  });
}

/**
 * התחברות בעלת החנות.
 * @throws {Error} עם הודעה בעברית אם הפרטים שגויים
 */
export async function signIn(email, password) {
  if (!hasBackend()) throw new Error("החיבור למסד הנתונים אינו מוגדר");

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      res.status === 400 ? "אימייל או סיסמה שגויים" : (data.msg || data.error_description || "ההתחברות נכשלה")
    );
  }

  storeAuth(data);
  return data.user;
}

export async function signOut() {
  if (session?.access_token) {
    // אם היציאה בשרת נכשלת, עדיין מוחקים מקומית — עדיף לצאת מאשר להיתקע מחובר
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: headers(),
    }).catch(() => {});
  }
  writeSession(null);
}

/** מרענן את הטוקן. מחזיר true אם הצליח. */
async function refresh() {
  if (!session?.refresh_token) return false;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!res.ok) {
    // ה-refresh token נפסל — ההתחברות פגה באמת
    writeSession(null);
    return false;
  }

  storeAuth(await res.json());
  return true;
}

/**
 * מוודא שהטוקן בתוקף לפני פעולה חשובה.
 * נקרא בעליית מסך הניהול, כדי שלא נגלה שההתחברות פגה רק אחרי שמירה.
 */
export async function ensureSession() {
  if (!session) return false;
  if (Date.now() < session.expires_at - 60_000) return true;
  return refresh();
}

/** מאזין לשינויי התחברות (התחברות, יציאה, פקיעה) */
export function onAuthChange(handler) {
  document.addEventListener("liad:auth", (e) => handler(e.detail.session));
}
