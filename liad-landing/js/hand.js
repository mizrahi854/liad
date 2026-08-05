/* ==========================================================================
   LIAD — היד שבסקשן הגוונים
   רכיב עצמאי. שני מצבים, אותה חוויה:

   1. מצב צילום (המצב הפעיל)
      צילום יד אמיתי + שכבת SVG שקופה שמכילה רק את צורות הציפורניים.
      קווי המתאר נמדדו מהצילום עצמו (ראו data/shades.json → hand.nails),
      ולכן הם יושבים עליו לפיקסל.

      הצביעה נעשית בשלוש שכבות, כי לק אמיתי הוא לא כתם צבע אחיד:

        tint   — multiply. הצבע מוכפל בצילום, ולכן כל הצללים, ההשתקפויות
                 והמרקם של הציפורן נשארים. זה ההבדל בין "לק" ל"מדבקה".
        depth  — קו כהה ורך בשוליים הפנימיים, שנותן לציפורן נפח.
        gloss  — פס אור שמגיע מאותו כיוון שממנו מגיע האור בצילום,
                 ומחזיר את הברק הרטוב ש-multiply לבדו היה מכבה.

      כל שכבה חתוכה בדיוק לצורת הציפורניים, ולכן שום צבע לא נוגע בעור.

   2. מצב וקטורי (גיבוי)
      נכנס לפעולה אם אין צילום בנתונים, כדי שהסקשן לעולם לא יישבר.

   בשני המצבים הצבע מגיע ממשתנה CSS אחד (--nail-color), כך שהמעבר
   בין גוונים מתבצע ע"י ה-compositor — חלק, ובחינם מבחינת ביצועים.
   ========================================================================== */

/**
 * @typedef {Object} HandNail
 * @property {string} name  אצבע (index / middle / ring / pinky / thumb)
 * @property {string} d     נתיב SVG במערכת הצירים של הצילום
 * @property {number} [gloss] עוצמת הברק, 0..1
 * @property {number} [blur]  ריכוך הקצה בפיקסלים — לאצבע מחוץ לפוקוס
 */

/**
 * @typedef {Object} HandConfig
 * @property {string} image
 * @property {string} [imageWebp]
 * @property {string} [alt]
 * @property {number} [width]
 * @property {number} [height]
 * @property {HandNail[]} nails
 */

/**
 * בוחר את מצב היד לפי מה שקיים בנתונים.
 * @param {HandConfig} [config]
 */
export function handMarkup(config) {
  return config?.image && config.nails?.length ? handPhoto(config) : handSVG();
}

/* ==========================================================================
   מצב צילום
   ========================================================================== */

function handPhoto({ image, imageWebp, alt, width = 800, height = 800, nails = [] }) {
  const clean = nails
    .map((nail, i) => ({
      id: `nail-${(nail.name || i).toString().replace(/[^a-z0-9-]/gi, "")}-${i}`,
      d: nail.d,
      gloss: clamp(nail.gloss ?? 0.85, 0, 1),
      blur: Math.max(0, Number(nail.blur) || 0),
    }))
    .filter((nail) => nail.d);

  if (!clean.length) return handSVG();

  // filter אחד לכל ערך ריכוך, ולא אחד לכל ציפורן
  const blurs = [...new Set(clean.map((n) => n.blur))];
  const blurId = (value) => `handBlur${String(value).replace(".", "_")}`;

  const shapes = (extra = "") =>
    clean
      .map((n) => `<path d="${esc(n.d)}" filter="url(#${blurId(n.blur)})"${extra}/>`)
      .join("");

  const source = imageWebp
    ? `<source srcset="${esc(imageWebp)}" type="image/webp">`
    : "";

  return `
<div class="hand hand--photo" style="--hand-ratio:${(width / height).toFixed(4)}">
  <picture class="hand__frame">
    ${source}
    <img class="hand__photo" data-cms-image="hand.photo" src="${esc(image)}"
         alt="${esc(alt || "יד עם לק ג׳ל בגוון הנבחר")}"
         width="${width}" height="${height}"
         loading="eager" fetchpriority="high" decoding="async">
  </picture>

  <svg class="hand__paint" viewBox="0 0 ${width} ${height}"
       preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <defs>
      ${blurs.map((b) => `
      <filter id="${blurId(b)}" x="-25%" y="-25%" width="150%" height="150%"
              color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="${b || 0.35}"/>
      </filter>`).join("")}

      <!-- כל הציפורניים כאזור חיתוך אחד: שום שכבה לא יכולה לגלוש לעור -->
      <clipPath id="handNailClip">
        ${clean.map((n) => `<path d="${esc(n.d)}"/>`).join("")}
      </clipPath>

      <!-- כיוון האור בצילום: מלמעלה־שמאל -->
      <linearGradient id="handGloss" x1="0.1" y1="0" x2="0.75" y2="1">
        <stop offset="0%"   stop-color="#fff" stop-opacity="0.85"/>
        <stop offset="22%"  stop-color="#fff" stop-opacity="0.30"/>
        <stop offset="46%"  stop-color="#fff" stop-opacity="0.04"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <!-- 1. הגוון -->
    <g class="hand__tint">${shapes()}</g>

    <!-- 2. נפח: קו כהה רך בשוליים, מצויר פנימה בזכות ה-clip -->
    <g class="hand__depth" clip-path="url(#handNailClip)">${shapes(' fill="none"')}</g>

    <!-- 3. ברק -->
    <g class="hand__gloss" clip-path="url(#handNailClip)">
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#handGloss)"/>
    </g>
  </svg>
</div>`;
}

/* ==========================================================================
   מצב וקטורי (גיבוי)
   ========================================================================== */

