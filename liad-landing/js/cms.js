/* ==========================================================================
   LIAD — החלת שינויי מערכת הניהול על דף הבית

   מערכת הניהול (liad-shop/admin.html) שומרת "טלאי" ב-localStorage.
   הקובץ הזה מחיל אותו על הדף בזמן טעינה, ומאזין לשינויים כדי שעריכה
   בטאב אחד תיראה מיד בטאב השני.

   הוא גנרי בכוונה — הוא לא מכיר אף שדה בשמו. מה שקובע הוא מה שמסומן
   ב-HTML:
       data-cms-text="hero.title"     טקסט שניתן לעריכה
       data-cms-image="hero.portrait" תמונה שניתן להחלפה
       data-cms-section="academy"     סקשן שניתן להסתרה ולשינוי סדר

   לכן הוספת שדה חדש לעריכה = תוספת של תכונה אחת ב-HTML ושורה אחת
   ב-liad-shop/js/home-schema.js. אין קוד להוסיף כאן.

   הערה על אחסון: localStorage משותף לכל האתר כי כולו על אותו origin.
   כשיהיה שרת, רק readPatch() כאן ו-write() בצד הניהול יתחלפו בקריאת API.
   ========================================================================== */

const STORAGE_KEY = "liad:admin-homepage";
const POPUPS_KEY = "liad:admin-popups";
const LEADS_KEY = "liad:leads";

/** משודר בתוך אותו טאב; בין טאבים מגיע אירוע storage */
const ADMIN_EVENT = "liad:admin-change";

/* ---------------------------------------------------------------- קריאה */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readPatch() {
  const patch = readJSON(STORAGE_KEY, {});
  return {
    text: patch.text ?? {},
    images: patch.images ?? {},
    sections: patch.sections ?? {},
    order: Array.isArray(patch.order) ? patch.order : [],
    banners: Array.isArray(patch.banners) ? patch.banners : [],
    featured: patch.featured ?? null,
  };
}

/** המוצרים שנבחרו ידנית לקרוסלה — נקרא מ-main.js */
export function featuredIds() {
  const list = readPatch().featured;
  return Array.isArray(list) ? list : null;
}

/* ---------------------------------------------------------------- החלה */

/*
 * הטקסט המקורי נשמר פעם אחת ב-dataset, כדי שאפשר יהיה לחזור אליו
 * כשמוחקים את השינוי בניהול — בלי לרענן את הדף.
 */
function applyText(patch) {
  document.querySelectorAll("[data-cms-text]").forEach((el) => {
    const key = el.dataset.cmsText;
    if (el.dataset.cmsOriginal === undefined) el.dataset.cmsOriginal = el.innerHTML;

    const value = patch.text[key];
    if (value == null || value === "") {
      el.innerHTML = el.dataset.cmsOriginal;
      return;
    }

    // *טקסט* מסומן בזהב — הדרך של הלקוחה להדגיש בלי לדעת HTML
    const gold = (line) =>
      escapeHTML(line).replace(/\*([^*]+)\*/g, '<span class="text-gold-gradient">$1</span>');

    /*
     * כותרות שנפרקות לשורות (data-cms-lines) חייבות לשמור על מבנה
     * ה-.split-line, אחרת אנימציית הכניסה של ה-Hero לא מוצאת מה להנפיש.
     */
    el.innerHTML = "cmsLines" in el.dataset
      ? value.split("\n").filter(Boolean)
          .map((line) => `<span class="split-line">${gold(line)}</span>`).join("")
      : gold(value).replace(/\n/g, "<br>");
  });
}

function applyImages(patch) {
  document.querySelectorAll("[data-cms-image]").forEach((el) => {
    const key = el.dataset.cmsImage;
    if (el.dataset.cmsOriginal === undefined) el.dataset.cmsOriginal = el.getAttribute("src") ?? "";

    const value = patch.images[key];
    const next = value || el.dataset.cmsOriginal;
    if (el.getAttribute("src") !== next) el.setAttribute("src", next);

    // <picture> עם מקור webp היה גובר על ה-src המוחלף
    if (value) el.closest("picture")?.querySelectorAll("source").forEach((s) => s.remove());
  });
}

