/* ==========================================================================
   LIAD — מפת העריכה של דף הבית

   זו רשימת כל מה שאפשר לערוך בדף הבית ממערכת הניהול.

   איך זה מחובר לדף עצמו:
     • טקסט   — לכל שדה כאן יש מקבילה ב-liad-landing/index.html בתור
                data-cms-text="<key>"
     • תמונה  — data-cms-image="<key>"
     • סקשן   — data-cms-section="<id>" (מסתיר/מציג ומשנה סדר)

   הקובץ הזה מתאר רק *מה* אפשר לערוך. ההחלה עצמה נעשית ב-
   liad-landing/js/cms.js, שהוא גנרי ולא מכיר את הרשימה הזו — ולכן
   הוספת שדה חדש דורשת שתי פעולות בלבד: שורה כאן, ו-data-cms בדף.
   ========================================================================== */

/** @typedef {{key:string,label:string,type?:"text"|"textarea",hint?:string}} HomeField */

/** @type {{title:string, fields:HomeField[]}[]} */
export const HOME_TEXT_GROUPS = [
  {
    title: "Hero — המסך הראשון",
    fields: [
      { key: "hero.eyebrow", label: "שורת פתיחה קטנה" },
      { key: "hero.title", label: "כותרת ראשית", type: "textarea",
        hint: "כל שורה כאן היא שורה בכותרת. השורה שתיכתב בין כוכביות *כך* תוצג בזהב." },
      { key: "hero.lead", label: "פסקת פתיחה", type: "textarea" },
      { key: "hero.ctaShop", label: "כפתור ראשי (לחנות)" },
      { key: "hero.ctaAcademy", label: "כפתור משני (לאקדמיה)" },
    ],
  },
  {
    title: "שתי הדלתות",
    fields: [
      { key: "choose.eyebrow", label: "שורת פתיחה" },
      { key: "choose.title", label: "כותרת" },
      { key: "choose.lead", label: "תיאור", type: "textarea" },
      { key: "doors.shopTitle", label: "כותרת דלת החנות" },
      { key: "doors.shopText", label: "תיאור דלת החנות", type: "textarea" },
      { key: "doors.academyTitle", label: "כותרת דלת האקדמיה" },
      { key: "doors.academyText", label: "תיאור דלת האקדמיה", type: "textarea" },
    ],
  },
  {
    title: "מוצרים מומלצים",
    fields: [
      { key: "bestsellers.eyebrow", label: "שורת פתיחה" },
      { key: "bestsellers.title", label: "כותרת" },
      { key: "bestsellers.lead", label: "תיאור", type: "textarea" },
      { key: "bestsellers.cta", label: "כפתור לכל המוצרים" },
    ],
  },
  {
    title: "מה את מחפשת היום",
    fields: [
      { key: "discover.eyebrow", label: "שורת פתיחה" },
      { key: "discover.title", label: "כותרת" },
      { key: "discover.lead", label: "תיאור", type: "textarea" },
    ],
  },
  {
    title: "האקדמיה והקורסים",
    fields: [
      { key: "academy.eyebrow", label: "שורת פתיחה" },
      { key: "academy.title", label: "כותרת" },
      { key: "academy.lead", label: "תיאור", type: "textarea" },
      { key: "academy.cta", label: "כפתור" },
      { key: "academy.voicesEyebrow", label: "שורת פתיחה — אזור הבוגרות" },
      { key: "academy.voicesTitle", label: "כותרת אזור הבוגרות", type: "textarea" },
    ],
  },
  {
    title: "אודות",
    fields: [
      { key: "about.eyebrow", label: "שורת פתיחה" },
      { key: "about.title", label: "כותרת", type: "textarea" },
      { key: "about.text", label: "טקסט", type: "textarea" },
    ],
  },
  {
    title: "טיפים ותוכן",
    fields: [
      { key: "journal.eyebrow", label: "שורת פתיחה" },
      { key: "journal.title", label: "כותרת", type: "textarea" },
      { key: "journal.lead", label: "תיאור", type: "textarea" },
    ],
  },
  {
    title: "סניפים",
    fields: [
      { key: "locations.eyebrow", label: "שורת פתיחה" },
      { key: "locations.title", label: "כותרת" },
      { key: "locations.lead", label: "תיאור", type: "textarea" },
    ],
  },
  {
    title: "שאלות נפוצות",
    fields: [
      { key: "faq.eyebrow", label: "שורת פתיחה" },
      { key: "faq.title", label: "כותרת" },
    ],
  },
  {
    title: "רשימת תפוצה",
    fields: [
      { key: "newsletter.gift", label: "תגית המתנה" },
      { key: "newsletter.eyebrow", label: "שורת פתיחה" },
      { key: "newsletter.title", label: "כותרת" },
      { key: "newsletter.lead", label: "תיאור", type: "textarea" },
      { key: "newsletter.cta", label: "כפתור" },
    ],
  },
];

/** @type {{key:string,label:string,hint?:string}[]} */
export const HOME_IMAGES = [
  { key: "hero.portrait", label: "תמונת ההירו", hint: "לאורך, מומלץ 1600×2000" },
  { key: "doors.shop", label: "תמונת דלת החנות" },
  { key: "doors.academy", label: "תמונת דלת האקדמיה" },
  { key: "academy.media", label: "תמונת האקדמיה" },
  { key: "about.portrait", label: "תמונת אודות" },
  { key: "hand.photo", label: "צילום היד בסקשן הגוונים", hint: "ריבועית. החלפה תדרוש מדידה מחדש של הציפורניים." },
];

/** הסקשנים של דף הבית, לפי סדר ברירת המחדל */
export const HOME_SECTIONS = [
  { id: "choose", label: "שתי הדלתות — חנות ואקדמיה" },
  { id: "about", label: "אודות" },
  { id: "bestsellers", label: "מוצרים מומלצים" },
  { id: "discover", label: "מה את מחפשת היום" },
  { id: "academy", label: "האקדמיה והקורסים" },
  { id: "shadeShowcase", label: "חוויית הגוונים (היד)" },
  { id: "journal", label: "טיפים ותוכן" },
  { id: "locations", label: "סניפים" },
  { id: "faq", label: "שאלות נפוצות" },
  { id: "newsletter", label: "רשימת תפוצה" },
];

/** כמה באנרים אפשר להציג בשורת ההכרזות העליונה */
export const MAX_BANNERS = 6;
