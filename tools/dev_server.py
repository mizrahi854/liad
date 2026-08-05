#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
שרת פיתוח מקומי לאתר LIAD.

למה לא python -m http.server סתם: הוא לא שולח כותרות מטמון, ולכן הדפדפן
שומר את קובצי ה-JS והCSS ומגיש אותם גם אחרי שינוי. בעבודה על מודולים
(type="module") זה מבלבל במיוחד — הדף נראה כאילו הקוד לא השתנה.

הרצה:
    python3 tools/dev_server.py [port]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webp": "image/webp",
        ".avif": "image/avif",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # שקט. שגיאות בלבד.
        if not str(args[1] if len(args) > 1 else "").startswith(("2", "3")):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4176
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"LIAD dev server → http://localhost:{port}/liad-landing/index.html")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
