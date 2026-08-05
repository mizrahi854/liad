/* ==========================================================================
   LIAD — חנות | רכיב גלריית מוצר
   רכיב עצמאי לשימוש חוזר. אין לו תלות בשאר החנות.

   יכולות:
     • מחוות מגע (swipe)                • ניווט מקלדת (חצים, Home/End)
     • גרירה בעכבר                      • תמונות ממוזערות
     • מעברי fade חלקים                 • prefetch לתמונה הסמוכה
     • טעינה עצלה + blur placeholder

   מוצר עם תמונה אחת מקבל תצוגה נקייה: בלי חצים, בלי מונה ובלי ממוזערות.

   שימוש:
     const gallery = createGallery(rootEl, { images, alt });
     gallery.goTo(2);  gallery.destroy();
   ========================================================================== */

const SWIPE_THRESHOLD = 45;   // פיקסלים למעבר תמונה
const DRAG_RESISTANCE = 0.35; // התנגדות בגרירה מעבר לקצה

/**
 * @typedef {Object} GalleryImage
 * @property {string} src   נתיב התמונה
 * @property {string} [role] תפקיד הצילום — bottle / swatch / composite
 */

/**
 * יוצר גלריית מוצר בתוך אלמנט נתון.
 * @param {HTMLElement} root
 * @param {{images: GalleryImage[], alt: string}} options
 */
