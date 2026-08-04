#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ייבוא קטלוג מוצרים מ-Google Drive.

מה זה עושה:
  1. סורק את עץ התיקיות בדרייב (תיקיות ציבוריות בלבד — ללא צורך בהתחברות)
  2. מוריד את תמונות המוצרים
  3. מייצר את data/products.json של החנות

הרצה:
    python3 tools/drive_import.py --scan          # רק סריקה, בלי הורדה (מהיר)
    python3 tools/drive_import.py --download      # סריקה + הורדת תמונות + בניית קטלוג

התיקייה הראשית מוגדרת ב-ROOT_FOLDER למטה.
"""

import argparse
import html as html_mod
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------- הגדרות

ROOT_FOLDER = "1afzEapbIGJ_kpf81NrhPQ8P3MvMEqObr"  # "ב.עלמה"

BASE_DIR = Path(__file__).resolve().parent.parent
IMG_DIR = BASE_DIR / "assets" / "products"
DATA_DIR = BASE_DIR / "data"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

FOLDER_MIME = "application/vnd.google-apps.folder"


# ---------------------------------------------------------------- עזרי רשת

def http_get(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40, context=SSL_CTX) as r:
                return r.read()
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    return b""


def list_folder(folder_id):
    """
    מחזיר (subfolders, files) עבור תיקייה ציבורית בדרייב.
    כל אחד: רשימת dict עם id ו-name.

    שתי תבניות שונות בדף של גוגל:
      • תיקיות — aria-label="NAME Shared folder" ולידו ssk שמכיל את המזהה
      • קבצים  — במבנה הנתונים המוטמע, המזהה מופיע בדיוק לפני שם הקובץ
    """
    html = http_get(f"https://drive.google.com/drive/folders/{folder_id}").decode(
        "utf-8", errors="ignore"
    )

    def dedupe(items):
        seen, out = set(), []
        for it in items:
            if it["id"] in seen or it["id"] == folder_id:
                continue
            seen.add(it["id"])
            out.append(it)
        return out

    # --- תיקיות (שמות מגיעים מקודדים ב-HTML entities, למשל ג&#39;ל)
    folders = [
        {"id": fid, "name": html_mod.unescape(name).strip()}
        for name, fid in re.findall(
            r"aria-label=\"([^\"]{1,80}?) Shared folder\"[^>]*?ssk='[^']*?:([-_A-Za-z0-9]{25,45}?)-\d+-\d+'",
            html,
        )
    ]

    # --- קבצים: מזהה ואז שם, לפי סדר ההופעה בטקסט
    tokens = []
    for m in re.finditer(r'"([-_A-Za-z0-9]{28,44})"', html):
        tokens.append(("id", m.group(1), m.start()))
    for m in re.finditer(
        r'\[\["([^"\\]{1,120}?\.(?:jpg|jpeg|png|webp|mp4|mov))",null,1\]\]', html, re.I
    ):
        tokens.append(("file", m.group(1), m.start()))
    tokens.sort(key=lambda t: t[2])

    files, last_id = [], None
    for kind, value, _ in tokens:
        if kind == "id":
            last_id = value
        elif last_id:
            files.append({"id": last_id, "name": html_mod.unescape(value)})
            last_id = None

    return dedupe(folders), dedupe(files)


# תמונות דרייב הן 1500x1500 ושוקלות מאות KB. לאתר זה כבד מדי,
# ולכן כל תמונה מוקטנת ל-800px ונשמרת כ-JPEG.
MAX_EDGE = 800
JPEG_QUALITY = 78


def optimize(path):
    """מקטין וממיר ל-JPEG במקום. מחזיר את הנתיב הסופי."""
    target = path.with_suffix(".jpg")
    tmp = path.with_suffix(".tmp.jpg")
    result = subprocess.run(
        ["sips", "--resampleHeightWidthMax", str(MAX_EDGE),
         "-s", "format", "jpeg", "-s", "formatOptions", str(JPEG_QUALITY),
         str(path), "--out", str(tmp)],
        capture_output=True,
    )
    if result.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return path  # sips לא זמין (לא macOS) — משאירים את המקור

    tmp.replace(target)
    if path != target:
        path.unlink(missing_ok=True)
    return target


def download_file(file_id, dest):
    """
    מוריד ומקטין. מחזיר (status, נתיב יחסי סופי) — הסיומת עשויה
    להשתנות ל-.jpg, ולכן הנתיב מוחזר ולא מונח מראש.
    """
    final = dest.with_suffix(".jpg")
    if final.exists() and final.stat().st_size > 1000:
        return "cached", final

    data = http_get(f"https://drive.google.com/uc?export=download&id={file_id}")
    if len(data) < 1000 or data[:15].lstrip().lower().startswith(b"<!doctype"):
        return "failed", None

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return "ok", optimize(dest)


# ---------------------------------------------------------------- סריקת העץ

def scan_tree(folder_id, name="", depth=0, max_depth=3):
    """סורק רקורסיבית ומחזיר עץ."""
    indent = "  " * depth
    print(f"{indent}📁 {name or folder_id}", flush=True)

    folders, files = list_folder(folder_id)
    node = {"id": folder_id, "name": name, "files": files, "children": []}

    if depth < max_depth:
        for sub in folders:
            node["children"].append(
                scan_tree(sub["id"], sub["name"], depth + 1, max_depth)
            )

    if files:
        print(f"{indent}   └─ {len(files)} קבצים", flush=True)
    return node


def flatten_leaves(node, trail=None):
    """מחזיר את כל התיקיות שיש בהן קבצים, עם הנתיב אליהן."""
    trail = (trail or []) + ([node["name"]] if node["name"] else [])
    out = []
    if node["files"]:
        out.append({"path": trail, "files": node["files"]})
    for child in node["children"]:
        out.extend(flatten_leaves(child, trail))
    return out


# ---------------------------------------------------------------- מיפוי לקטלוג

def slugify(text):
    text = re.sub(r"[^\w\u0590-\u05FF-]+", "-", text.strip(), flags=re.UNICODE)
    return re.sub(r"-{2,}", "-", text).strip("-").lower()


def load_rules():
    """כללי תמחור וקטגוריות. נטען מקובץ חיצוני כדי שיהיה קל לערוך."""
    rules_path = Path(__file__).parent / "catalog_rules.json"
    return json.loads(rules_path.read_text(encoding="utf-8"))


def match_rule(trail, rules):
    """מוצא את הכלל המתאים לנתיב התיקייה."""
    key = " / ".join(trail)
    for rule in rules["lines"]:
        if all(part in key for part in rule["match"]):
            return rule
    return None


# קוד גוון: 3 ספרות ומעלה, אפשר עם אות מובילה (b002) או נגררת (100a)
SHADE_RE = re.compile(r"^[a-zA-Z]?\d{3,5}[a-zA-Z]?$")


def build_catalog(leaves, rules, downloaded):
    """
    ממפה קבצים למוצרים. שלושה מקרים:

    1. singleProduct  — כל התמונות בתיקייה הן מוצר אחד (תנור עיקור, מכונת שיוף).
                        התמונה הראשונה ראשית, השאר גלריה.
    2. collection     — תיקיית מארז: קבצים עם קוד גוון הם מוצרים בודדים,
                        ושאר הקבצים (צילום הקופסה) הם מוצר המארז עצמו.
    3. רגיל           — כל קובץ הוא גוון/מוצר בפני עצמו.
    """
    products, skipped = [], []

    def make(rule, stem, image, gallery=None, *, title=None, price=None,
             category=None, shade=None):
        item = {
            "id": slugify(f'{rule["brand"]}-{rule["slug"]}-{stem}'),
            "title": title or rule["title"],
            "brand": rule["brand"],
            "category": category or rule["category"],
            "line": rule["title"],
            "shade": shade,
            "description": rule["description"],
            "price": price if price is not None else rule["price"],
            "priceSource": rule["priceSource"],
            "stock": rule.get("defaultStock", 0),
            "image": f"assets/products/{image}",
        }
        if gallery:
            item["gallery"] = [f"assets/products/{g}" for g in gallery]
        return item

    for leaf in leaves:
        trail = leaf["path"]
        rule = match_rule(trail, rules)
        if not rule:
            skipped.append({"path": " / ".join(trail), "files": len(leaf["files"])})
            continue

        entries = []
        for f in leaf["files"]:
            local = downloaded.get(f["id"])
            if local:
                entries.append((Path(f["name"]).stem, local))
        if not entries:
            continue
        entries.sort(key=lambda e: e[0])

        # 1. מוצר בודד עם כמה תמונות
        if rule.get("singleProduct"):
            products.append(make(rule, rule["slug"], entries[0][1],
                                 gallery=[e[1] for e in entries[1:]]))
            continue

        # 2. מארז
        if rule.get("collection"):
            shades = [e for e in entries if SHADE_RE.match(e[0])]
            box = [e for e in entries if not SHADE_RE.match(e[0])]

            if box:
                products.append(make(rule, f'{rule["slug"]}-kit', box[0][1],
                                     gallery=[e[1] for e in box[1:]]))

            sh = rule.get("shade", {})
            for stem, local in shades:
                products.append(make(
                    rule, stem, local,
                    title=f'{sh.get("title", rule["title"])} — גוון {stem}',
                    price=sh.get("price"),
                    category=sh.get("category"),
                    shade=stem,
                ))
            continue

        # 3. רגיל
        for stem, local in entries:
            is_shade = bool(SHADE_RE.match(stem))
            products.append(make(
                rule, stem, local,
                title=f'{rule["title"]} — גוון {stem}' if is_shade
                      else f'{rule["title"]} — {stem}',
                shade=stem if is_shade else None,
            ))

    # הגנה מפני מזהים כפולים
    seen = {}
    for p in products:
        if p["id"] in seen:
            seen[p["id"]] += 1
            p["id"] = f'{p["id"]}-{seen[p["id"]]}'
        else:
            seen[p["id"]] = 1

    return products, skipped


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true", help="רק סריקה, ללא הורדה")
    ap.add_argument("--download", action="store_true", help="סריקה + הורדה + בניית קטלוג")
    ap.add_argument("--limit", type=int, default=0, help="הגבלת מספר תמונות (לבדיקה)")
    args = ap.parse_args()

    if not (args.scan or args.download):
        ap.error("צריך --scan או --download")

    print("סורק את הדרייב…\n")
    tree = scan_tree(ROOT_FOLDER, "ב.עלמה")
    leaves = flatten_leaves(tree)

    total = sum(len(l["files"]) for l in leaves)
    print(f"\n{'='*60}")
    print(f"נמצאו {len(leaves)} תיקיות עם תוכן, {total} קבצים סה\"כ\n")
    for l in leaves:
        print(f"  {' / '.join(l['path']):<45} {len(l['files']):>4} קבצים")

    (DATA_DIR).mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "drive_tree.json").write_text(
        json.dumps(leaves, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"\nעץ התיקיות נשמר ב- data/drive_tree.json")

    if args.scan:
        return

    # ---- הורדה
    print(f"\n{'='*60}\nמוריד תמונות…\n")
    rules = load_rules()
    downloaded, stats = {}, {"ok": 0, "cached": 0, "failed": 0}
    count = 0

    for leaf in leaves:
        rule = match_rule(leaf["path"], rules)
        if not rule:
            continue
        folder_slug = slugify("-".join(leaf["path"][1:]) or leaf["path"][0])
        for f in leaf["files"]:
            if args.limit and count >= args.limit:
                break
            ext = Path(f["name"]).suffix.lower() or ".jpg"
            if ext in (".mp4", ".mov"):
                continue
            rel = f'{folder_slug}/{slugify(Path(f["name"]).stem)}{ext}'
            status, final = download_file(f["id"], IMG_DIR / rel)
            stats[status] = stats.get(status, 0) + 1
            if final:
                downloaded[f["id"]] = str(final.relative_to(IMG_DIR))
            count += 1
            if count % 25 == 0:
                print(f"  … {count} קבצים", flush=True)

    print(f"\nהורדה: {stats}")

    # ---- קטלוג
    products, skipped = build_catalog(leaves, rules, downloaded)
    (DATA_DIR / "products.json").write_text(
        json.dumps({"products": products}, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    print(f"\n{'='*60}")
    print(f"נבנו {len(products)} מוצרים → data/products.json")
    if skipped:
        print(f"\nתיקיות ללא כלל תמחור (לא נכנסו לקטלוג):")
        for s in skipped:
            print(f"  - {s['path']} ({s['files']} קבצים)")
        print("\nכדי להוסיף אותן: הוסיפו כלל ב- tools/catalog_rules.json")


if __name__ == "__main__":
    main()
