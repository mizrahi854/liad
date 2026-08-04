/* ==========================================================================
   LIAD | ווידג׳ט נגישות
   רכיב עצמאי. מוסיף כפתור צף ותפריט הגדרות בכל דף שטוען אותו.

   ההעדפות נשמרות ב-localStorage וחלות מיד בטעינה הבאה, כדי שמשתמשת
   לא תצטרך להגדיר מחדש בכל דף.
   ========================================================================== */

const STORAGE_KEY = "liad:a11y";

/** @type {{fontScale:number, contrast:boolean, links:boolean, motion:boolean, spacing:boolean}} */
const DEFAULTS = {
  fontScale: 1,      // 1 = 100%
  contrast: false,   // ניגודיות גבוהה
  links: false,      // הדגשת קישורים
  motion: false,     // עצירת אנימציות
  spacing: false,    // מרווח טקסט מוגדל
};

const FONT_MIN = 0.9;
const FONT_MAX = 1.5;
const FONT_STEP = 0.1;

let settings = { ...DEFAULTS };

/* ---------------------------------------------------------------- אתחול */

export function initAccessibility() {
  settings = load();
  apply();
  mount();
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* מצב פרטי — ההגדרות פשוט לא יישמרו */ }
}

/** מחיל את ההגדרות על ה-root, כך שכל ה-CSS מגיב דרך data-attributes */
function apply() {
  const root = document.documentElement;
  root.style.setProperty("--a11y-font-scale", String(settings.fontScale));
  root.dataset.a11yContrast = String(settings.contrast);
  root.dataset.a11yLinks = String(settings.links);
  root.dataset.a11yMotion = String(settings.motion);
  root.dataset.a11ySpacing = String(settings.spacing);
}

/* ---------------------------------------------------------------- ממשק */

function mount() {
  if (document.getElementById("a11yWidget")) return;

  const wrap = document.createElement("div");
  wrap.id = "a11yWidget";
  wrap.className = "a11y";
  wrap.innerHTML = `
    <button class="a11y__toggle" type="button" aria-expanded="false" aria-controls="a11yPanel"
            aria-label="הגדרות נגישות" title="הגדרות נגישות">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="7.5" r="1.4" fill="currentColor"/>
        <path d="M7 10.5h10"/><path d="M12 10.5V16"/><path d="m9.5 19 2.5-3 2.5 3"/>
      </svg>
    </button>

    <div class="a11y__panel" id="a11yPanel" role="dialog" aria-label="הגדרות נגישות" hidden>
      <div class="a11y__head">
        <h2>נגישות</h2>
        <button class="a11y__close" type="button" aria-label="סגירה">&times;</button>
      </div>

      <div class="a11y__group">
        <p class="a11y__label">גודל טקסט</p>
        <div class="a11y__stepper">
          <button type="button" data-a11y="font-down" aria-label="הקטנת טקסט">A−</button>
          <output id="a11yFontValue" aria-live="polite">100%</output>
          <button type="button" data-a11y="font-up" aria-label="הגדלת טקסט">A+</button>
        </div>
      </div>

      <div class="a11y__group">
        <label class="a11y__switch">
          <input type="checkbox" data-a11y="contrast">
          <span>ניגודיות גבוהה</span>
        </label>
        <label class="a11y__switch">
          <input type="checkbox" data-a11y="links">
          <span>הדגשת קישורים</span>
        </label>
        <label class="a11y__switch">
          <input type="checkbox" data-a11y="spacing">
          <span>ריווח טקסט מוגדל</span>
        </label>
        <label class="a11y__switch">
          <input type="checkbox" data-a11y="motion">
          <span>עצירת אנימציות</span>
        </label>
      </div>

      <button class="a11y__reset" type="button" data-a11y="reset">איפוס הגדרות</button>

      <p class="a11y__note">
        האתר תומך בניווט מקלדת מלא. Tab למעבר, Enter לבחירה, Esc לסגירה.
      </p>
    </div>`;

  document.body.appendChild(wrap);

  const toggle = wrap.querySelector(".a11y__toggle");
  const panel = wrap.querySelector(".a11y__panel");

  const open = () => {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    panel.querySelector("button, input")?.focus();
  };
  const close = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => (panel.hidden ? open() : close()));
  wrap.querySelector(".a11y__close").addEventListener("click", () => { close(); toggle.focus(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) { close(); toggle.focus(); }
  });

  document.addEventListener("click", (e) => {
    if (!panel.hidden && !wrap.contains(e.target)) close();
  });

  panel.addEventListener("click", (e) => {
    const action = e.target.closest("[data-a11y]")?.dataset.a11y;
    if (!action) return;

    if (action === "font-up") {
      settings.fontScale = Math.min(FONT_MAX, +(settings.fontScale + FONT_STEP).toFixed(2));
    } else if (action === "font-down") {
      settings.fontScale = Math.max(FONT_MIN, +(settings.fontScale - FONT_STEP).toFixed(2));
    } else if (action === "reset") {
      settings = { ...DEFAULTS };
    } else {
      return; // תיבות הסימון מטופלות ב-change
    }
    commit(panel);
  });

  panel.addEventListener("change", (e) => {
    const key = e.target.dataset.a11y;
    if (!key || !(key in settings)) return;
    settings[key] = e.target.checked;
    commit(panel);
  });

  syncUI(panel);
}

function commit(panel) {
  apply();
  save();
  syncUI(panel);
}

/** מסנכרן את הפקדים למצב הנוכחי */
function syncUI(panel) {
  panel.querySelector("#a11yFontValue").textContent =
    `${Math.round(settings.fontScale * 100)}%`;
  panel.querySelectorAll('input[type="checkbox"][data-a11y]').forEach((box) => {
    box.checked = Boolean(settings[box.dataset.a11y]);
  });
}
