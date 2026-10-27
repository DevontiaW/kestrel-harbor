"""Screenshots of the quality and security features at desktop (1440 px) and phone (390 px) width:
defect marks on a trace, the quality and security rules card, the checkpoint (on, then off under Break it), and the
enterprise view. Run: npm run build && python capture-govern.py   (needs Playwright + Microsoft Edge).
Writes docs/screenshots/gov-*.png. Deterministic: the same clock and rules give the same picture."""
import sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
URL = (HERE / 'index.html').as_uri()
OUT = HERE / 'docs' / 'screenshots'; OUT.mkdir(parents=True, exist_ok=True)
errors = []

def first_task_with(pg, text):
    for v in pg.eval_on_selector_all('#trace-task option', 'os => os.map(o => o.value)')[1:]:
        pg.select_option('#trace-task', v)
        if text in pg.inner_text('#trace-summary'): return v
    raise SystemExit(f'no task shows "{text}"')

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True, args=['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'])
    for name, vp, mobile in [('desktop', {'width': 1440, 'height': 1000}, False), ('phone', {'width': 390, 'height': 844}, True)]:
        pg = b.new_page(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(URL); time.sleep(2)
        pg.evaluate('window.__district.setRunning(false)'); pg.click('#reset'); pg.click('#rev-2')
        pg.click('#rule-defects'); pg.click('#rule-poison')
        pg.evaluate('window.__district.model.advance(480)'); pg.evaluate('window.__district.setRunning(false)'); time.sleep(.3)
        first_task_with(pg, 'Defect escaped'); pg.locator('#obs-trace').screenshot(path=str(OUT / f'gov-defect-trace-{name}.png'))
        first_task_with(pg, 'Blocked at checkpoint'); pg.locator('#obs-trace').screenshot(path=str(OUT / f'gov-checkpoint-trace-{name}.png'))
        pg.locator('#obs-metrics').screenshot(path=str(OUT / f'gov-metrics-{name}.png'))
        pg.locator('#obs-rules').screenshot(path=str(OUT / f'gov-rules-{name}.png'))
        pg.click('#break-checkpoint'); pg.evaluate('window.__district.model.advance(1)'); time.sleep(.2)
        pg.locator('#obs-break').screenshot(path=str(OUT / f'gov-checkpoint-off-{name}.png'))
        pg.click('#enterprise-toggle'); time.sleep(.3)
        pg.locator('#obs-enterprise').screenshot(path=str(OUT / f'gov-enterprise-{name}.png'))
        pg.click('#break-restore')
        pg.select_option('#lab-change', 'removeApproval'); pg.click('#lab-run'); time.sleep(.2)
        pg.locator('#obs-lab').screenshot(path=str(OUT / f'gov-lab-{name}.png'))
        print(name, 'overflow px:', pg.evaluate('document.documentElement.scrollWidth - innerWidth'))
    b.close()
print('errors:', errors or 'none')
sys.exit(1 if errors else 0)
