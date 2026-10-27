"""Screenshots of the observability layer at desktop (1440 px) and phone (390 px) width.
Run: npm run build && python capture-observability.py   (needs Playwright + Microsoft Edge). Writes docs/screenshots/*.png.
The model is deterministic, so the same clock gives the same numbers in every capture."""
import sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
URL = (HERE / 'index.html').as_uri()
OUT = HERE / 'docs' / 'screenshots'; OUT.mkdir(parents=True, exist_ok=True)
errors = []

def prepare(pg):
    pg.goto(URL); time.sleep(2)
    pg.evaluate('window.__district.setRunning(false)'); pg.click('#reset')
    pg.evaluate('window.__district.model.advance(240)')   # 12:00, one reviewer: the review queue is long
    pg.evaluate('window.__district.setRunning(false)')
    pg.select_option('#trace-task', 'T-030')               # a task that waited in the review line
    pg.select_option('#lab-change', 'addReviewer'); pg.click('#lab-run'); time.sleep(.3)

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True, args=['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'])
    for name, vp, mobile in [('desktop', {'width': 1440, 'height': 1000}, False), ('phone', {'width': 390, 'height': 844}, True)]:
        pg = b.new_page(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        prepare(pg)
        for part in ['obs-metrics', 'obs-trace', 'obs-lab', 'obs-break']:
            pg.locator(f'#{part}').screenshot(path=str(OUT / f'{part}-{name}.png'))
        pg.click('#break-modelApi'); time.sleep(.2); pg.locator('#obs-break').screenshot(path=str(OUT / f'obs-break-{name}.png')); pg.click('#break-restore')
        pg.locator('#observability').screenshot(path=str(OUT / f'observability-{name}.png'))
        print(name, 'overflow px:', pg.evaluate('document.documentElement.scrollWidth - innerWidth'))
    b.close()
print('errors:', errors or 'none')
sys.exit(1 if errors else 0)
