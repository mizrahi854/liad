/* ==========================================================================
   LIAD — Hero
   רכיב עצמאי לכל מה שקורה במסך הראשון.

   שני דברים בלבד:
     1. פירוק הכותרת למילים, כדי שכל מילה תעלה בתורה
     2. חשיפה מדורגת של שאר תוכן ה-Hero מיד עם הטעינה

   הכותרת נכתבת ב-HTML כטקסט רגיל — הפירוק קורה כאן.
   כך מנועי חיפוש וקוראי מסך רואים משפט אחד שלם, ולא ערימת ספאנים.
   ========================================================================== */

/** כמה זמן עובר בין מילה למילה */
const WORD_STEP = 0.055;

/** עיכוב בין השלבים הגדולים של ה-Hero (כותרת → טקסט → כפתורים → תגים) */
const BLOCK_STEP = 0.12;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function initHero() {
  const hero = document.querySelector(".hero");
  if (!hero) return;

  const still = reduceMotion.matches || document.documentElement.dataset.a11yMotion === "true";

  splitTitle(hero);
  stageBlocks(hero);

  if (still) {
    hero.classList.add("is-ready");
    return;
  }

  /*
   * שני פריימים לפני ההפעלה: הראשון מסיים את הפריסה אחרי הפירוק,
   * השני מבטיח שהדפדפן כבר צייר את מצב ההתחלה — בלעדיו הוא היה
   * "מדלג" על האנימציה ומראה את הכותרת מיד במקומה.
   */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => hero.classList.add("is-ready"));
  });
}

/* ---------------------------------------------------------------- כותרת */

/**
 * עוטף כל מילה ב-<span class="split-word"> ונותן לה עיכוב משלה.
 * שורות מסומנות ב-HTML כ-<span class="split-line">, כדי שהמילים
 * "יעלו" מתוך השורה ולא מתוך שום מקום.
 */
function splitTitle(hero) {
  const title = hero.querySelector("[data-split]");
  if (!title || title.dataset.splitDone) return;

  let index = 0;

  title.querySelectorAll(".split-line").forEach((line) => {
    const parts = [];

    line.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        // מפרקים לפי רווחים, ושומרים על הרווחים עצמם בין המילים
        node.textContent.split(/(\s+)/).forEach((chunk) => {
          if (!chunk) return;
          if (/^\s+$/.test(chunk)) {
            parts.push(document.createTextNode(chunk));
            return;
          }
          const word = document.createElement("span");
          word.className = "split-word";
          word.style.setProperty("--word-delay", `${(index++ * WORD_STEP).toFixed(3)}s`);
          word.textContent = chunk;
          parts.push(word);
        });
        return;
      }

      // אלמנט קיים (למשל ה-wordmark המוזהב) — עוטפים אותו כמו שהוא
      const word = document.createElement("span");
      word.className = "split-word";
      word.style.setProperty("--word-delay", `${(index++ * WORD_STEP).toFixed(3)}s`);
      word.append(node.cloneNode(true));
      parts.push(word);
    });

    line.replaceChildren(...parts);
  });

  title.dataset.splitDone = "true";
  // המילים כבר מתארות את הכותרת; אין צורך שקורא מסך יעבור עליהן אחת־אחת
  title.setAttribute("aria-label", title.textContent.replace(/\s+/g, " ").trim());
}

/* ---------------------------------------------------------------- שלבים */

/** נותן לכל בלוק ב-Hero את מקומו בתור החשיפה */
function stageBlocks(hero) {
  const order = [
    ".hero__eyebrow",
    ".hero__lead",
    ".hero__actions",
    ".hero__badges",
    ".hero__scroll",
  ];

  // הכותרת מתחילה ראשונה; שאר הבלוקים נכנסים אחריה, אחד־אחד
  const titleWords = hero.querySelectorAll(".split-word").length;
  const afterTitle = titleWords * WORD_STEP * 0.55;

  order.forEach((selector, i) => {
    const el = hero.querySelector(selector);
    if (!el) return;
    const delay = i === 0 ? 0 : afterTitle + (i - 1) * BLOCK_STEP;
    el.style.setProperty("--hero-delay", `${delay.toFixed(3)}s`);
  });

  // הבקבוקים המרחפים נכנסים אחרונים, כשהטקסט כבר התיישב
  hero.querySelectorAll(".hero__floater").forEach((floater, i) => {
    floater.style.setProperty("--hero-delay", `${(afterTitle + 0.25 + i * 0.14).toFixed(3)}s`);
  });
}
