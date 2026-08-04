#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
מחלץ את הצבע האמיתי של כל גוון מתוך תמונת הסווטצ׳, ובונה
רשימת גוונים מובחרת עבור סקשן היד האינטראקטיבי בדף הבית.

למה מחלצים ולא בוחרים ידנית: הציפורן על המסך חייבת להראות את הגוון
האמיתי של המוצר. דגימה מהצילום מבטיחה התאמה, גם כשיתווספו גוונים חדשים.

פלט: liad-landing/data/shades.json

הרצה:
    python3 tools/extract_shades.py
"""

import json
import colorsys
from collections import Counter
from pathlib import Path

from PIL import Image

SHOP = Path(__file__).resolve().parent.parent
LANDING = SHOP.parent / "liad-landing"
OUT = LANDING / "data" / "shades.json"

# כמה גוונים להציג בסקשן. מספר קטן ומדויק עדיף על רשימה ארוכה.
TARGET_COUNT = 7

# קווי מוצר שמתאימים לתצוגה על ציפורן (לק/ראבר בייס), לפי סדר עדיפות
PREFERRED_CATEGORIES = ("gel-polish", "bases")


def dominant_color(path: Path):
    """
    מחזיר (r, g, b) מייצג של הציפורן.

    דוגמים את מרכז התמונה בלבד — שם נמצאת הציפורן — ולוקחים חציון
    במקום ממוצע, כדי שהבזקי אור לבנים על הלכה לא ימשכו את הגוון לבהיר.
    """
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        # חלון מרכזי של 40% מהתמונה
        box = (int(w * 0.3), int(h * 0.3), int(w * 0.7), int(h * 0.7))
        im = im.crop(box).resize((40, 40))
        pixels = list(im.getdata())

    pixels.sort(key=lambda p: sum(p))
    mid = pixels[len(pixels) // 2]
    return mid


def to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def hue_sat_val(rgb):
    r, g, b = (c / 255 for c in rgb)
    return colorsys.rgb_to_hsv(r, g, b)


def pick_diverse(items, count):
    """
    בוחר גוונים מגוונים: מחלק את גלגל הצבעים לקטגוריות ולוקח
    את הרווי ביותר מכל אחת, כדי שלא יתקבלו שבעה גווני בז׳ דומים.
    """
    buckets = {}
    for it in items:
        h, s, v = it["_hsv"]
        # ניטרליים (רוויה נמוכה) נכנסים לדלי נפרד לפי בהירות
        key = ("neutral", round(v * 3)) if s < 0.14 else ("hue", int(h * 12))
        cur = buckets.get(key)
        if cur is None or it["_hsv"][1] > cur["_hsv"][1]:
            buckets[key] = it

    chosen = sorted(buckets.values(), key=lambda x: -x["_hsv"][1])[:count]
    # סידור סופי לפי גוון, כדי שהמעברים בגלילה ירגישו רציפים
    return sorted(chosen, key=lambda x: x["_hsv"][0])


def main():
    products = json.loads(
        (SHOP / "data" / "products.json").read_text(encoding="utf-8")
    )["products"]

    candidates = []
    for p in products:
        if p.get("category") not in PREFERRED_CATEGORIES:
            continue
        if not p.get("shade") or not p.get("gallery"):
            continue

        swatch = SHOP / p["gallery"][-1]
        if not swatch.exists():
            continue

        try:
            rgb = dominant_color(swatch)
        except Exception:
            continue

        h, s, v = hue_sat_val(rgb)
        # מסננים גוונים כהים מדי או שרופים — הם לא נראים טוב על ציפורן קטנה
        if v < 0.12:
            continue

        candidates.append({
            "id": p["id"],
            "title": p["title"],
            "brand": p["brand"],
            "shade": p["shade"],
            "price": p["price"],
            "color": to_hex(rgb),
            "image": f"../liad-shop/{p['image']}",
            "swatch": f"../liad-shop/{p['gallery'][-1]}",
            "href": f"../liad-shop/product.html?id={p['id']}",
            "_hsv": (h, s, v),
        })

    print(f"מועמדים: {len(candidates)}")
    chosen = pick_diverse(candidates, TARGET_COUNT)

    for c in chosen:
        c.pop("_hsv", None)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"shades": chosen}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )

    print(f"\nנבחרו {len(chosen)} גוונים → {OUT.relative_to(SHOP.parent)}\n")
    for c in chosen:
        print(f"  {c['color']}  {c['title'][:46]:<48} {c['price']:>5} ₪")


if __name__ == "__main__":
    main()
