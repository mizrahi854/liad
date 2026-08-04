#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
מייצר תמונת סווטצ׳ שנייה למוצרים שיש להם תמונה אחת בלבד.

הרקע: חלק מהצילומים בדרייב הם "קומפוזיט" — הבקבוק בצד אחד והגוון על
הציפורן בצד השני, באותה תמונה. הדרישה היא לפחות שתי תמונות לכל מוצר:
בקבוק ואז סווטצ׳. במקום להמציא תמונה, חותכים את אזור הציפורן מתוך
הצילום הקיים ושומרים אותו כתמונה נפרדת.

זו פעולה נגזרת מהמקור — לא תמונה מפוברקת.

הרצה:
    python3 tools/make_swatches.py            # מייצר + מעדכן את products.json
    python3 tools/make_swatches.py --dry-run  # רק מדווח מה יקרה
"""

import argparse
import json
import subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
PRODUCTS = BASE / "data" / "products.json"
SWATCH_DIRNAME = "_swatch"

# החיתוך הוא *ריבועי* וממורכז על הציפורן.
# הבמה בגלריה היא ביחס 1:1 עם object-fit: cover — חיתוך צר וגבוה היה
# נחתך שוב בתצוגה ומאבד את הציפורן, ולכן היחס חייב להתאים מראש.
#
# מיקום הציפורן בצילומים (נמדד ויזואלית): בצד ימין, ממורכזת אנכית.
CROP_SIDE_RATIO = 0.52   # צלע הריבוע ביחס לרוחב התמונה
CROP_RIGHT_MARGIN = 0.03 # שוליים מימין כדי לא לחתוך את קצה הציפורן

# קווי מוצר שהצילום שלהם אינו קומפוזיט (מכשור, מארזים, אביזרים) —
# חיתוך שם רק יפגע, ולכן מדלגים.
SKIP_CATEGORIES = {
    "machines", "lamps", "hygiene", "files", "tools",
    "disposable", "tips", "starter-kits",
}


def image_size(path):
    out = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        capture_output=True, text=True,
    ).stdout
    w = h = None
    for line in out.splitlines():
        if "pixelWidth:" in line:
            w = int(line.split(":")[1])
        elif "pixelHeight:" in line:
            h = int(line.split(":")[1])
    return w, h


def make_swatch(src: Path, dest: Path):
    """
    חותך ריבוע סביב הציפורן ושומר כקובץ נפרד.
    sips: ‎-c מקבל גובה ואז רוחב, ו-‎--cropOffset מקבל top ואז left.
    """
    w, h = image_size(src)
    if not w or not h:
        return False

    side = int(min(w, h) * CROP_SIDE_RATIO)
    offset_left = max(0, w - side - int(w * CROP_RIGHT_MARGIN))
    offset_top = max(0, (h - side) // 2)

    dest.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["sips", "-c", str(side), str(side),
         "--cropOffset", str(offset_top), str(offset_left),
         "-s", "format", "jpeg", "-s", "formatOptions", "80",
         str(src), "--out", str(dest)],
        capture_output=True,
    )
    return result.returncode == 0 and dest.exists()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data = json.loads(PRODUCTS.read_text(encoding="utf-8"))
    products = data["products"]

    targets = [
        p for p in products
        if not p.get("gallery") and p.get("category") not in SKIP_CATEGORIES
    ]

    print(f"מוצרים עם תמונה אחת: {sum(1 for p in products if not p.get('gallery'))}")
    print(f"מתוכם מתאימים לחיתוך: {len(targets)}")
    if args.dry_run:
        for p in targets[:5]:
            print(f"  {p['title']} ← {p['image']}")
        return

    made = failed = 0
    for p in targets:
        src = BASE / p["image"]
        if not src.exists():
            failed += 1
            continue

        rel = Path(p["image"]).relative_to("assets/products")
        dest = BASE / "assets" / "products" / SWATCH_DIRNAME / rel
        dest = dest.with_name(f"{dest.stem}-swatch.jpg")

        if dest.exists() or make_swatch(src, dest):
            p["gallery"] = [str(dest.relative_to(BASE))]
            made += 1
        else:
            failed += 1

        if made and made % 50 == 0:
            print(f"  … {made}", flush=True)

    PRODUCTS.write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    single = sum(1 for p in products if not p.get("gallery"))
    print(f"\nנוצרו {made} סווטצ׳ים | כשלו {failed}")
    print(f"מוצרים שנותרו עם תמונה אחת: {single}")


if __name__ == "__main__":
    main()
