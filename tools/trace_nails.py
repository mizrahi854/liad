#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
מוצא את קווי המתאר של הציפורניים בצילום היד ומייצר נתיבי SVG.

הפלט נכנס ל-liad-landing/data/shades.json תחת hand.nails, וזה מה
שמאפשר ללק להתחלף על היד בלי לצייר אותה מחדש.

הרצה:
    python3 tools/trace_nails.py

נוצרים שני קבצים לצד הסקריפט: nail-paths.json (הנתיבים) ו-
nail-overlay.png (הצילום עם הנתיבים מעליו — לבדיקה בעין).

כשמחליפים את הצילום צריך להריץ שוב, ולעדכן את ה-center/rmin/rmax
של כל ציפורן ברשימת NAILS למטה.

השיטה: יורים קרניים ממרכז הציפורן החוצה, ועוצרים בקצה שלה.
מה שמזהה את הקצה תלוי במה הציפורן גובלת:
  • באצבע — קפיצה בחום הצבע (עור אדמדם, ציפורן ניטרלית)
  • ברקע  — נפילת בהירות אל הצל שמאחורי הקצה החופשי
לכן הציון הוא המקסימום של שני המדדים.

האגודל מחוץ לפוקוס ואין לו קצה מדיד — הוא נשאר מצולע ידני.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "liad-landing" / "assets" / "img" / "hand-real.jpg"

RAYS = 96
STEP = 0.75          # פיקסלים לדגימה
HOLD = 4             # כמה דגימות רצופות מעל הסף כדי לקבוע שזה באמת גבול

NAILS = [
    dict(name="pinky",  center=(160, 245), rmin=28, rmax=90),
    dict(name="index",  center=(400, 130), rmin=34, rmax=115),
    dict(name="middle", center=(567, 115), rmin=34, rmax=125),
    dict(name="ring",   center=(700, 255), rmin=32, rmax=115),
    dict(name="thumb", manual=[
        (707, 641), (678, 651), (652, 665), (627, 685), (604, 709),
        (584, 731), (571, 750), (582, 764), (604, 773), (629, 770),
        (653, 754), (676, 727), (694, 693), (704, 662),
    ]),
]


# ---------------------------------------------------------------- מדידה

def sampler(img):
    w, h = img.size
    px = img.load()

    def at(x, y):
        xi = min(w - 1, max(0, int(round(x))))
        yi = min(h - 1, max(0, int(round(y))))
        return px[xi, yi]
    return at


WARMTH = 0.135        # (R-B)/255 שמעליו הפיקסל הוא כבר עור
FALL = 0.05           # נפילת בהירות שמעליה זה קצה מול הרקע
GRAD_HALF = 5         # חצי חלון הגזירה, בדגימות


def cast(at, center, rmin, rmax):
    """מחזיר רדיוס קצה לכל קרן, או None כשלא נמצא גבול משכנע."""
    cx, cy = center
    radii = [rmin + i * STEP for i in range(int((rmax - rmin) / STEP))]
    hits = []

    for i in range(RAYS):
        a = 2 * math.pi * i / RAYS
        dx, dy = math.cos(a), math.sin(a)
        px = [at(cx + dx * r, cy + dy * r) for r in radii]

        # 1. גבול מול האצבע — העור חם בהרבה מהציפורן
        edge = None
        run = 0
        for k, (r, g, b) in enumerate(px):
            if (r - b) / 255 > WARMTH:
                run += 1
                if run >= HOLD:
                    edge = radii[k - HOLD + 1]
                    break
            else:
                run = 0

        # 2. גבול מול הרקע — הצל שמאחורי הקצה החופשי. מחפשים את
        #    הנפילה החדה ביותר בבהירות, לא רק ערך מוחלט.
        if edge is None:
            vals = [max(p) / 255 for p in px]
            best, best_at = 0, None
            for k in range(GRAD_HALF, len(vals) - GRAD_HALF):
                drop = vals[k - GRAD_HALF] - vals[k + GRAD_HALF]
                if drop > best:
                    best, best_at = drop, k
            if best > FALL:
                edge = radii[best_at]

        hits.append(edge)

    # קרניים שלא מצאו גבול מקבלות אותו מהשכנות
    if all(h is None for h in hits):
        raise SystemExit(f"לא נמצא גבול סביב {center}")
    for i in range(RAYS):
        if hits[i] is not None:
            continue
        back = next(k for k in range(1, RAYS) if hits[(i - k) % RAYS] is not None)
        fwd = next(k for k in range(1, RAYS) if hits[(i + k) % RAYS] is not None)
        a, b = hits[(i - back) % RAYS], hits[(i + fwd) % RAYS]
        hits[i] = (a * fwd + b * back) / (back + fwd)

    # קרן בודדת שברחה דרך מרווח בין אצבעות מקבלת את החציון של סביבתה
    for _ in range(5):
        fixed = list(hits)
        for i in range(RAYS):
            around = sorted(hits[(i + k) % RAYS] for k in (-4, -3, -2, 2, 3, 4))
            median = (around[2] + around[3]) / 2
            if hits[i] > median * 1.06:
                fixed[i] = median
        hits = fixed

    # החלקה מעגלית — מוציאה קפיצות בודדות בלי לשטח את הצורה
    smooth = []
    for i in range(RAYS):
        window = sorted(hits[(i + k) % RAYS] for k in (-2, -1, 0, 1, 2))
        smooth.append((window[1] + window[2] + window[3]) / 3)

    return [(cx + math.cos(2 * math.pi * i / RAYS) * smooth[i],
             cy + math.sin(2 * math.pi * i / RAYS) * smooth[i]) for i in range(RAYS)]


def resample(poly, count=26):
    """מדלל את המצולע לנקודות בודדות, כדי שהנתיב יישאר קצר וחלק."""
    step = len(poly) / count
    return [poly[int(i * step)] for i in range(count)]


def to_path(poly, tension=0.55):
    n = len(poly)
    d = [f"M{poly[0][0]:.1f} {poly[0][1]:.1f}"]
    for i in range(n):
        p0, p1 = poly[(i - 1) % n], poly[i]
        p2, p3 = poly[(i + 1) % n], poly[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 3, p1[1] + (p2[1] - p0[1]) * tension / 3)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 3, p2[1] - (p3[1] - p1[1]) * tension / 3)
        d.append(f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}")
    d.append("Z")
    return "".join(d)


# ---------------------------------------------------------------- הרצה

def main():
    img = Image.open(SRC).convert("RGB")
    at = sampler(img)

    paths, polys = {}, {}
    for nail in NAILS:
        poly = nail.get("manual") or resample(
            cast(at, nail["center"], nail["rmin"], nail["rmax"]))
        polys[nail["name"]] = poly
        paths[nail["name"]] = to_path(poly)

    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for poly in polys.values():
        draw.polygon([tuple(p) for p in poly], fill=(0, 190, 255, 100),
                     outline=(255, 30, 120, 255))

    out = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    out.resize((1400, 1400), Image.LANCZOS).save(HERE / "nail-overlay.png")
    (HERE / "nail-paths.json").write_text(
        json.dumps(paths, ensure_ascii=False, indent=1), encoding="utf-8")
    print("→ nail-paths.json")


if __name__ == "__main__":
    main()
