#!/usr/bin/env python3
"""Build preview.html: inlines styles.css, 분담금.json (slimmed) and app.js
into index.html's body, so the whole calculator can be viewed as one file
without a local server (fetch() of 분담금.json would otherwise fail over
file://)."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

INDEX_HTML = ROOT / 'index.html'
STYLES_CSS = ROOT / 'styles.css'
APP_JS = ROOT / 'app.js'
DATA_JSON = ROOT / '분담금.json'
OUT_HTML = ROOT / 'preview.html'


def slim_data(data):
    units = []
    for u in data['세대']:
        flat = {
            '타입': u['타입'],
            '동': u['동'],
            '호수': u['호수'],
            '전용면적_m2': u['전용면적_m2'],
            '공급면적_m2': u['공급면적_m2'],
            '종전평균': u['종전평가금액']['종전평균'],
            '종후평균': u['종후평가금액']['종후평균'],
            '권리가액': u['권리가액'],
            '분담금': u['분담금'],
        }
        units.append(flat)
    return {'세대': units}


def extract_body(html):
    m = re.search(r'<body[^>]*>(.*)</body>', html, re.DOTALL | re.IGNORECASE)
    if not m:
        raise ValueError('index.html: <body> tag not found')
    body = m.group(1)
    # remove the app.js script tag (it is inlined separately below)
    body = re.sub(
        r'\s*<script[^>]*src=["\']app\.js[^"\']*["\'][^>]*>\s*</script>\s*',
        '\n',
        body,
        flags=re.IGNORECASE,
    )
    return body


def main():
    index_html = INDEX_HTML.read_text(encoding='utf-8')
    styles_css = STYLES_CSS.read_text(encoding='utf-8')
    app_js = APP_JS.read_text(encoding='utf-8')
    data = json.loads(DATA_JSON.read_text(encoding='utf-8'))

    slimmed = slim_data(data)
    data_json_compact = json.dumps(slimmed, ensure_ascii=False, separators=(',', ':'))

    body_html = extract_body(index_html)

    out = []
    out.append('<style>')
    out.append(styles_css)
    out.append('</style>')
    out.append('<script>window.__DATA__ = ' + data_json_compact + ';</script>')
    out.append(body_html)
    out.append('<script>')
    out.append(app_js)
    out.append('</script>')

    OUT_HTML.write_text('\n'.join(out), encoding='utf-8')

    size = OUT_HTML.stat().st_size
    print(f'Wrote {OUT_HTML.name}: {size:,} bytes')


if __name__ == '__main__':
    main()
