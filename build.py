#!/usr/bin/env python3
"""Bundle src/{index.html,style.css,0*.js} into a single portable trace-viewer.html.

Also injects the APP_VERSION constant (single source of truth in 01-core.js)
into index.html's <!--APP_VERSION--> placeholder (used by <meta name="version">).
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "trace-viewer.html"


def read_version():
    """Extract APP_VERSION = 'x.y.z' from 01-core.js."""
    txt = (SRC / "01-core.js").read_text(encoding="utf-8")
    m = re.search(r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", txt)
    return m.group(1) if m else "0.0.0"


html = (SRC / "index.html").read_text(encoding="utf-8")
css = (SRC / "style.css").read_text(encoding="utf-8")
js = "\n".join(
    f"/* ==== {p.name} ==== */\n" + p.read_text(encoding="utf-8")
    for p in sorted(SRC.glob("0*.js"))
)

if "<!--INLINE_CSS-->" not in html or "<!--INLINE_JS-->" not in html:
    sys.exit("index.html is missing the INLINE_CSS / INLINE_JS placeholders")

version = read_version()
html = html.replace("<!--APP_VERSION-->", version)
html = html.replace("<!--INLINE_CSS-->", "<style>\n" + css + "\n</style>")
html = html.replace("<!--INLINE_JS-->", "<script>\n" + js + "\n</script>")

OUT.write_text(html, encoding="utf-8")
print(f"built {OUT}  v{version}  ({len(html)/1024:.1f} KB)")
