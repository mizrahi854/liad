/* ==========================================================================
   LIAD — קרוסלת מוצרים אינסופית

   הרעיון: מסוע. הרצועה זזה ברציפות, וכרטיס שיצא מהמסך בקצה אחד נמחק
   ובמקומו נולד כרטיס חדש בקצה השני — עם מוצר אחר.

   שני דברים שזה פותר, ושכפול פשוט של הרשימה לא פותר:

     1. אין רגע ריק. מספר הכרטיסים נקבע לפי רוחב המסך (פי שניים ממנו
        ועוד מרווח), ולכן תמיד יש מה להראות — גם במסך רחב במיוחד.

     2. אין חזרתיות. שכפול רשימה מחזיר את אותם מוצרים בדיוק בכל סבב.
        כאן כל כרטיס שנולד שולף מוצר חדש מהמאגר המעורבב, ומוצר שכבר
        נראה על המסך לא ייבחר שוב — כך הרצועה מרגישה אינסופית באמת.

   הכיוון נגזר מכיוון הקריאה של המסמך. ב-RTL "הבא" נמצא משמאל, ולכן
   הרצועה זזה ימינה כדי להביא אותו פנימה. זה ההפך מ-LTR, ובלי החישוב
   הזה נפער רווח לבן בצד אחד.

   שימוש:
     createCarousel(root, { prev, next, pool, render });
   ========================================================================== */

/** מהירות הזחילה האוטומטית, פיקסלים בשנייה */
const DRIFT_SPEED = 42;

/** כמה מהר נבלעת הדחיפה של החצים (0..1 לפריים) */
const NUDGE_EASE = 0.09;

/** פיקסלים שמפרידים בין לחיצה לגרירה */
const DRAG_THRESHOLD = 6;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * @param {HTMLElement} root אלמנט עם .carousel__track בפנים
 * @param {Object} options
 * @param {HTMLElement} [options.prev]
 * @param {HTMLElement} [options.next]
 * @param {Array}    options.pool   כל המוצרים שאפשר להציג
 * @param {Function} options.render (product) => HTMLElement
 */
export function createCarousel(root, { prev, next, pool = [], render } = {}) {
  const viewport = root.querySelector(".carousel__viewport") ?? root;
  const track = root.querySelector(".carousel__track");
  if (!track || !render || !pool.length) return null;

  /* ---------------------------------------------------------- כיוון */

  const rtl = getComputedStyle(document.documentElement).direction === "rtl";
  const dir = rtl ? 1 : -1;

  /* ---------------------------------------------------------- המאגר */

  /*
   * תור מעורבב שמתמלא מחדש כשנגמר. כך הסדר שונה בכל ביקור, אבל בתוך
   * סבב אחד כל מוצר מופיע פעם אחת בלבד — בלי "שני אדומים ברצף במקרה".
   */
  let queue = [];

  function shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** המוצרים שכרגע על המסך — כדי לא להציג את אותו מוצר פעמיים בבת אחת */
  const onScreen = () =>
    new Set([...track.children].map((el) => el.dataset.pid).filter(Boolean));

  function nextProduct() {
    const visible = onScreen();
    // עד כמה ניסיונות למצוא מוצר שלא נראה כרגע; אחרי זה לוקחים מה שיש
    for (let attempt = 0; attempt < pool.length; attempt += 1) {
      if (!queue.length) queue = shuffle(pool);
      const product = queue.pop();
      if (!visible.has(String(product.id))) return product;
    }
    if (!queue.length) queue = shuffle(pool);
    return queue.pop();
  }

  function mount(product, atStart = false) {
    const el = render(product);
    if (!el) return null;
    el.dataset.pid = String(product.id ?? "");
    if (atStart) track.prepend(el);
    else track.append(el);
    return el;
  }

  /* ---------------------------------------------------------- מצב */

  let offset = 0;        // כמה נגללנו, תמיד קטן מרוחב הכרטיס הראשון
  let nudge = 0;         // דחיפה מהחצים שנבלעת בהדרגה
  let paused = false;
  let dragging = false;
  let pressing = false;
  let last = 0;
  let frame = 0;

  const still = () =>
    reduceMotion.matches || document.documentElement.dataset.a11yMotion === "true";

  const gapPx = () => parseFloat(getComputedStyle(track).columnGap) || 0;

  /** ממלא את הרצועה עד שהיא מכסה בוודאות את המסך, ועוד קצת */
  function fill() {
    const need = viewport.clientWidth * 2 + 320;
    let guard = 0;
    while (track.scrollWidth < need && guard < 120) {
      if (!mount(nextProduct())) break;
      guard += 1;
    }
  }

  function paint() {
    track.style.transform = `translate3d(${(dir * offset).toFixed(2)}px, 0, 0)`;
  }

  /*
   * המסוע עצמו. כרטיס שיצא לגמרי מהמסך נמחק, ובמקומו נולד כרטיס חדש
   * בקצה הנגדי — ואיתו מוצר אחר. ה-offset מתקזז באותו רוחב, ולכן
   * העין לא רואה שום קפיצה.
   */
  function recycle() {
    const gap = gapPx();
    let guard = 0;

    let first = track.firstElementChild;
    while (first && offset >= first.offsetWidth + gap && guard < 40) {
      offset -= first.offsetWidth + gap;
      first.remove();
      mount(nextProduct());
      first = track.firstElementChild;
      guard += 1;
    }

    // הכיוון ההפוך — קורה כשלוחצים על החץ אחורה או גוררים אחורה
    while (offset < 0 && guard < 40) {
      const fresh = mount(nextProduct(), true);
      if (!fresh) break;
      offset += fresh.offsetWidth + gap;
      track.lastElementChild?.remove();
      guard += 1;
    }
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

    recycle();
    paint();

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
    const card = track.firstElementChild;
    if (!card) return;
    nudge += direction * (card.offsetWidth + gapPx());
    start();
  }

  next?.addEventListener("click", () => step(1));
  prev?.addEventListener("click", () => step(-1));

  /* ---------------------------------------------------------- גרירה

     תפיסת המצביע קורית רק אחרי תנועה אמיתית. תפיסה כבר ב-pointerdown
     מנתבת מחדש את ה-pointerup אל הרצועה, ואז יעד ה-click הוא הרצועה
     ולא כרטיס המוצר — כלומר לחיצה על כרטיס לא הייתה פותחת את דף המוצר. */

  let dragStart = 0;
  let dragBase = 0;
  let dragMoved = 0;

  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pressing = true;
    dragging = false;
    dragStart = e.clientX;
    dragBase = offset;
    dragMoved = 0;
    nudge = 0;
  });

  track.addEventListener("pointermove", (e) => {
    if (!pressing) return;
    dragMoved = e.clientX - dragStart;

    if (!dragging) {
      if (Math.abs(dragMoved) < DRAG_THRESHOLD) return;
      dragging = true;
      track.setPointerCapture?.(e.pointerId);
      root.classList.add("is-dragging");
    }

    offset = dragBase + dir * dragMoved;
    recycle();
    paint();
  });

  const endDrag = () => {
    pressing = false;
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
    if (Math.abs(dragMoved) > DRAG_THRESHOLD) e.preventDefault();
  }, true);

  /* ---------------------------------------------------------- הפעלה */

  track.replaceChildren();
  fill();
  paint();
  start();

  // רוחב המסך משתנה — ייתכן שצריך עוד כרטיסים כדי לכסות אותו
  const onResize = () => { fill(); recycle(); paint(); };
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("load", onResize);

  return {
    pause,
    resume,
    next: () => step(1),
    prev: () => step(-1),
  };
}
