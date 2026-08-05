import { initShadeShowcase } from './shade-showcase.js';
import { initMotion, refreshMotion } from './motion.js';
import { initHero } from './hero.js';
import { createCarousel } from './carousel.js';
import { initAccessibility } from './accessibility.js';
import { initCms, featuredIds, recordLead, activePopups } from './cms.js';

/* ==========================================================================
   LIAD — דף כניסה
   כל הלוגיקה של הדף. ללא ספריות חיצוניות.

   האנימציות והגלילה יושבות ב-js/motion.js, ה-Hero ב-js/hero.js
   והקרוסלה ב-js/carousel.js. כאן נשארת רק לוגיקת התוכן והממשק.

   תוכן עניינים:
   01. הגדרות
   02. עזרים
   03. טעינת התוכן
   04. רינדור אזורים (מוצרים, קטגוריות, טיפים, שאלות, סניפים, סרטונים)
   05. ניווט (הדר, תפריט מובייל, שורת הכרזות)
   06. שאלות נפוצות (אקורדיון)
   07. קרוסלת סרטונים
   08. טפסים — ניוזלטר + מתנה דיגיטלית
   09. פופאפ הנחה
   10. הפעלה
   ========================================================================== */

/* ==========================================================================
   01. הגדרות
   ========================================================================== */

/**
 * כתובת ה-API שאליה נשלחים לידים (מייל של לקוחה שנרשמה).
 *
 * חשוב: כל עוד הערך הוא null — שום מייל לא באמת נשלח.
 * הטופס רק מדמה הצלחה כדי שתראו את חוויית המשתמש.
 *
 * כדי להפעיל באמת צריך שרת / שירות דיוור (Brevo, MailerLite, Make, n8n וכו').
 * שימו כאן את כתובת ה-endpoint, למשל:
 *   const LEAD_ENDPOINT = "https://api.example.com/leads";
 */
const LEAD_ENDPOINT = null;

const STORAGE_KEYS = {
  promoSeen: "liad:promo-dismissed-at",
  popupsSeen: "liad:popups-dismissed",
  subscribed: "liad:subscribed",
};

// מסמן שה-JS פעיל, כדי שאנימציות החשיפה יופעלו.
// אם השורה הזו לא רצה — התוכן פשוט מוצג ללא אנימציה, במקום להישאר מוסתר.
document.documentElement.classList.add("js");


/* ==========================================================================
   02. עזרים
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** בונה אלמנט מ-HTML string */
function html(strings, ...values) {
  const markup = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "");
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content;
}

/** מנקה טקסט לפני הזרקה ל-HTML */
function esc(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** מציג מחיר בשקלים */
function formatPrice(value) {
  return `${new Intl.NumberFormat("he-IL").format(value)} ₪`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim());
}


/* ==========================================================================
   03. טעינת התוכן
   ========================================================================== */