/*
 * חמש האצבעות נבנות מאותה צורה אחת, וכל אחת רק מוזזת, מסובבת ומוקטנת.
 * כך הפרופורציות נשארות עקביות — וזה גם מה שמונע את המראה ה"מצויר":
 * הציפורן תופסת בערך רבע מאורך האצבע, כמו ביד אמיתית.
 */
const FINGERS = [
  { name: "index",  x: 152, y: 128, rotate: -7,  scale: 1 },
  { name: "middle", x: 212, y: 106, rotate: -1,  scale: 1.08 },
  { name: "ring",   x: 270, y: 122, rotate: 5,   scale: 1 },
  { name: "pinky",  x: 322, y: 168, rotate: 12,  scale: 0.82 },
  { name: "thumb",  x: 122, y: 348, rotate: -62, scale: 0.94 },
];

/** קו המתאר של אצבע אחת — קפסולה מעט צרה בקצה */
const FINGER_PATH =
  "M -22 22 c 0 -18 9 -28 22 -28 c 13 0 22 10 22 28 " +
  "L 24 196 c 0 16 -10 26 -24 26 c -14 0 -24 -10 -24 -26 z";

/** מיטת הציפורן: שקד מוארך בקצה האצבע */
const NAIL_PATH =
  "M -15 14 c 0 -17 5 -26 15 -26 c 10 0 15 9 15 26 " +
  "l 0 40 c 0 13 -7 20 -15 20 c -8 0 -15 -7 -15 -20 z";

function finger({ name, x, y, rotate, scale }) {
  const transform = `translate(${x} ${y}) rotate(${rotate}) scale(${scale})`;
  return `
    <g class="finger finger--${name}" transform="${transform}">
      <path fill="url(#skin)" d="${FINGER_PATH}"/>
      <path fill="url(#knuckle)" d="M -22 78 h 44 v 46 h -44 z" opacity=".5"/>
      <path class="nail-bed" fill="url(#bed)" d="${NAIL_PATH}"/>
      <path class="nail" d="${NAIL_PATH}"/>
      <path class="nail-gloss" fill="url(#gloss)" d="${NAIL_PATH}"/>
    </g>`;
}

/**
 * יד וקטורית עם חמש ציפורניים נפרדות.
 * הציפורניים נושאות class="nail" ומקבלות את צבען מ---nail-color.
 */
export function handSVG() {
  return `
<svg class="hand hand--vector" viewBox="0 0 440 560" role="img"
     aria-label="יד עם לק ג׳ל בגוון הנבחר" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- עור: בהיר במרכז, חם ועמוק יותר בקצוות -->
    <linearGradient id="skin" x1="0.15" y1="0" x2="0.9" y2="1">
      <stop offset="0%"   stop-color="#f8e7db"/>
      <stop offset="38%"  stop-color="#f0d6c4"/>
      <stop offset="78%"  stop-color="#e5c3ad"/>
      <stop offset="100%" stop-color="#d8b19a"/>
    </linearGradient>

    <!-- מפרקים: הצללה רכה שנותנת נפח לאצבעות -->
    <linearGradient id="knuckle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#c99f86" stop-opacity="0"/>
      <stop offset="55%"  stop-color="#c99f86" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#c99f86" stop-opacity="0"/>
    </linearGradient>

    <!-- מיטת הציפורן: הוורוד הטבעי שמתחת ללק -->
    <linearGradient id="bed" x1="0.2" y1="0" x2="0.85" y2="1">
      <stop offset="0%"   stop-color="#f6dcd2"/>
      <stop offset="100%" stop-color="#e8bfb2"/>
    </linearGradient>

    <!-- ברק הלכה: פס אור אלכסוני צר -->
    <linearGradient id="gloss" x1="0.1" y1="0" x2="0.75" y2="1">
      <stop offset="0%"   stop-color="#fff" stop-opacity="0.62"/>
      <stop offset="26%"  stop-color="#fff" stop-opacity="0.20"/>
      <stop offset="55%"  stop-color="#fff" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>

    <!-- הילה רכה סביב היד -->
    <radialGradient id="halo" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0%"   stop-color="#fff" stop-opacity="0.9"/>
      <stop offset="62%"  stop-color="#fff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>

    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="16" stdDeviation="20"
                    flood-color="#8a6a55" flood-opacity="0.22"/>
    </filter>

    <filter id="skinSoften" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="0.7"/>
    </filter>
  </defs>

  <ellipse class="hand__halo" cx="220" cy="292" rx="196" ry="212" fill="url(#halo)"/>

  <g filter="url(#softShadow)">

    <!-- כף היד: צורה מלבנית מעוגלת שמתרחבת מעט למעלה, לא עיגול -->
    <g filter="url(#skinSoften)">
      <path fill="url(#skin)" d="
        M 138 318
        c -4 -36 5 -60 24 -72
        c 46 -22 106 -22 152 0
        c 20 12 28 36 24 72
        c -6 52 -18 100 -40 130
        c -18 24 -44 34 -74 32
        c -32 -2 -56 -16 -70 -42
        c -12 -22 -18 -68 -16 -120 z"/>

      <!-- כרית האגודל -->
      <path fill="#e7c5b0" opacity=".38" d="
        M 160 344 c -10 40 0 84 26 112 c -32 -8 -54 -34 -60 -70 c -4 -22 6 -34 34 -42 z"/>

      <!-- אור רך במרכז כף היד -->
      <path fill="#f7e3d7" opacity=".5" d="
        M 216 340 c 34 -6 66 -2 90 12 c -8 46 -22 82 -40 106 c -28 -18 -44 -58 -50 -118 z"/>
    </g>

    ${FINGERS.map(finger).join("")}
  </g>
</svg>`;
}

/* ---------------------------------------------------------------- עזרים */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