function applySections(patch) {
  const sections = [...document.querySelectorAll("[data-cms-section]")];
  if (!sections.length) return;

  sections.forEach((el) => {
    el.hidden = patch.sections[el.dataset.cmsSection]?.hidden === true;
  });

  if (!patch.order.length) return;

  /*
   * שינוי סדר: מזיזים את הסקשנים בפועל ב-DOM ולא ב-CSS order.
   * ככה גם עוגנים, גלילה, פרלקסה ו-IntersectionObserver ממשיכים
   * לעבוד נכון — הם מסתמכים על הסדר האמיתי במסמך.
   */
  const parent = sections[0].parentElement;
  const byId = new Map(sections.map((el) => [el.dataset.cmsSection, el]));
  const anchor = sections[0];

  let cursor = anchor;
  patch.order.forEach((id) => {
    const el = byId.get(id);
    if (!el) return;
    parent.insertBefore(el, cursor);
    cursor = el.nextSibling;
  });
}

function applyBanners(patch) {
  const viewport = document.querySelector(".announcement__viewport");
  if (!viewport || !patch.banners.length) return;

  const rail = viewport.querySelector("[aria-hidden='true']");
  const readable = viewport.querySelector(".sr-only");
  if (!rail) return;

  rail.innerHTML = patch.banners
    .map((text, i) => `<span class="announcement__slot${i === 0 ? " is-active" : ""}">${escapeHTML(text)}</span>`)
    .join("");
  if (readable) readable.textContent = patch.banners.join(" · ");
}

/* ---------------------------------------------------------------- לידים */

/**
 * רושם ליד מתוך דף הבית, כדי שהוא יופיע ברשימת הלקוחות בניהול.
 * אותה לוגיקה כמו ב-liad-shop/js/admin-store.js, בגרסה מינימלית —
 * דף הבית לא טוען את מודול הניהול כדי להישאר קל ועצמאי.
 */
export function recordLead({ name = "", email = "", phone = "", source = "newsletter" }) {
  const key = (email || phone).trim().toLowerCase();
  if (!key) return;

  const list = readJSON(LEADS_KEY, []);
  const rows = Array.isArray(list) ? list : [];
  const existing = rows.find((l) => (l.email || l.phone || "").trim().toLowerCase() === key);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = name || existing.name;
    existing.phone = phone || existing.phone;
    existing.email = email || existing.email;
    existing.sources = [...new Set([...(existing.sources ?? []), source])];
    existing.updatedAt = now;
  } else {
    rows.unshift({
      id: `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name, email, phone, sources: [source], createdAt: now, updatedAt: now,
    });
  }

  try {
    localStorage.setItem(LEADS_KEY, JSON.stringify(rows));
  } catch (err) {
    console.warn("[LIAD] שמירת הליד נכשלה:", err);
  }
}

/** ההודעות הקופצות שהוגדרו בניהול, או null אם לא הוגדר דבר */
export function activePopups() {
  const list = readJSON(POPUPS_KEY, null);
  if (!Array.isArray(list)) return null;
  const active = list.filter((p) => p.active);
  return active.length ? active : null;
}

/* ---------------------------------------------------------------- הפעלה */

export function initCms() {
  const apply = () => {
    const patch = readPatch();
    applyText(patch);
    applyImages(patch);
    applySections(patch);
    applyBanners(patch);
  };

  apply();

  // עריכה באותו טאב
  document.addEventListener(ADMIN_EVENT, apply);
  // עריכה בטאב אחר (מסך הניהול פתוח לצד האתר)
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === POPUPS_KEY) apply();
  });
}

/* ---------------------------------------------------------------- עזרים */

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
