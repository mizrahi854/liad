/* ==========================================================================
   LIAD — חוויית הגוונים בגלילה
   סקשן דביק שבו הלק על הציפורניים מתחלף בהתאם למיקום הגלילה,
   ולצדו כרטיס המוצר המתאים עם מחיר וכפתור רכישה.

   עקרונות ביצועים:
     • הגלילה נקראת פעם אחת לפריים דרך requestAnimationFrame
     • שינוי הצבע נעשה דרך משתנה CSS — הצביעה עצמה על ה-compositor
     • כל תנועה היא transform/opacity בלבד, בלי layout ובלי paint יקר
     • אין ספריות חיצוניות: אפס בייטים נוספים על הרשת

   נגישות:
     • הסקשן כולו עובד גם בלי גלילה — יש כפתורי גוון לניווט ישיר
     • prefers-reduced-motion מכבה את הפרלקסה ומקצר מעברים
     • כל שינוי גוון מוכרז ב-aria-live
   ========================================================================== */

import { handSVG } from "./hand.js";

/** מרווח הגלילה שכל גוון "תופס", ביחידות של גובה מסך */
const SCREENS_PER_SHADE = 0.85;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export async function initShadeShowcase() {
  const root = document.querySelector("#shadeShowcase");
  if (!root) return;

  const shades = await loadShades();
  if (!shades?.length) {
    root.remove();
    return;
  }

  render(root, shades);
  wire(root, shades);
}

/* ---------------------------------------------------------------- נתונים */