export function createGallery(root, { images, alt }) {
  if (!root || !images?.length) return null;

  let index = 0;
  let destroyed = false;

  // תמונה אחת = תצוגה שקטה. כל הפקדים קיימים רק כשיש באמת בין מה לנווט.
  const multi = images.length > 1;

  root.innerHTML = `
    <div class="gallery${multi ? "" : " gallery--single"}">
      <div class="gallery__stage" tabindex="${multi ? "0" : "-1"}" role="group"
           aria-roledescription="גלריית תמונות" aria-label="${escapeAttr(alt)}">
        ${images.map((img, i) => `
          <figure class="gallery__slide${i === 0 ? " is-active" : ""}"
                  data-index="${i}" aria-hidden="${i === 0 ? "false" : "true"}">
            <img src="${escapeAttr(img.src)}"
                 alt="${escapeAttr(galleryAlt(alt, img, i))}"
                 draggable="false"
                 loading="eager"
                 decoding="${i === 0 ? "sync" : "async"}"
                 fetchpriority="${i === 0 ? "high" : "auto"}">
          </figure>`).join("")}

        ${multi ? `
        <button class="gallery__nav gallery__nav--prev" type="button" aria-label="התמונה הקודמת">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
          </svg>
        </button>
        <button class="gallery__nav gallery__nav--next" type="button" aria-label="התמונה הבאה">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
          </svg>
        </button>

        <p class="gallery__counter" aria-hidden="true">
          <span class="gallery__counter-current">1</span> / ${images.length}
        </p>` : ""}
      </div>

      ${multi ? `
      <div class="gallery__thumbs" role="tablist" aria-label="בחירת תמונה">
        ${images.map((img, i) => `
          <button class="gallery__thumb${i === 0 ? " is-active" : ""}" type="button"
                  role="tab" aria-selected="${i === 0}" data-index="${i}"
                  aria-label="${escapeAttr(galleryAlt(alt, img, i))}">
            <img src="${escapeAttr(img.src)}" alt="" loading="lazy" decoding="async" draggable="false">
          </button>`).join("")}
      </div>` : ""}
    </div>`;

  const stage = root.querySelector(".gallery__stage");
  const slides = [...root.querySelectorAll(".gallery__slide")];
  const thumbs = [...root.querySelectorAll(".gallery__thumb")];
  const counter = root.querySelector(".gallery__counter-current");

  /*
   * הסרת ה-blur placeholder.
   *
   * שתי מלכודות שנתקלנו בהן:
   *  1. סלייד לא-פעיל הוא visibility:hidden, ודפדפנים לא מורידים תמונות
   *     עם loading="lazy" שמוסתרות כך. לכן כל תמונות הגלריה הן eager —
   *     הן קטנות (עד ~5 לכל מוצר) והמעבר ביניהן חייב להיות מיידי.
   *  2. אם אירוע load כבר קרה לפני שהאזנו לו, ה-blur היה נשאר לנצח.
   *     לכן יש גם בדיקת complete וגם רשת ביטחון בזמן.
   */
  slides.forEach((slide) => {
    const img = slide.querySelector("img");
    const reveal = () => slide.classList.add("is-loaded");

    if (img.complete && img.naturalWidth > 0) {
      reveal();
    } else {
      img.addEventListener("load", reveal, { once: true });
      img.addEventListener("error", () => {
        slide.classList.add("is-error");
        reveal(); // עדיף תמונה שבורה גלויה מאשר כתם מטושטש לנצח
      }, { once: true });
      // אם משום מה אף אירוע לא נורה — מציגים בכל מקרה
      setTimeout(reveal, 3000);
    }
  });

  /* ------------------------------------------------------------ ניווט */

  function goTo(next, { focusStage = false } = {}) {
    if (destroyed) return;
    const target = (next + images.length) % images.length;
    if (target === index) return;

    slides[index].classList.remove("is-active");
    slides[index].setAttribute("aria-hidden", "true");
    thumbs[index]?.classList.remove("is-active");
    thumbs[index]?.setAttribute("aria-selected", "false");

    index = target;

    slides[index].classList.add("is-active");
    slides[index].setAttribute("aria-hidden", "false");
    thumbs[index]?.classList.add("is-active");
    thumbs[index]?.setAttribute("aria-selected", "true");
    if (counter) counter.textContent = String(index + 1);

    thumbs[index]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    if (focusStage) stage.focus({ preventScroll: true });
    prefetchNeighbours();
  }

  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  /** מוריד מראש את התמונה הבאה והקודמת, כדי שהמעבר יהיה מיידי */
  function prefetchNeighbours() {
    if (!multi) return;
    [index + 1, index - 1].forEach((i) => {
      const img = images[(i + images.length) % images.length];
      if (!img) return;
      const preload = new Image();
      preload.decoding = "async";
      preload.src = img.src;
    });
  }
  prefetchNeighbours();

  /* ------------------------------------------------------------ מגע וגרירה */

  let dragStartX = null;
  let dragDx = 0;
  let dragging = false;

  const pointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragStartX = e.clientX;
    dragDx = 0;
    dragging = true;
    stage.setPointerCapture?.(e.pointerId);
    stage.classList.add("is-dragging");
  };

  const pointerMove = (e) => {
    if (!dragging || dragStartX === null) return;
    dragDx = e.clientX - dragStartX;
    // התנגדות בקצוות כדי שהגרירה תרגיש פיזית
    const resisted = dragDx * DRAG_RESISTANCE;
    slides[index].style.transform = `translateX(${resisted}px)`;
  };

  const pointerUp = () => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove("is-dragging");
    slides[index].style.transform = "";

    if (Math.abs(dragDx) < SWIPE_THRESHOLD) return;
    // RTL: גרירה ימינה = התמונה הקודמת
    dragDx > 0 ? prev() : next();
  };

  if (multi) {
    stage.addEventListener("pointerdown", pointerDown);
    stage.addEventListener("pointermove", pointerMove);
    stage.addEventListener("pointerup", pointerUp);
    stage.addEventListener("pointercancel", pointerUp);
    stage.addEventListener("pointerleave", pointerUp);
  }
  stage.addEventListener("dragstart", (e) => e.preventDefault());

  /* ------------------------------------------------------------ מקלדת */

  const onKey = (e) => {
    switch (e.key) {
      // RTL: חץ שמאל מתקדם קדימה
      case "ArrowLeft":  e.preventDefault(); next(); break;
      case "ArrowRight": e.preventDefault(); prev(); break;
      case "Home":       e.preventDefault(); goTo(0); break;
      case "End":        e.preventDefault(); goTo(images.length - 1); break;
    }
  };
  if (multi) stage.addEventListener("keydown", onKey);

  /* ------------------------------------------------------------ כפתורים */

  root.querySelector(".gallery__nav--next")?.addEventListener("click", next);
  root.querySelector(".gallery__nav--prev")?.addEventListener("click", prev);

  thumbs.forEach((thumb) => {
    thumb.addEventListener("click", () => goTo(Number(thumb.dataset.index)));
    thumb.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft")  { e.preventDefault(); thumbs[(Number(thumb.dataset.index)+1) % thumbs.length]?.focus(); }
      if (e.key === "ArrowRight") { e.preventDefault(); thumbs[(Number(thumb.dataset.index)-1+thumbs.length) % thumbs.length]?.focus(); }
    });
  });

  /* ------------------------------------------------------------ ניקוי */

  return {
    goTo,
    next,
    prev,
    get index() { return index; },
    destroy() {
      destroyed = true;
      stage.removeEventListener("keydown", onKey);
      root.innerHTML = "";
    },
  };
}

/* ---------------------------------------------------------------- עזרים */

const ROLE_LABEL = {
  bottle: "תמונת המוצר",
  swatch: "הגוון על הציפורן",
  composite: "המוצר והגוון",
  detail: "תקריב",
  photo: "תמונה",
};

function galleryAlt(base, img, i) {
  const role = ROLE_LABEL[img.role] || ROLE_LABEL.photo;
  return i === 0 ? `${base} — ${role}` : `${base} — ${role} ${i + 1}`;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
