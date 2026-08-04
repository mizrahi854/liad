/* ==========================================================================
   LIAD — יד עם ציפורניים (SVG)
   רכיב עצמאי. מייצר יד וקטורית שבה אפשר לצבוע כל ציפורן בנפרד.

   למה SVG ולא צילום:
     • שליטה מדויקת בצבע כל ציפורן, עם מעבר חלק בין גוונים
     • חד בכל רזולוציה, במשקל של כמה קילובייטים
     • אין תלות בצילום יד שאין לנו

   הצבע מוזרק דרך משתנה CSS (--nail-color), כך שהמעבר בין גוונים
   מתבצע ע"י ה-compositor ולא ע"י JavaScript — חלק ובחינם מבחינת ביצועים.
   ========================================================================== */

/**
 * מחזיר את ה-SVG של היד כמחרוזת.
 * חמש הציפורניים נושאות class="nail" ומקבלות את צבען מ---nail-color.
 */
export function handSVG() {
  return `
<svg class="hand" viewBox="0 0 420 520" role="img"
     aria-label="יד עם לק ג׳ל בגוון הנבחר" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- גוון עור רך, בהיר יותר בקצוות כדי לתת נפח -->
    <linearGradient id="skin" x1="0.2" y1="0" x2="0.9" y2="1">
      <stop offset="0%"   stop-color="#f6e2d4"/>
      <stop offset="45%"  stop-color="#efd3c1"/>
      <stop offset="100%" stop-color="#e3bfa9"/>
    </linearGradient>

    <!-- ברק הלכה: פס אור אלכסוני -->
    <linearGradient id="gloss" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#fff" stop-opacity="0.55"/>
      <stop offset="42%"  stop-color="#fff" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>

    <!-- הילה רכה סביב היד -->
    <radialGradient id="halo" cx="0.5" cy="0.45" r="0.6">
      <stop offset="0%"   stop-color="#fff" stop-opacity="0.85"/>
      <stop offset="70%"  stop-color="#fff" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>

    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="14"
                    flood-color="#8a6a55" flood-opacity="0.20"/>
    </filter>

    <filter id="nailGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="2" stdDeviation="4"
                    flood-color="var(--nail-color, #c9a227)" flood-opacity="0.45"/>
    </filter>
  </defs>

  <ellipse class="hand__halo" cx="210" cy="250" rx="190" ry="200" fill="url(#halo)"/>

  <g filter="url(#softShadow)">
    <!-- כף היד -->
    <path fill="url(#skin)" d="
      M112 300
      c-6-42 4-88 18-120
      c10-24 28-38 52-40
      c30-3 62 2 88 16
      c30 16 46 44 50 78
      c5 44-4 92-26 128
      c-18 30-48 46-84 44
      c-40-2-70-24-84-58
      c-8-16-12-32-14-48 z"/>

    <!-- אצבע קטנה -->
    <g class="finger finger--pinky">
      <path fill="url(#skin)" d="M300 236c14-4 26 4 28 18c3 20 1 42-4 60c-4 14-16 20-27 16
                                 c-11-4-16-16-13-29c5-22 8-46 16-65z"/>
      <path class="nail" d="M303 240c9-3 17 2 19 12c2 13 1 27-2 39c-3 10-11 14-18 11
                            c-7-3-10-11-8-20c3-14 5-30 9-42z"/>
      <path class="nail-gloss" d="M303 240c9-3 17 2 19 12c2 13 1 27-2 39c-3 10-11 14-18 11
                                  c-7-3-10-11-8-20c3-14 5-30 9-42z" fill="url(#gloss)"/>
    </g>

    <!-- קמיצה -->
    <g class="finger finger--ring">
      <path fill="url(#skin)" d="M254 176c15-5 29 4 31 20c4 28 2 60-4 86c-4 18-18 26-31 21
                                 c-13-5-19-19-16-35c6-30 11-63 20-92z"/>
      <path class="nail" d="M258 181c10-4 19 2 21 14c3 19 1 41-3 58c-3 13-13 18-21 14
                            c-8-4-12-14-9-26c4-20 7-42 12-60z"/>
      <path class="nail-gloss" d="M258 181c10-4 19 2 21 14c3 19 1 41-3 58c-3 13-13 18-21 14
                                  c-8-4-12-14-9-26c4-20 7-42 12-60z" fill="url(#gloss)"/>
    </g>

    <!-- אמה -->
    <g class="finger finger--middle">
      <path fill="url(#skin)" d="M198 152c16-5 31 5 33 22c4 30 2 66-4 94c-5 19-20 28-34 22
                                 c-14-6-20-21-17-38c7-33 13-69 22-100z"/>
      <path class="nail" d="M202 157c11-4 20 3 22 15c3 21 1 45-3 64c-3 14-14 19-22 15
                            c-9-4-13-15-10-28c5-22 8-46 13-66z"/>
      <path class="nail-gloss" d="M202 157c11-4 20 3 22 15c3 21 1 45-3 64c-3 14-14 19-22 15
                                  c-9-4-13-15-10-28c5-22 8-46 13-66z" fill="url(#gloss)"/>
    </g>

    <!-- אצבע מורה -->
    <g class="finger finger--index">
      <path fill="url(#skin)" d="M142 172c15-5 30 4 32 21c4 28 2 62-4 88c-5 18-19 27-32 21
                                 c-13-6-19-20-16-36c6-31 12-65 20-94z"/>
      <path class="nail" d="M146 177c10-4 19 2 21 14c3 20 1 43-3 60c-3 13-13 18-21 14
                            c-8-4-12-14-9-26c4-21 7-44 12-62z"/>
      <path class="nail-gloss" d="M146 177c10-4 19 2 21 14c3 20 1 43-3 60c-3 13-13 18-21 14
                                  c-8-4-12-14-9-26c4-21 7-44 12-62z" fill="url(#gloss)"/>
    </g>

    <!-- אגודל -->
    <g class="finger finger--thumb">
      <path fill="url(#skin)" d="M96 300c-16 6-26 22-22 38c6 24 20 46 38 60c12 10 28 6 34-8
                                 c6-13 1-27-10-36c-16-14-28-34-40-54z"/>
      <path class="nail" d="M104 318c-11 5-16 16-12 27c5 15 14 29 25 38c8 7 18 4 22-5
                            c4-9 1-19-7-25c-11-9-20-22-28-35z"/>
      <path class="nail-gloss" d="M104 318c-11 5-16 16-12 27c5 15 14 29 25 38c8 7 18 4 22-5
                                  c4-9 1-19-7-25c-11-9-20-22-28-35z" fill="url(#gloss)"/>
    </g>
  </g>
</svg>`;
}
