# tools

כלים שרצים מהמחשב, לא מהאתר.

| קובץ | מה הוא עושה |
|---|---|
| `dev_server.py` | שרת פיתוח מקומי ששולח `no-store`. בלעדיו הדפדפן מגיש מודולי JS ישנים אחרי כל שינוי. |
| `trace_nails.py` | מודד את קווי המתאר של הציפורניים בצילום היד ומייצר `nail-paths.json`. |

## הרצה

```bash
python3 tools/dev_server.py        # http://localhost:4176
python3 tools/trace_nails.py       # → tools/nail-paths.json + nail-overlay.png
```

## החלפת צילום היד

1. שימו את הצילום החדש ב-`liad-landing/assets/img/hand-real.jpg` (ריבועי).
2. עדכנו ב-`trace_nails.py`, ברשימת `NAILS`, את ה-`center` של כל ציפורן —
   נקודה כלשהי בתוכה — ואת `rmin`/`rmax` (טווח החיפוש ברדיוס).
3. הריצו את הכלי ופתחו את `tools/nail-overlay.png` כדי לוודא בעין
   שהצורות יושבות על הציפורניים.
4. העתיקו את התוכן של `tools/nail-paths.json` אל
   `liad-landing/data/shades.json` תחת `hand.nails` (שדה `d` לכל ציפורן).

**האגודל הוא מצולע ידני** ולא נמדד אוטומטית — הוא מחוץ לפוקוס בצילום
ואין לו קצה חד לזיהוי. אם הוא זז בצילום החדש, יש לעדכן את הנקודות שלו
ידנית באותה רשימה.