async function loadContent() {
  try {
    const res = await fetch("data/content.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("[LIAD] לא הצלחתי לטעון את data/content.json:", err);
    showLoadError();
    return null;
  }
}

/** מוצג רק אם הקובץ נכשל בטעינה — בדרך כלל כי פתחו את index.html ישירות (file://) */
function showLoadError() {
  const track = $("#productTrack");
  if (!track) return;
  track.append(html`
    <div style="padding:2rem;border:1px dashed var(--border);text-align:center;color:var(--muted-foreground)">
      <p style="font-weight:600;color:var(--foreground)">התוכן לא נטען</p>
      <p style="margin-top:.5rem;font-size:.875rem">
        צריך להריץ את הדף דרך שרת מקומי (ולא לפתוח את הקובץ ישירות).<br>
        ב-VS Code: לחצו ימני על <code>index.html</code> ← <strong>Open with Live Server</strong>.
      </p>
    </div>
  `);
}


/* ==========================================================================
   04. רינדור אזורים
   ========================================================================== */

/** מחליף את כל הקישורים לחנות/אקדמיה בכתובות מ-content.json */
function applySiteLinks(links = {}) {
  if (links.shop) $$("[data-site-shop]").forEach((a) => (a.href = links.shop));
  if (links.academy) $$("[data-site-academy]").forEach((a) => (a.href = links.academy));
  if (links.booking) $$("[data-site-booking]").forEach((a) => (a.href = links.booking));
}

/* ==========================================================================
   קרוסלת המוצרים

   שני מקורות, בכוונה:
     1. content.json — המוצרים שנבחרו ידנית, עם תגית ("רב מכר") ומחיר מבצע.
        הם תמיד ראשונים, כי הם מה שהלקוחה רוצה לדחוף.
     2. קטלוג החנות — עוד מוצרים, כדי שהרצועה תמשיך להתחלף ולא תציג
        את אותם שמונה מוצרים לנצח.

   הבחירה מהקטלוג מסתובבת לפי היום בשנה, כך שמי שנכנסת מחר רואה
   מוצרים אחרים — בלי שרת ובלי אקראיות שמקפיצה את הדף בכל רענון.
   ========================================================================== */

/** כמה מוצרים נוספים לשלוף מהקטלוג אל הקרוסלה */
const CAROUSEL_EXTRA = 16;

/** טוען את קטלוג החנות. נכשל בשקט — הקרוסלה עובדת גם בלעדיו. */
async function loadShopProducts() {
  try {
    const res = await fetch("../liad-shop/data/products.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.products) ? data.products : [];
  } catch {
    // הדף רץ לבדו (בלי תיקיית החנות לצדו) — ממשיכים עם המוצרים הידניים
    return [];
  }
}

/** מספר יציב שמתחלף פעם ביום, לסבב המוצרים */
function daySeed() {
  return Math.floor(Date.now() / 864e5);
}

/** ממיר מוצר מהקטלוג לצורת הכרטיס שהקרוסלה מציגה */
function toCard(p) {
  return {
    brand: p.brand,
    title: p.title,
    description: p.shade ? `גוון ${p.shade}` : (p.line ?? ""),
    price: p.price,
    compareAt: null,
    badge: null,
    inStock: (p.stock ?? 0) > 0,
    image: `../liad-shop/${p.image}`,
    href: `../liad-shop/product.html?id=${encodeURIComponent(p.id)}`,
  };
}

/**
 * בונה את רשימת הקרוסלה: המוצרים הידניים קודם, ואחריהם מוצרים
 * מהקטלוג — מגוונים בין מותגים, כדי שלא ייווצר רצף של אותו קו.
 *
 * אם נבחרו מוצרים במערכת הניהול, הם מחליפים את הרשימה הידנית.
 */
function buildCarouselList(curated = [], catalog = []) {
  const chosen = featuredIds();
  if (chosen?.length) {
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const picked = chosen.map((id) => byId.get(id)).filter(Boolean).map(toCard);
    if (picked.length) curated = picked;
  }

  const seen = new Set(curated.map((p) => p.href));
  const seed = daySeed();

  // מקבצים לפי מותג ושולפים לסירוגין, כך שהרצועה נראית מגוונת
  const byBrand = new Map();
  catalog
    .filter((p) => (p.stock ?? 0) > 0 && p.image && p.price)
    .forEach((p) => {
      const list = byBrand.get(p.brand) || [];
      list.push(p);
      byBrand.set(p.brand, list);
    });

  const brands = [...byBrand.keys()].sort();
  const extra = [];
  let round = 0;

  while (extra.length < CAROUSEL_EXTRA && round < 200) {
    let added = false;
    for (const brand of brands) {
      const list = byBrand.get(brand);
      if (!list.length) continue;
      const p = list[(seed * 7 + round * 13) % list.length];
      list.splice(list.indexOf(p), 1);
      const card = toCard(p);
      if (seen.has(card.href)) continue;
      seen.add(card.href);
      extra.push(card);
      added = true;
      if (extra.length >= CAROUSEL_EXTRA) break;
    }
    if (!added) break;
    round += 1;
  }

  return [...curated, ...extra];
}

/*
 * כרטיס המוצר בקרוסלה: קטן, מלבני ונקי — התמונה למעלה, שלוש שורות טקסט
 * למטה, וכל הכרטיס הוא קישור לדף המוצר עצמו.
 */
function renderProducts(products = []) {
  const track = $("#productTrack");
  if (!track) return;

  products.forEach((p) => {
    const badge = p.badge
      ? `<span class="pcard__badge">${esc(p.badge)}</span>`
      : "";

    const stock = p.inStock
      ? ""
      : `<span class="pcard__stock">אזל מהמלאי</span>`;

    const compareAt = p.compareAt
      ? ` <del>${formatPrice(p.compareAt)}</del>`
      : "";

    track.append(html`
      <a class="pcard" href="${esc(p.href)}">
        <span class="pcard__media media-frame">
          <img src="${esc(p.image)}" alt="${esc(p.title)}" width="600" height="600" loading="lazy" decoding="async">
          ${badge}
          ${stock}
        </span>
        <span class="pcard__body">
          <span class="pcard__brand">${esc(p.brand)}</span>
          <span class="pcard__title">${esc(p.title)}</span>
          <span class="pcard__desc">${esc(p.description)}</span>
          <span class="pcard__price">${formatPrice(p.price)}${compareAt}</span>
        </span>
      </a>
    `);
  });
}

function renderChips(chips = []) {
  const list = $("#chipList");
  if (!list) return;
  chips.forEach((c) => {
    list.append(html`<a class="chip" href="${esc(c.href)}">${esc(c.label)}</a>`);
  });
}

function renderCategories(categories = []) {
  const grid = $("#categoryGrid");
  if (!grid) return;

  categories.forEach((c, i) => {
    // אין תמונה לקטגוריה? מציגים רקע זהב עדין במקום תמונה שבורה.
    const media = c.image
      ? `<img src="${esc(c.image)}" alt="${esc(c.title)}" loading="lazy" decoding="async" data-parallax="-0.04">`
      : `<span class="category-card__blank"></span>`;

    const count = c.count
      ? `<span class="category-card__count">${esc(c.count)}</span>`
      : "";

    grid.append(html`
      <a class="category-card" href="${esc(c.href)}"
         data-reveal="deep" data-reveal-delay="${(i % 3) * 0.08}" data-tilt="6">
        <span class="category-card__media media-frame">${media}</span>
        <span class="category-card__overlay"></span>
        <span class="category-card__body">
          <span class="category-card__title">${esc(c.title)}</span>
          ${count}
        </span>
        <span class="category-card__arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
          </svg>
        </span>
      </a>
    `);
  });
}

function renderJournal(posts = []) {
  const grid = $("#journalGrid");
  if (!grid) return;

  posts.forEach((post, i) => {
    grid.append(html`
      <a class="journal-card" href="${esc(post.href)}" data-reveal="up" data-reveal-delay="${i * 0.1}" data-tilt="4">
        <span class="journal-card__media media-frame">
          <img src="${esc(post.image)}" alt="${esc(post.title)}" loading="lazy" decoding="async" data-parallax="-0.05">
          <span class="journal-card__index">0${i + 1}</span>
        </span>
        <span class="journal-card__meta">${esc(post.category)} · ${esc(post.readTime)}</span>
        <span class="journal-card__title">${esc(post.title)}</span>
        <span class="journal-card__excerpt">${esc(post.excerpt)}</span>
        <span class="journal-card__more">
          לקריאה
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
          </svg>
        </span>
      </a>
    `);
  });
}

function renderFaq(items = []) {
  const list = $("#faqList");
  if (!list) return;

  items.forEach((item, i) => {
    const id = `faq-panel-${i}`;
    list.append(html`
      <div class="faq__item" data-state="closed">
        <h3>
          <button class="faq__trigger" type="button" aria-expanded="false" aria-controls="${id}">
            ${esc(item.q)}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
        </h3>
        <div class="faq__panel" id="${id}" role="region">
          <div class="faq__panel-inner"><p>${esc(item.a)}</p></div>
        </div>
      </div>
    `);
  });
}

function renderLocations(locations = []) {
  const list = $("#locationList");
  if (!list) return;

  const pin = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;
  const clock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
  const nav = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`;

  locations.forEach((loc, i) => {
    const note = loc.note ? `<p class="location__note">${esc(loc.note)}</p>` : "";
    list.append(html`
      <div class="location" data-reveal="up" data-reveal-delay="${i * 0.12}" data-tilt="4">
        <span class="location__number" aria-hidden="true">0${i + 1}</span>
        <p class="location__city">${esc(loc.city ?? "")}</p>
        <h3 class="location__name">${esc(loc.name)}</h3>
        <div class="location__details">
          <p class="location__row">${pin}${esc(loc.address)}</p>
          <p class="location__row">${clock}${esc(loc.hours)}</p>
          ${note}
        </div>
        <div class="location__actions">
          <a class="location__link location__link--solid" href="${esc(loc.waze)}" target="_blank" rel="noopener noreferrer">${nav} ניווט ב-Waze</a>
          <a class="location__link location__link--outline" href="${esc(loc.googleMaps)}" target="_blank" rel="noopener noreferrer">${pin} Google Maps</a>
        </div>
      </div>
    `);
  });
}

function renderReels(testimonials = []) {
  const track = $("#reelsTrack");
  if (!track) return;

  const play = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>`;
  const muteIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>`;

  testimonials.forEach((t, i) => {
    track.append(html`
      <div class="reel${i === 0 ? " is-active" : ""}">
        <div class="reel__stage">
          <img class="reel__backdrop" src="${esc(t.backdrop)}" alt="" aria-hidden="true" loading="${i < 2 ? "eager" : "lazy"}" decoding="async">
          <img class="reel__poster" src="${esc(t.poster)}" alt="" aria-hidden="true" loading="${i < 2 ? "eager" : "lazy"}" decoding="async">
          <video class="reel__video" src="${esc(t.video)}" muted playsinline loop preload="none" disablepictureinpicture></video>

          <button class="reel__play" type="button" aria-label="הפעלת הסרטון">
            <span class="reel__play-circle">${play}</span>
          </button>

          <div class="reel__tools">
            <button class="reel__tool reel__tool--sound" type="button" aria-label="הפעלת סאונד">${muteIcon}</button>
          </div>
        </div>
      </div>
    `);
  });
}


/* ==========================================================================
   05. ניווט
   ========================================================================== */

function initHeader() {
  const header = $("#siteHeader");
  if (!header) return;
  const onScroll = () => {
    header.dataset.scrolled = window.scrollY > 8 ? "true" : "false";
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function initMobileNav() {
  const toggle = $("#navToggle");
  const panel = $("#navMobile");
  const close = $("#navClose");
  if (!toggle || !panel) return;

  const open = () => {
    panel.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  };
  const shut = () => {
    panel.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  };

  toggle.addEventListener("click", open);
  close?.addEventListener("click", shut);
  $$("a", panel).forEach((a) => a.addEventListener("click", shut));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) shut();
  });
}

function initAnnouncement() {
  const slots = $$(".announcement__slot");
  if (slots.length < 2) return;
  let index = slots.findIndex((s) => s.classList.contains("is-active"));
  if (index < 0) index = 0;

  setInterval(() => {
    slots[index].classList.remove("is-active");
    index = (index + 1) % slots.length;
    slots[index].classList.add("is-active");
  }, 3800);
}


/* ==========================================================================
   06. שאלות נפוצות
   ========================================================================== */

function initFaq() {
  const list = $("#faqList");
  if (!list) return;

  const panelOf = (item) => $(".faq__panel", item);
  const contentHeight = (item) => $(".faq__panel-inner", item).offsetHeight;

  const close = (item) => {
    item.dataset.state = "closed";
    $(".faq__trigger", item)?.setAttribute("aria-expanded", "false");
    panelOf(item).style.height = "0px";
  };

  const open = (item) => {
    item.dataset.state = "open";
    $(".faq__trigger", item)?.setAttribute("aria-expanded", "true");
    panelOf(item).style.height = `${contentHeight(item)}px`;
  };

  list.addEventListener("click", (e) => {
    const trigger = e.target.closest(".faq__trigger");
    if (!trigger) return;

    const item = trigger.closest(".faq__item");
    const wasOpen = item.dataset.state === "open";

    // אקורדיון: פותחים אחד, סוגרים את השאר
    $$(".faq__item", list).forEach(close);
    if (!wasOpen) open(item);
  });

  // אם רוחב החלון משתנה, גובה הטקסט משתנה — מעדכנים את הפתוח
  window.addEventListener("resize", () => {
    const openItem = $('.faq__item[data-state="open"]', list);
    if (openItem) panelOf(openItem).style.height = `${contentHeight(openItem)}px`;
  });
}


/* ==========================================================================
   07. קרוסלת סרטונים
   ========================================================================== */

function initReels() {
  const track = $("#reelsTrack");
  if (!track) return;

  const reels = $$(".reel", track);
  if (!reels.length) return;

  // סימון הסרטון שנמצא במרכז
  const markActive = () => {
    const center = track.getBoundingClientRect().left + track.clientWidth / 2;
    let closest = reels[0];
    let min = Infinity;
    reels.forEach((reel) => {
      const box = reel.getBoundingClientRect();
      const dist = Math.abs((box.left + box.right) / 2 - center);
      if (dist < min) { min = dist; closest = reel; }
    });
    reels.forEach((reel) => reel.classList.toggle("is-active", reel === closest));
  };

  let ticking;
  track.addEventListener("scroll", () => {
    cancelAnimationFrame(ticking);
    ticking = requestAnimationFrame(markActive);
  }, { passive: true });
  markActive();

  // חצי ניווט (RTL — הכיוונים הפוכים)
  const step = () => track.clientWidth * 0.5;
  $("#reelPrev")?.addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));
  $("#reelNext")?.addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));

  // הפעלה/עצירה
  reels.forEach((reel) => {
    const video = $("video", reel);
    const playBtn = $(".reel__play", reel);
    const soundBtn = $(".reel__tool--sound", reel);
    if (!video || !playBtn) return;

    const stopOthers = () => {
      reels.forEach((other) => {
        if (other === reel) return;
        const v = $("video", other);
        if (v && !v.paused) { v.pause(); other.classList.remove("is-playing"); }
      });
    };

    const toggle = () => {
      if (video.paused) {
        stopOthers();
        reel.classList.add("is-playing");
        video.play().catch(() => reel.classList.remove("is-playing"));
      } else {
        video.pause();
        reel.classList.remove("is-playing");
      }
    };

    playBtn.addEventListener("click", toggle);
    video.addEventListener("click", toggle);

    soundBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      soundBtn.setAttribute("aria-label", video.muted ? "הפעלת סאונד" : "השתקת סאונד");
    });
  });
}


/* ==========================================================================
   08. טפסים — ניוזלטר + מתנה דיגיטלית
   ========================================================================== */

/**
 * שולח ליד (מייל) לשרת.
 *
 * כרגע, כל עוד LEAD_ENDPOINT הוא null — הפונקציה רק מדמה הצלחה.
 * שום מייל, שום PDF ושום קוד הנחה לא נשלחים בפועל.
 *
 * מה צריך בצד השרת כדי שזה יעבוד באמת:
 *   1. לקבל את המייל ולשמור אותו ברשימת הדיוור
 *   2. לשלוח מייל ובו קובץ ה-PDF במתנה + קוד ההנחה
 *   3. להנפיק קוד חד-פעמי שתקף לרכישה הראשונה בלבד
 */
async function submitLead(email, source) {
  if (!LEAD_ENDPOINT) {
    console.info(`[LIAD] דמו בלבד — לא נשלח מייל. (${source}: ${email})`);
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true, simulated: true };
  }

  const res = await fetch(LEAD_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, source }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** מחבר טופס לידים (ניוזלטר או פופאפ) */
function wireLeadForm({ form, status, source, onSuccess }) {
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // מלכודת בוטים — אם השדה מלא, זה בוט. יוצאים בשקט.
    if (form.querySelector('input[name="company"]')?.value) return;

    const button = form.querySelector('button[type="submit"]');
    const emailInput = form.querySelector('input[type="email"]');
    const phoneInput = form.querySelector('input[type="tel"]');
    const nameInput = form.querySelector('input[name="name"]');

    const email = emailInput?.value.trim() ?? "";
    const phone = phoneInput?.value.trim() ?? "";
    const name = nameInput?.value.trim() ?? "";

    const fail = (message, input) => {
      status.dataset.state = "error";
      status.textContent = message;
      input?.focus();
    };

    if (emailInput && !isValidEmail(email)) return fail("נראה שכתובת האימייל לא תקינה", emailInput);
    if (phoneInput && !/^0\d{8,9}$/.test(phone.replace(/[\s-]/g, ""))) {
      return fail("נראה שמספר הטלפון לא תקין", phoneInput);
    }
    if (nameInput && name.length < 2) return fail("צריך שם", nameInput);

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "רק רגע…";
    status.dataset.state = "";
    status.textContent = "";

    try {
      await submitLead(email, source);
      // הרשומה נכנסת לרשימת הלקוחות שרואים במערכת הניהול
      recordLead({ name, email, phone, source });
      localStorage.setItem(STORAGE_KEYS.subscribed, "1");
      status.dataset.state = "success";
      status.textContent = "נרשמת! המתנה והקוד בדרך אלייך.";
      form.reset();
      onSuccess?.();
    } catch (err) {
      console.error("[LIAD] שליחת הליד נכשלה:", err);
      status.dataset.state = "error";
      status.textContent = "משהו השתבש. אפשר לנסות שוב עוד רגע.";
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

function initNewsletter() {
  wireLeadForm({
    form: $("#newsletterForm"),
    status: $("#newsletterStatus"),
    source: "newsletter",
  });
}


/* ==========================================================================
   09. פופאפ הנחה
   ========================================================================== */

/**
 * ההודעה הבאה שצריך להציג.
 *
 * במערכת הניהול אפשר להגדיר עד חמש הודעות פעילות. אנחנו לא מציגים
 * את כולן באותו ביקור — זה היה מרגיש כמו ספאם. במקום זה מציגים את
 * הראשונה שהלקוחה עוד לא סגרה, כך שהן מתחלפות לאורך זמן.
 */
function pickPopup() {
  const list = activePopups();
  if (!list) return null;
  const dismissed = new Set(
    (localStorage.getItem(STORAGE_KEYS.popupsSeen) || "").split(",").filter(Boolean)
  );
  return list.find((p) => !dismissed.has(p.id)) ?? null;
}

/** בונה מחדש את תוכן הפופאפ לפי מה שהוגדר בניהול. העיצוב נשאר זהה. */
function paintPopup(popup) {
  $("#promoValue").textContent = popup.value ?? "";
  $("#promoValue").hidden = !popup.value;
  $("#promoTitle").textContent = popup.title;
  $("#promoText").textContent = popup.text ?? "";

  const fields = [];
  if (popup.fields?.name) {
    fields.push('<input class="field" type="text" name="name" placeholder="שם מלא" autocomplete="name" aria-label="שם מלא">');
  }
  if (popup.fields?.email) {
    fields.push('<input class="field" type="email" name="email" placeholder="כתובת אימייל" required autocomplete="email" aria-label="כתובת אימייל">');
  }
  if (popup.fields?.phone) {
    fields.push('<input class="field" type="tel" name="phone" placeholder="טלפון" autocomplete="tel" aria-label="טלפון">');
  }

  $("#promoFields").innerHTML = fields.join("");
  $("#promoSubmit").textContent = popup.buttonText || "שליחה";

  const codeBox = $("#promoCode");
  codeBox.hidden = !popup.code;
  if (popup.code) $("#promoCodeValue").textContent = popup.code;
}

function initPromo(config = {}) {
  const promo = $("#promo");
  if (!promo || config.enabled === false) return;

  const managed = pickPopup();
  const delay = ((managed?.delaySeconds ?? config.delaySeconds) ?? 45) * 1000;
  const repeatAfterDays = config.repeatAfterDays ?? 7;
  const code = managed?.code ?? config.discountCode ?? "LIAD10";
  const source = managed ? `popup:${managed.id}` : "promo-popup";

  if (managed) paintPopup(managed);
  else $("#promoCodeValue").textContent = code;

  // מי שכבר נרשם, או שסגר לאחרונה — לא רואה שוב
  if (localStorage.getItem(STORAGE_KEYS.subscribed)) return;
  const dismissedAt = Number(localStorage.getItem(STORAGE_KEYS.promoSeen) || 0);
  if (dismissedAt && Date.now() - dismissedAt < repeatAfterDays * 864e5) return;

  let opened = false;

  const open = () => {
    if (opened) return;
    opened = true;
    promo.classList.add("is-open");
    promo.setAttribute("aria-hidden", "false");
    clearTimeout(timer);
    document.removeEventListener("mouseout", onExitIntent);
  };

  const close = () => {
    promo.classList.remove("is-open");
    promo.setAttribute("aria-hidden", "true");
    localStorage.setItem(STORAGE_KEYS.promoSeen, String(Date.now()));
    // מסמנים את ההודעה הזו כנראתה, כדי שבפעם הבאה תוצג הבאה בתור
    if (managed) {
      const seen = (localStorage.getItem(STORAGE_KEYS.popupsSeen) || "").split(",").filter(Boolean);
      if (!seen.includes(managed.id)) {
        localStorage.setItem(STORAGE_KEYS.popupsSeen, [...seen, managed.id].join(","));
      }
    }
  };

  // א. פתיחה אוטומטית אחרי X שניות
  const timer = setTimeout(open, delay);

  // ב. פתיחה כשהעכבר יוצא מהחלון (כוונת נטישה)
  function onExitIntent(e) {
    if (!e.relatedTarget && e.clientY <= 0) open();
  }
  document.addEventListener("mouseout", onExitIntent);

  $("#promoClose")?.addEventListener("click", close);
  $("#promoDismiss")?.addEventListener("click", close);
  promo.addEventListener("click", (e) => { if (e.target === promo) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && promo.classList.contains("is-open")) close();
  });

  wireLeadForm({
    form: $("#promoForm"),
    status: $("#promoStatus"),
    source,
    onSuccess: () => {
      $("#promoCode")?.classList.add("is-visible");
      $("#promoForm")?.remove();
      setTimeout(close, 6000);
    },
  });
}


/* ==========================================================================
   10. הפעלה
   ========================================================================== */

async function init() {
  /*
   * שינויי מערכת הניהול מוחלים לפני הכול. חשוב שזה יקרה לפני initHero:
   * ה-Hero מפרק את הכותרת למילים, ואם הטקסט יתחלף אחרי הפירוק —
   * האנימציה תרוץ על טקסט שכבר לא קיים.
   */
  initCms();

  // דברים שלא תלויים בתוכן — מיד
  initAccessibility();
  initHeader();
  initMobileNav();
  initAnnouncement();
  initHero();
  $("#copyrightYear").textContent = new Date().getFullYear();

  // תוכן מה-JSON
  const [content, catalog] = await Promise.all([loadContent(), loadShopProducts()]);
  if (content) {
    applySiteLinks(content.links);
    renderProducts(buildCarouselList(content.products, catalog));
    renderChips(content.chips);
    renderCategories(content.categories);
    renderJournal(content.journal);
    renderFaq(content.faq);
    renderLocations(content.locations);
    renderReels(content.testimonials);

    // הקישורים שנוצרו עכשיו דינמית צריכים גם הם את הכתובות
    applySiteLinks(content.links);

    initFaq();
    initReels();
    initPromo(content.promo);

    createCarousel($("#productCarousel"), {
      prev: $("[data-carousel-prev]"),
      next: $("[data-carousel-next]"),
    });
  }

  initNewsletter();

  // סקשן הגוונים בונה את עצמו, ולכן חייב לרוץ לפני מנוע התנועה —
  // אחרת הפרלקסה תמדוד דף שעדיין חסר בו האזור הכי גבוה שיש.
  await initShadeShowcase();

  // עכשיו כל התוכן על הדף: מחשבים מדידות ומפעילים את כל האנימציות
  initMotion();
}

/*
 * תמונות שנטענות מאוחר מזיזות את כל מה שמתחתיהן.
 * מדידה נוספת אחרי הטעינה המלאה שומרת על הפרלקסה מדויקת.
 */
window.addEventListener("load", () => refreshMotion());

// main.js נטען כמודול, כלומר הוא deferred ורץ לפני DOMContentLoaded.
// אם בכל זאת האירוע כבר קרה (למשל בטעינה מהקאש) — מפעילים מיד.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
