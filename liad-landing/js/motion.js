/* ==========================================================================
   LIAD — מנוע התנועה של דף הבית
   רכיב עצמאי. אחראי על כל מה שזז בגלילה, בלי ספריות חיצוניות.

   מה יש כאן:
     01. גלילה חלקה (אינרציה בסגנון Lenis, דסקטופ בלבד)
     02. לולאת פריים אחת לכל האתר
     03. חשיפה בגלילה (reveal) עם וריאנטים
     04. פרלקסה / עומק / פרספקטיבה
     05. הטיית עכבר (tilt) ותנועה מגנטית
     06. התקדמות סקשן (--enter / --progress) למעברים בין אזורים

   עקרונות ביצועים:
     • כל התנועה היא transform/opacity בלבד — אפס layout בזמן גלילה
     • כל המדידות נעשות פעם אחת (init/resize) ונשמרות במטמון
     • לולאת rAF אחת משותפת, שנרדמת כשאין מה לעדכן
     • מכבדים prefers-reduced-motion וגם את מתג "עצירת אנימציות" בווידג׳ט הנגישות
   ========================================================================== */

/* ---------------------------------------------------------------- הגדרות */

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");

/** תנועה מופחתת: העדפת מערכת או מתג הנגישות שלנו */
function motionOff() {
  return reduceMotionQuery.matches || document.documentElement.dataset.a11yMotion === "true";
}

/* ==========================================================================
   02. לולאת פריים אחת
   כל הצרכנים נרשמים כאן. הלולאה נרדמת מעצמה כשאף אחד לא מבקש עוד פריים.
   ========================================================================== */

const frameTasks = new Set();
let frameId = 0;

function requestFrames() {
  if (frameId) return;
  frameId = requestAnimationFrame(tick);
}

function tick() {
  frameId = 0;
  let wantsMore = false;
  frameTasks.forEach((task) => {
    if (task() !== false) wantsMore = true;
  });
  if (wantsMore) requestFrames();
}

function addFrameTask(task) {
  frameTasks.add(task);
  requestFrames();
}

/* ==========================================================================
   01. גלילה
   ========================================================================== */

/*
 * הערה על "גלילה חלקה":
 *
 * ניסינו כאן גם גלילה מונפשת בסגנון Lenis — לתפוס את אירוע ה-wheel,
 * לבטל אותו, ולהזיז את הדף בעצמנו עם אינרציה. זה נראה טוב על הנייר
 * ורע במציאות:
 *
 *   • ביטול ה-wheel מנתק את הדף מהגלילה האמיתית של המערכת. בטרקפאד של
 *     macOS, שכבר יש בו אינרציה משלו, זה מרגיש כפול וכבד.
 *   • window.scrollTo בכל פריים מוציא את ה-compositor מסנכרון עם
 *     הכותרת ה-sticky ועם סקשן הגוונים — ראינו ציור לא נכון בפועל.
 *   • preventDefault על wheel שובר גלילה בכלי נגישות ובאוטומציה.
 *
 * הגלילה הטבעית של הדפדפן חלקה ומדויקת בזכות עצמה. ה"תחושה" שאנחנו
 * רוצים לא מגיעה ממנה אלא ממה שקורה תוך כדי: השכבות, הפרלקסה,
 * החשיפות והעומק שמוגדרים בהמשך הקובץ. את זה אנחנו שולטים בו במלואו,
 * והוא רץ על ה-GPU בלי לגעת בגלילה עצמה.
 */

/**
 * גלילה מונפשת ליעד — לעוגני הדף ולבחירת הגוונים.
 * @param {number} y מיקום אנכי מוחלט
 */
export function scrollToY(y) {
  window.scrollTo({ top: y, behavior: motionOff() ? "auto" : "smooth" });
}

/** מחבר את עוגני הדף לגלילה החלקה */
function initAnchors() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest?.('a[href^="#"]');
    if (!link) return;

    const id = link.getAttribute("href");
    if (!id || id === "#") return;

    const goal = document.querySelector(id);
    if (!goal) return;

    e.preventDefault();
    const header = document.querySelector(".site-header");
    const offset = (header?.offsetHeight ?? 0) + 16;
    scrollToY(goal.getBoundingClientRect().top + window.scrollY - offset);
  });
}

