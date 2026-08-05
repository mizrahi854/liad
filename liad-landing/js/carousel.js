/* ==========================================================================
   LIAD — קרוסלת מוצרים
   רכיב עצמאי. תנועה איטית ורציפה, עם חצים ידניים ועצירה בריחוף.

   איך זה עובד:
     • הכרטיסים משוכפלים פעם אחת, כך שהרצועה נראית אינסופית
     • המיקום מנוהל כמספר אחד ונכתב כ-translate3d — אפס layout בזמן תנועה
     • החצים לא "קופצים": הם מוסיפים דחיפה שנבלעת בהאטה רכה
     • ריחוף, פוקוס, גרירה או טאב מוסתר — עוצרים את התנועה האוטומטית

   שימוש:
     createCarousel(rootEl);   // ה-root מכיל .carousel__track
   ========================================================================== */

/** מהירות הזחילה האוטומטית, פיקסלים בשנייה */
const DRIFT_SPEED = 26;

/** כמה מהר נבלעת הדחיפה של החצים (0..1 לפריים) */
const NUDGE_EASE = 0.085;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * @param {HTMLElement} root אלמנט עם .carousel__track בפנים
 * @param {{prev?: HTMLElement, next?: HTMLElement}} controls
 */
export function createCarousel(root, controls = {}) {
  const track = root.querySelector(".carousel__track");
  if (!track || !track.children.length) return null;

  const originals = [...track.children];

  /* ---------------------------------------------------------- שכפול */

  /*
   * משכפלים סט שלם, ולא כרטיס־כרטיס: כך אורך "סבב" אחד ידוע ומדויק,
   * והקפיצה חזרה לתחילת הסבב נופלת בדיוק על אותה תמונה — בלי הבהוב.
   */
  const clones = originals.map((el) => {
    const copy = el.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.querySelectorAll("a, button").forEach((n) => n.setAttribute("tabindex", "-1"));
    if (copy.matches("a, button")) copy.setAttribute("tabindex", "-1");
    return copy;
  });
  track.append(...clones);

  /* ---------------------------------------------------------- מצב */

  let setWidth = 0;      // רוחב סבב אחד
  let offset = 0;        // המיקום הנוכחי, תמיד בין 0 ל-setWidth
  let nudge = 0;         // דחיפה מהחצים שמתאפסת בהדרגה
  let paused = false;
  let dragging = false;
  let last = 0;
  let frame = 0;

  const still = () =>
    reduceMotion.matches || document.documentElement.dataset.a11yMotion === "true";

  function measure() {
    const first = originals[0];
    const afterSet = clones[0];
    // המרחק בין הכרטיס הראשון לתאום שלו הוא בדיוק אורך סבב
    setWidth = Math.abs(afterSet.offsetLeft - first.offsetLeft);
    if (!setWidth) setWidth = track.scrollWidth / 2;
  }

  function paint() {
    // RTL: ערך שלילי מזיז את הרצועה לכיוון שממנו מגיעים הכרטיסים הבאים
    track.style.transform = `translate3d(${-offset}px, 0, 0)`;
  }

  function wrap() {
    if (!setWidth) return;
    offset = ((offset % setWidth) + setWidth) % setWidth;
  }

  function loop(now) {
    frame = 0;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;

    const drifting = !paused && !dragging && !still();
    if (drifting) offset += (DRIFT_SPEED * dt) / 1000;

    if (Math.abs(nudge) > 0.4) {
      const step = nudge * NUDGE_EASE;
      offset += step;
      nudge -= step;
    } else {
      nudge = 0;
    }

    wrap();
    paint();

    // ממשיכים רק כשיש מה להזיז
    if (drifting || nudge) schedule();
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(loop);
  }

  function start() {
    last = 0;
    schedule();
  }

  /* ---------------------------------------------------------- עצירה */

  const pause = () => { paused = true; };
  const resume = () => { paused = false; start(); };

  root.addEventListener("pointerenter", pause);
  root.addEventListener("pointerleave", resume);
  root.addEventListener("focusin", pause);
  root.addEventListener("focusout", resume);

  // טאב מוסתר: אין טעם לשרוף פריימים
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else resume();
  });

  /* ---------------------------------------------------------- חצים */

  /** קפיצה של כרטיס אחד, בהאטה רכה */
  function step(direction) {
    const card = originals[0];
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    nudge += direction * (card.offsetWidth + gap);
    start();
  }

  controls.prev?.addEventListener("click", () => step(-1));
  controls.next?.addEventListener("click", () => step(1));

  /* ---------------------------------------------------------- גרירה */

  let dragStart = 0;
  let dragBase = 0;
  let dragMoved = 0;

  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    dragStart = e.clientX;
    dragBase = offset;
    dragMoved = 0;
    nudge = 0;
    track.setPointerCapture?.(e.pointerId);
    root.classList.add("is-dragging");
  });

  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dragMoved = e.clientX - dragStart;
    offset = dragBase + dragMoved;
    wrap();
    paint();
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-dragging");
    start();
  };

  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("dragstart", (e) => e.preventDefault());

  // גרירה לא אמורה להיחשב כלחיצה על כרטיס
  track.addEventListener("click", (e) => {
    if (Math.abs(dragMoved) > 8) e.preventDefault();
  }, true);

  /* ---------------------------------------------------------- הפעלה */

  measure();
  paint();
  start();

  // רוחב הכרטיסים משתנה עם המסך, וגם כשהתמונות מסיימות להיטען
  const remeasure = () => { measure(); wrap(); paint(); };
  window.addEventListener("resize", remeasure, { passive: true });
  window.addEventListener("load", remeasure);

  return {
    pause,
    resume,
    next: () => step(1),
    prev: () => step(-1),
  };
}
