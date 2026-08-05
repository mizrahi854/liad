/* ==========================================================================
   LIAD — חנות | מנוע התנועה

   הגרסה של החנות. היא קרובה ברוחה לזו של דף הבית, אבל לא זהה לה בכוונה:
   בדף הבית התנועה היא חלק מהסיפור, ובחנות היא צריכה לשרת עיון בקטלוג —
   מהירה, שקטה, ולעולם לא מעכבת לחיצה על "הוספה לסל".

   מה יש כאן:
     01. חשיפה בגלילה (reveal) — לכרטיסים, לסקשנים ולתמונות
     02. פרלקסה עדינה + עומק
     03. הטיה תלת־ממדית לפי העכבר (רק בעכבר אמיתי)
     04. Micro interactions — ריחוף מגנטי על הכפתורים

   עקרונות ביצועים:
     • transform ו-opacity בלבד — אפס layout בזמן גלילה
     • כל המדידות במטמון, ונרעננות רק ב-resize או אחרי הזרקת תוכן
     • לולאת rAF אחת שנרדמת כשאין מה לעדכן
     • prefers-reduced-motion ומתג הנגישות מכבים הכול
   ========================================================================== */

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");

function motionOff() {
  return reduceMotionQuery.matches || document.documentElement.dataset.a11yMotion === "true";
}

/* ---------------------------------------------------------------- לולאה */

const tasks = new Set();
let frame = 0;

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    let again = false;
    tasks.forEach((task) => { if (task() !== false) again = true; });
    if (again) schedule();
  });
}

/* ==========================================================================
   01. חשיפה בגלילה
   ========================================================================== */

let observer = null;

/**
 * חושף אלמנטים עם [data-reveal] כשהם נכנסים למסך.
 * אפשר לקרוא שוב אחרי הזרקת תוכן — אלמנט שכבר נחשף לא ייחשף פעמיים.
 *
 * data-reveal="up | fade | scale | deep"
 * data-reveal-delay="0.08"     עיכוב אישי בשניות
 * data-reveal-stagger="0.05"   על הורה: מדרג את הילדים אוטומטית
 */
export function initReveal(root = document) {
  root.querySelectorAll("[data-reveal-stagger]").forEach((host) => {
    const step = Number(host.dataset.revealStagger) || 0.06;
    [...host.children].forEach((child, i) => {
      if (!child.hasAttribute("data-reveal")) child.setAttribute("data-reveal", "up");
      if (!child.style.getPropertyValue("--reveal-delay")) {
        // התקרה מונעת מכרטיס מספר 40 ברשת להמתין שנייה שלמה
        child.style.setProperty("--reveal-delay", `${Math.min(i * step, 0.4).toFixed(3)}s`);
      }
    });
  });

  const targets = [...root.querySelectorAll("[data-reveal]:not(.is-revealed)")];
  if (!targets.length) return;

  targets.forEach((el) => {
    if (el.dataset.revealDelay) el.style.setProperty("--reveal-delay", `${el.dataset.revealDelay}s`);
  });

  const show = (el) => el.classList.add("is-revealed");

  // בלי IntersectionObserver או בלי תנועה — פשוט מציגים הכול
  if (!("IntersectionObserver" in window) || motionOff()) {
    targets.forEach(show);
    return;
  }

  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        show(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -6% 0px" });
  }

  targets.forEach((el) => {
    // מה שכבר גלוי נחשף מיד, בלי להמתין לגלילה
    if (el.getBoundingClientRect().top < window.innerHeight * 0.95) show(el);
    else observer.observe(el);
  });

  // רשת ביטחון: עדיף אנימציה שלא רצה מאשר מוצר שלא נראה
  setTimeout(() => targets.forEach(show), 4000);
}

/* ==========================================================================
   02. פרלקסה ועומק
   ========================================================================== */

let layers = [];
let dirty = true;

function collect() {
  layers = [...document.querySelectorAll("[data-parallax]")].map((el) => ({
    el,
    speed: Number(el.dataset.parallax) || 0,
    top: 0,
    height: 0,
  }));
  measure();
}

function measure() {
  const y = window.scrollY;
  layers.forEach((layer) => {
    const box = layer.el.getBoundingClientRect();
    layer.top = box.top + y;
    layer.height = box.height;
  });
  dirty = false;
}

function paint() {
  if (dirty) measure();
  const y = window.scrollY;
  const vh = window.innerHeight;

  for (const layer of layers) {
    const center = layer.top + layer.height / 2 - y - vh / 2;
    /*
     * התנועה חסומה ל-7% מגובה האלמנט — בדיוק פחות מהעודף שה-CSS נותן
     * למדיה בתוך המסגרת שלה. כך שכבה לא יכולה להיגרר החוצה ולחשוף פס ריק.
     */
    const limit = layer.height * 0.07;
    const raw = (center / vh) * layer.speed * 100;
    const shift = Math.max(-limit, Math.min(limit, raw));
    layer.el.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
  }

  return false;   // נרדמים עד הגלילה הבאה
}

function initParallax() {
  collect();
  if (!layers.length || motionOff()) return;

  tasks.add(paint);
  const wake = () => schedule();

  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", () => { dirty = true; wake(); }, { passive: true });
  window.addEventListener("load", () => { dirty = true; wake(); });
  wake();
}

/* ==========================================================================
   03. הטיה תלת־ממדית
   ========================================================================== */

/**
 * data-tilt="6"  עוצמת ההטיה במעלות.
 * הערכים נכתבים כמשתני CSS, וה-CSS מחליט מה לעשות איתם — כך אפשר
 * להטות כרטיס שלם, או רק את התמונה שבתוכו, בלי לגעת ב-JS.
 */
function initTilt(root = document) {
  if (!finePointerQuery.matches || motionOff()) return;

  root.querySelectorAll("[data-tilt]:not([data-tilt-ready])").forEach((host) => {
    host.dataset.tiltReady = "true";
    const strength = Number(host.dataset.tilt) || 6;
    let box = null;

    const reset = () => {
      host.style.setProperty("--tilt-x", "0deg");
      host.style.setProperty("--tilt-y", "0deg");
      host.style.setProperty("--pointer-x", "0");
      host.style.setProperty("--pointer-y", "0");
    };

    host.addEventListener("pointerenter", () => { box = host.getBoundingClientRect(); });

    host.addEventListener("pointermove", (e) => {
      if (!box) box = host.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      host.style.setProperty("--tilt-x", `${(y * -strength).toFixed(2)}deg`);
      host.style.setProperty("--tilt-y", `${(x * strength).toFixed(2)}deg`);
      host.style.setProperty("--pointer-x", x.toFixed(3));
      host.style.setProperty("--pointer-y", y.toFixed(3));
    });

    host.addEventListener("pointerleave", () => { box = null; reset(); });
    reset();
  });
}

/* ==========================================================================
   הפעלה
   ========================================================================== */

export function initMotion() {
  document.documentElement.classList.add("motion");
  initReveal();
  initParallax();
  initTilt();

  // מתג "עצירת אנימציות" בווידג׳ט הנגישות מאפס את השכבות הנעות בזמן אמת
  new MutationObserver(() => {
    if (!motionOff()) return;
    layers.forEach((layer) => (layer.el.style.transform = ""));
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-revealed"));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-a11y-motion"] });
}

/**
 * נקרא אחרי כל הזרקת תוכן דינמי (רשת מוצרים, ריבועי קטגוריות),
 * כדי שהאלמנטים החדשים ייכנסו למנוע.
 */
export function refreshMotion(root = document) {
  initReveal(root);
  initTilt(root);
  collect();
  dirty = true;
  schedule();
}