/* ==========================================================================
   03. חשיפה בגלילה
   ========================================================================== */

/**
 * מפעיל אנימציות כניסה לכל אלמנט עם [data-reveal] או .reveal.
 *
 * data-reveal="up | fade | scale | blur | mask | left | right"
 * data-reveal-delay="0.12"      עיכוב אישי בשניות
 * data-reveal-stagger="0.08"    על הורה: מדרג אוטומטית את הילדים
 */
export function initReveal(root = document) {
  const staggerHosts = [...root.querySelectorAll("[data-reveal-stagger]")];
  staggerHosts.forEach((host) => {
    const step = Number(host.dataset.revealStagger) || 0.08;
    [...host.children].forEach((child, i) => {
      if (!child.hasAttribute("data-reveal")) child.setAttribute("data-reveal", "up");
      if (!child.style.getPropertyValue("--reveal-delay")) {
        child.style.setProperty("--reveal-delay", `${(i * step).toFixed(3)}s`);
      }
    });
  });

  const targets = [...root.querySelectorAll("[data-reveal]")];
  if (!targets.length) return;

  targets.forEach((el) => {
    const delay = el.dataset.revealDelay;
    if (delay) el.style.setProperty("--reveal-delay", `${delay}s`);
  });

  const show = (el) => el.classList.add("is-revealed");

  // בלי IntersectionObserver, בלי תנועה, או בטאב מוסתר — פשוט מציגים הכול
  if (!("IntersectionObserver" in window) || !window.innerHeight || motionOff()) {
    targets.forEach(show);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        show(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.06, rootMargin: "0px 0px -8% 0px" }
  );

  targets.forEach((el) => {
    // מה שכבר גלוי במסך הראשון נחשף מיד, בלי להמתין לגלילה
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) show(el);
    else observer.observe(el);
  });

  // רשת ביטחון: עדיף אנימציה שלא רצה מאשר תוכן שלא נראה
  setTimeout(() => targets.forEach(show), 4000);
}

/* ==========================================================================
   04. פרלקסה, עומק והתקדמות סקשן
   ========================================================================== */

/*
 * כל האלמנטים הנעים נמדדים פעם אחת ונשמרים במטמון, כך שבזמן גלילה
 * אנחנו רק כותבים transform — אפס קריאות layout, אפס jank.
 */
let layers = [];
let sections = [];
let metricsDirty = true;

/**
 * data-parallax="-0.12"       עוצמת התנועה ביחס לגלילה (שלילי = נגד הכיוון)
 * data-parallax-scale="0.04"  כמה להתקרב לאורך המסע
 * data-depth="1.4"            כפל עומק, לשכבות שצריכות להרגיש רחוקות יותר
 */
