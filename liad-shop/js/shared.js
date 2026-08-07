/* ==========================================================================
   LIAD — חנות | רכיבים משותפים
   הדר, תפריט מובייל, שורת הכרזות, פופאפ הנחה, נטישת עגלה.
   ========================================================================== */

import { $, $$, CONFIG, getCart, cartCount } from "./store.js";
import { initAccessibility } from "./accessibility.js";
import { initSync } from "./sync.js";

/**
 * כתובת ה-API לשליחת לידים ולהזמנות.
 * כל עוד הערך null — שום מייל לא נשלח בפועל, והטופס רק מדמה הצלחה.
 * ראו README לפירוט מה נדרש בצד השרת.
 */
export const LEAD_ENDPOINT = null;

/**
 * מפעיל את הרכיבים המשותפים ואת הסנכרון מול מסד הנתונים.
 *
 * מחזיר Promise, אבל אין חובה להמתין לו: הדף מצייר מיד מהמטמון
 * המקומי, והמשיכה מהשרת מרעננת אותו אחריה דרך אירוע ADMIN_EVENT.
 * מסכים שכן צריכים נתונים טריים (הניהול, המעקב) מחכים לו.
 */
export function initShared() {
  initAccessibility();
  initHeader();
  initMobileNav();
  initAnnouncement();
  initPromo();
  initAbandonedCart();
  const year = $("#copyrightYear");
  if (year) year.textContent = new Date().getFullYear();

  return initSync();
}

/* ---------------------------------------------------------------- הדר */

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
  if (!toggle || !panel) return;

  const open = () => {
    panel.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  };
  const close = () => {
    panel.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  };

  toggle.addEventListener("click", open);
  $("#navClose")?.addEventListener("click", close);
  $$("a", panel).forEach((a) => a.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) close();
  });
}

function initAnnouncement() {
  const slots = $$(".announcement__slot");
  if (slots.length < 2) return;
  let i = Math.max(0, slots.findIndex((s) => s.classList.contains("is-active")));
  setInterval(() => {
    slots[i].classList.remove("is-active");
    i = (i + 1) % slots.length;
    slots[i].classList.add("is-active");
  }, 3800);
}

/* ---------------------------------------------------------------- טפסי לידים */

export async function submitLead(email, source) {
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

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
}

export function wireLeadForm({ form, status, source, onSuccess }) {
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.querySelector('input[name="company"]')?.value) return; // מלכודת בוטים

    const input = form.querySelector('input[type="email"]');
    const button = form.querySelector('button[type="submit"]');
    const email = input?.value.trim() ?? "";

    if (!isValidEmail(email)) {
      status.dataset.state = "error";
      status.textContent = "נראה שכתובת האימייל לא תקינה";
      input?.focus();
      return;
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "רק רגע…";
    status.dataset.state = "";
    status.textContent = "";

    try {
      await submitLead(email, source);
      localStorage.setItem(CONFIG.storageKeys.subscribed, "1");
      status.dataset.state = "success";
      status.textContent = "נרשמת! המתנה והקוד בדרך אלייך למייל.";
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

/* ---------------------------------------------------------------- פופאפ הנחה */

function initPromo() {
  const promo = $("#promo");
  if (!promo) return;

  const DELAY_SECONDS = 45;
  const REPEAT_AFTER_DAYS = 7;

  if (localStorage.getItem(CONFIG.storageKeys.subscribed)) return;
  const seen = Number(localStorage.getItem(CONFIG.storageKeys.promoSeen) || 0);
  if (seen && Date.now() - seen < REPEAT_AFTER_DAYS * 864e5) return;

  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    promo.classList.add("is-open");
    promo.setAttribute("aria-hidden", "false");
    clearTimeout(timer);
    document.removeEventListener("mouseout", onExit);
  };
  const close = () => {
    promo.classList.remove("is-open");
    promo.setAttribute("aria-hidden", "true");
    localStorage.setItem(CONFIG.storageKeys.promoSeen, String(Date.now()));
  };

  const timer = setTimeout(open, DELAY_SECONDS * 1000);
  function onExit(e) {
    if (!e.relatedTarget && e.clientY <= 0) open();
  }
  document.addEventListener("mouseout", onExit);

  $("#promoClose")?.addEventListener("click", close);
  $("#promoDismiss")?.addEventListener("click", close);
  promo.addEventListener("click", (e) => { if (e.target === promo) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && promo.classList.contains("is-open")) close();
  });

  wireLeadForm({
    form: $("#promoForm"),
    status: $("#promoStatus"),
    source: "promo-popup",
    onSuccess: () => {
      $("#promoCode")?.classList.add("is-visible");
      $("#promoForm")?.remove();
      setTimeout(close, 6000);
    },
  });
}

/* ---------------------------------------------------------------- נטישת עגלה */

/**
 * תזכורת נטישת עגלה — בצד הלקוח בלבד.
 *
 * מה שזה עושה: אם יש פריטים בעגלה והמשתמשת לא פעילה כ-90 שניות,
 * כותרת הטאב מתחלפת לתזכורת. זו הגרסה שאפשר לעשות בלי שרת.
 *
 * מה שזה *לא* עושה: לא שולח מייל או SMS. לשליחה בפועל צריך
 * לזהות את הלקוחה (מייל בצ׳קאאוט) ותור מיילים מתוזמן בצד שרת.
 */
function initAbandonedCart() {
  const originalTitle = document.title;
  let idleTimer;
  let flashing;

  const startFlash = () => {
    if (flashing || !cartCount()) return;
    let on = false;
    flashing = setInterval(() => {
      on = !on;
      document.title = on ? "🛒 שכחת משהו בעגלה…" : originalTitle;
    }, 1400);
  };

  const stopFlash = () => {
    clearInterval(flashing);
    flashing = null;
    document.title = originalTitle;
  };

  const resetIdle = () => {
    clearTimeout(idleTimer);
    stopFlash();
    idleTimer = setTimeout(startFlash, 90_000);
  };

  ["mousemove", "keydown", "scroll", "click", "touchstart"].forEach((evt) =>
    document.addEventListener(evt, resetIdle, { passive: true })
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) startFlash();
    else resetIdle();
  });

  resetIdle();
}
