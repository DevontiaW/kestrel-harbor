"""Phone-width (390 px) screenshots of every lesson with its reveal open, plus overflow and broken-link checks.
Run: npm run build && python capture-lessons.py   (needs Playwright + Microsoft Edge). Writes docs/screenshots/lesson-*.png."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / 'docs' / 'screenshots'; OUT.mkdir(parents=True, exist_ok=True)
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True)
    pg = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    pg.on('pageerror', lambda e: problems.append(str(e)))
    for f in sorted((HERE / 'lessons').glob('*.html')):
        pg.goto(f.as_uri())
        pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
        over = pg.evaluate('document.documentElement.scrollWidth - innerWidth')
        if over > 0: problems.append(f'{f.name}: horizontal overflow {over}px')
        for href in pg.eval_on_selector_all('a[href]', 'as => as.map(a => a.getAttribute("href"))'):
            if '://' not in href and not (f.parent / href.split('#')[0]).exists(): problems.append(f'{f.name}: broken link {href}')
        pg.screenshot(path=str(OUT / f'lesson-{f.stem}-phone.png'), full_page=True)
        print(f.name, 'ok' if over <= 0 else f'overflow {over}')
    # Narrowest common phone (375 px): the page, and any element inside it (map labels, tables), must not reach past the edge.
    pg = b.new_page(viewport={'width': 375, 'height': 812})  # not mobile emulation: that widens the layout viewport to fit the overflow and hides it
    for f in sorted((HERE / 'lessons').glob('*.html')):
        pg.goto(f.as_uri())
        pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
        over = pg.evaluate('document.documentElement.scrollWidth - innerWidth')
        wide = pg.evaluate('''[...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 || (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')).map(e => e.tagName + '.' + e.className).slice(0, 5)''')
        if over > 0 or wide: problems.append(f'{f.name} at 375 px: overflow {over}px, wide elements {wide}')
    b.close()
print('problems:', problems or 'none')
sys.exit(1 if problems else 0)