function collect() {
  layers = [...document.querySelectorAll("[data-parallax]")].map((el) => ({
    el,
    speed: Number(el.dataset.parallax) || 0,
    scale: Number(el.dataset.parallaxScale) || 0,
    depth: Number(el.dataset.depth) || 1,
    top: 0,
    height: 0,
  }));

  sections = [...document.querySelectorAll("[data-scroll-section]")].map((el) => ({
    el,
    top: 0,
    height: 0,
    enter: -1,
    progress: -1,
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
  sections.forEach((section) => {
    const box = section.el.getBoundingClientRect();
    section.top = box.top + y;
    section.height = box.height;
  });
  metricsDirty = false;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function paint() {
  if (metricsDirty) measure();

  const y = window.scrollY;
  const vh = window.innerHeight;

  for (const layer of layers) {
    // מרחק מרכז האלמנט ממרכז המסך, במסך שלם: 0 = בדיוק במרכז
    const center = layer.top + layer.height / 2 - y - vh / 2;

    /*
     * התנועה מוגבלת ל-7% מגובה האלמנט — בדיוק פחות מהעודף של 8%
     * שה-CSS נותן למדיה בתוך .media-frame. כך שכבה לא יכולה להיגרר
     * מעבר למסגרת שלה ולחשוף פס ריק, גם אם המדידות התיישנו לרגע
     * או אם מישהו יגדיר data-parallax אגרסיבי במיוחד.
     */
    const limit = layer.height * 0.07;
    const raw = (center / vh) * layer.speed * layer.depth * 100;
    const shift = Math.max(-limit, Math.min(limit, raw));

    if (layer.scale) {
      // ההתקרבות מגיעה לשיא כשהאלמנט במרכז המסך — כמו מיקוד עדשה
      const focus = 1 - clamp01(Math.abs(center) / (vh * 0.9 + layer.height / 2));
      layer.el.style.transform =
        `translate3d(0, ${shift.toFixed(2)}px, 0) scale(${(1 + focus * layer.scale).toFixed(4)})`;
    } else {
      layer.el.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
    }
  }

  for (const section of sections) {
    // --enter: 0 לפני שהסקשן נכנס, 1 כשהוא מעוגן במסך
    const enter = clamp01((y + vh - section.top) / (vh * 0.75));
    // --progress: המסע המלא של הסקשן דרך המסך
    const progress = clamp01((y + vh - section.top) / (section.height + vh));

    if (Math.abs(enter - section.enter) > 0.002) {
      section.enter = enter;
      section.el.style.setProperty("--enter", enter.toFixed(3));
    }
    if (Math.abs(progress - section.progress) > 0.002) {
      section.progress = progress;
      section.el.style.setProperty("--progress", progress.toFixed(3));
    }
  }

  return false; // הלולאה נרדמת עד הגלילה הבאה
}

function initParallax() {
  collect();
  if (!layers.length && !sections.length) return;

  if (motionOff()) {
    layers.forEach((layer) => (layer.el.style.transform = ""));
    return;
  }

  const schedule = () => addFrameTask(paint);

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", () => {
    metricsDirty = true;
    schedule();
  }, { passive: true });

  // תמונות שנטענות מאוחר משנות את גובה הדף, ואיתו את כל המדידות
  window.addEventListener("load", () => {
    metricsDirty = true;
    schedule();
  });

  schedule();
}

/** מסמן מחדש את כל המדידות — לשימוש אחרי הזרקת תוכן דינמי */
export function refreshMotion() {
  collect();
  metricsDirty = true;
  addFrameTask(paint);
}

/* ==========================================================================
   05. הטיית עכבר ותנועה מגנטית
   ========================================================================== */

/**
 * data-tilt="6"      עוצמת ההטיה במעלות
 * data-tilt-lift     מוסיף הרמה קלה בציר Z
 *
 * הערכים נכתבים כמשתני CSS, כך שה-CSS מחליט מה בדיוק לעשות איתם.
 */
function initTilt() {
  if (!finePointerQuery.matches || motionOff()) return;

  const hosts = [...document.querySelectorAll("[data-tilt]")];
  if (!hosts.length) return;

  hosts.forEach((host) => {
    const strength = Number(host.dataset.tilt) || 6;
    let box = null;

    const reset = () => {
      host.style.setProperty("--tilt-x", "0deg");
      host.style.setProperty("--tilt-y", "0deg");
      host.style.setProperty("--pointer-x", "0");
      host.style.setProperty("--pointer-y", "0");
    };

    host.addEventListener("pointerenter", () => {
      box = host.getBoundingClientRect();
    });

    host.addEventListener("pointermove", (e) => {
      if (!box) box = host.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      host.style.setProperty("--tilt-x", `${(y * -strength).toFixed(2)}deg`);
      host.style.setProperty("--tilt-y", `${(x * strength).toFixed(2)}deg`);
      host.style.setProperty("--pointer-x", x.toFixed(3));
      host.style.setProperty("--pointer-y", y.toFixed(3));
    });

    host.addEventListener("pointerleave", () => {
      box = null;
      reset();
    });

    reset();
  });
}

/* ==========================================================================
   הפעלה
   ========================================================================== */

export function initMotion() {
  document.documentElement.classList.add("motion");

  initAnchors();
  initReveal();
  initParallax();
  initTilt();

  // מתג "עצירת אנימציות" בווידג׳ט הנגישות מאפס את השכבות הנעות בזמן אמת
  new MutationObserver(() => {
    if (!motionOff()) return;
    layers.forEach((layer) => (layer.el.style.transform = ""));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-a11y-motion"] });
}