async function loadShades() {
  try {
    const res = await fetch("data/shades.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).shades;
  } catch (err) {
    console.error("[LIAD] טעינת הגוונים נכשלה:", err);
    return null;
  }
}

/* ---------------------------------------------------------------- מבנה */

function render(root, shades) {
  // גובה הסקשן קובע כמה גלילה מוקצית לכל גוון
  root.style.setProperty("--shade-count", shades.length);
  root.style.setProperty("--screens-per-shade", SCREENS_PER_SHADE);

  root.innerHTML = `
    <div class="showcase__track">
      <div class="showcase__stage">

        <!-- רקע: הילות צבע שמתחלפות עם הגוון -->
        <div class="showcase__ambience" aria-hidden="true">
          <span class="showcase__glow showcase__glow--a"></span>
          <span class="showcase__glow showcase__glow--b"></span>
          <span class="showcase__grid"></span>
        </div>

        <div class="container showcase__inner">

          <!-- טקסט פתיחה -->
          <header class="showcase__intro">
            <span class="rule-gold"></span>
            <p class="eyebrow">הגוונים של LIAD</p>
            <h2 class="showcase__title">
              גוון אחד<br>
              <span class="text-gold-gradient">משנה הכול</span>
            </h2>
          </header>

          <!-- היד -->
          <div class="showcase__hand" id="showcaseHand">
            ${handSVG()}
          </div>

          <!-- כרטיס המוצר -->
          <article class="showcase__card" id="shadeCard">
            <div class="showcase__card-media">
              ${shades.map((s, i) => `
                <img src="${esc(s.image)}" alt="${esc(s.title)}"
                     class="showcase__bottle${i === 0 ? " is-active" : ""}"
                     data-index="${i}" loading="${i < 2 ? "eager" : "lazy"}"
                     decoding="async" width="300" height="300">`).join("")}
            </div>

            <div class="showcase__card-body">
              <p class="showcase__brand" id="shadeBrand">${esc(shades[0].brand)}</p>
              <h3 class="showcase__name" id="shadeName">${esc(shades[0].title)}</h3>

              <div class="showcase__meta">
                <span class="showcase__chip" id="shadeChip">
                  <i class="showcase__dot" aria-hidden="true"></i>
                  גוון <span id="shadeCode">${esc(shades[0].shade)}</span>
                </span>
                <span class="showcase__price" id="shadePrice">${money(shades[0].price)}</span>
              </div>

              <a class="btn btn--gold showcase__buy" id="shadeBuy" href="${esc(shades[0].href)}">
                לרכישת הגוון
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
                </svg>
              </a>
            </div>
          </article>

          <a class="showcase__scroll" href="#bestsellers">
            <span>למטה</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
            </svg>
          </a>

          <!-- ניווט ידני בין גוונים (וגם נקודת עוגן לנגישות) -->
          <nav class="showcase__dots" style="grid-area:dots" aria-label="בחירת גוון">
            ${shades.map((s, i) => `
              <button type="button" class="showcase__dot-btn${i === 0 ? " is-active" : ""}"
                      data-index="${i}" style="--dot:${esc(s.color)}"
                      aria-label="${esc(s.title)}" aria-current="${i === 0}"></button>`).join("")}
          </nav>

          <p class="sr-only" aria-live="polite" id="shadeAnnounce"></p>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- לוגיקה */

function wire(root, shades) {
  const stage = root.querySelector(".showcase__stage");
  const bottles = [...root.querySelectorAll(".showcase__bottle")];
  const dots = [...root.querySelectorAll(".showcase__dot-btn")];
  const hand = root.querySelector("#showcaseHand");
  const card = root.querySelector("#shadeCard");

  const el = {
    brand: root.querySelector("#shadeBrand"),
    name: root.querySelector("#shadeName"),
    code: root.querySelector("#shadeCode"),
    price: root.querySelector("#shadePrice"),
    buy: root.querySelector("#shadeBuy"),
    announce: root.querySelector("#shadeAnnounce"),
  };

  let current = -1;
  let ticking = false;

  /** מחיל גוון לפי אינדקס */
  function setShade(index, { announce = true } = {}) {
    const i = Math.max(0, Math.min(shades.length - 1, index));
    if (i === current) return;
    current = i;
    const s = shades[i];

    // הצבע עובר לכל הסקשן דרך משתנה אחד
    stage.style.setProperty("--nail-color", s.color);

    bottles.forEach((b, bi) => b.classList.toggle("is-active", bi === i));
    dots.forEach((d, di) => {
      d.classList.toggle("is-active", di === i);
      d.setAttribute("aria-current", String(di === i));
    });

    // החלפת טקסט עם הבהוב עדין, כדי שהעין תקלוט שהשתנה
    card.classList.add("is-swapping");
    el.brand.textContent = s.brand;
    el.name.textContent = s.title;
    el.code.textContent = s.shade;
    el.price.textContent = money(s.price);
    el.buy.href = s.href;
    window.setTimeout(() => card.classList.remove("is-swapping"), 260);

    if (announce) el.announce.textContent = `${s.title}, ${money(s.price)}`;
  }

  /* ---- גלילה ---- */

  function update() {
    ticking = false;
    const rect = root.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight;
    if (scrollable <= 0) return;

    // 0 בתחילת הסקשן, 1 בסופו
    const progress = clamp(-rect.top / scrollable, 0, 1);

    // בחירת הגוון לפי ההתקדמות
    setShade(Math.round(progress * (shades.length - 1)));

    if (reduceMotion.matches) return;

    // עומק ופרלקסה — transform בלבד
    const drift = (progress - 0.5) * 2; // ‎-1..1
    hand.style.transform =
      `translate3d(0, ${drift * -26}px, 0) rotate(${drift * 2.5}deg) scale(${1 + Math.abs(drift) * 0.015})`;
    card.style.transform = `translate3d(0, ${drift * 18}px, 0)`;
    stage.style.setProperty("--drift", drift.toFixed(3));
  }

  /*
   * העדכון רץ ישירות מתוך מאזין הגלילה ולא דרך requestAnimationFrame.
   *
   * למה: כשה-rAF מווסת (טאב ברקע, מצב חיסכון בסוללה, חלק מהסביבות)
   * הקולבק פשוט לא נקרא, והסקשן נתקע על הגוון הראשון — כלומר הפיצ׳ר
   * המרכזי של הדף מת בשקט. הקריאה כאן היא getBoundingClientRect אחד
   * על אלמנט יחיד, שהדפדפן ממילא מגביל לפריים אחד במאזין passive.
   *
   * ה-rAF נשאר כשכבת החלקה כשהוא כן זמין.
   */
  const onScroll = () => {
    update();
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  /* ---- ניווט ידני ---- */

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const i = Number(dot.dataset.index);
      // גוללים למקום שמייצג את הגוון, כך שהמצב נשאר עקבי עם הגלילה
      const scrollable = root.offsetHeight - window.innerHeight;
      const target = root.offsetTop + (i / (shades.length - 1)) * scrollable;
      window.scrollTo({ top: target, behavior: reduceMotion.matches ? "auto" : "smooth" });
      setShade(i);
    });
  });

  /* ---- תנועת עכבר: הטיה עדינה ---- */

  if (!reduceMotion.matches && window.matchMedia("(hover: hover)").matches) {
    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      stage.style.setProperty("--tilt-x", (y * -5).toFixed(2) + "deg");
      stage.style.setProperty("--tilt-y", (x * 6).toFixed(2) + "deg");
    });
    stage.addEventListener("pointerleave", () => {
      stage.style.setProperty("--tilt-x", "0deg");
      stage.style.setProperty("--tilt-y", "0deg");
    });
  }

  setShade(0, { announce: false });
  update();
}

/* ---------------------------------------------------------------- עזרים */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function money(value) {
  const n = Math.round(value * 100) / 100;
  const text = Number.isInteger(n)
    ? n.toLocaleString("he-IL")
    : n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${text} ₪`;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
