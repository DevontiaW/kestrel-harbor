"""Functional browser test for Kestrel Harbor: exercises every control and checks its effect.
Run: python functional-test.py   (needs Playwright + Microsoft Edge). Prints PASS/FAIL per check."""
import json, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

# Model numbers the quality and security checks compare the page against (2 reviewers, full shift).
EXPECT_JS = """
import { runFloor, runExperiment } from './experiment-lab.mjs';
import { QUALITY_ON, SECURITY_ON } from './agent-floor.mjs';
import { NODES, INCIDENTS, recordedBy } from './network-surface.mjs';
const lab = runExperiment('removeApproval', { baseline: { reviewers: 2, ...QUALITY_ON } });
console.log(JSON.stringify({
  quality: runFloor({ reviewers: 2, ...QUALITY_ON }).metrics().quality,
  security: runFloor({ reviewers: 2, ...SECURITY_ON }).metrics().security,
  labNoApproval: { base: lab.baseline.escaped, variant: lab.variant.escaped },
  labCheckpointOff: runExperiment('checkpointOff', { baseline: { reviewers: 2, ...SECURITY_ON } }).variant.unsafe,
  labCheckpointBase: runExperiment('checkpointOff', { baseline: { reviewers: 2, ...SECURITY_ON } }).baseline.unsafe,
  map: { boxes: NODES.length, steps: INCIDENTS.sendOutside.path.length - 1, seen: recordedBy('sendOutside').length },
}));
"""

URL = (Path(__file__).parent / 'index.html').resolve().as_uri()
results, errors = [], []

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

def js(pg, expr): return pg.evaluate(expr)
def M(pg, expr): return pg.evaluate(f'(() => {{ const d = window.__district, m = d.model; return {expr}; }})()')

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True, args=['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'])
    pg = b.new_page(viewport={'width': 1600, 'height': 1000})
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(URL); time.sleep(2.5)
    check('page loads with WebGL scene and no error panel', pg.locator('#world canvas').count() == 1 and pg.locator('#error').is_hidden())
    check('Intro discloses shift handoffs do not change staffing or arrivals', 'shift handoffs are visual' in pg.inner_text('.intro').lower() and 'staffing and arrivals stay fixed' in pg.inner_text('.intro').lower())

    # Run / pause / step / restart / speed
    t0 = M(pg, 'm.time'); time.sleep(1.2); t1 = M(pg, 'm.time')
    check('starts running: clock advances', t1 > t0, f'{t0}->{t1}')
    pg.click('#play'); time.sleep(.2); a = M(pg, 'm.time'); time.sleep(1); bb = M(pg, 'm.time')
    check('Pause stops the clock', a == bb and pg.inner_text('#play') == 'Run', f'{a}->{bb}')
    pg.click('#step'); check('+10 min advances exactly 10 simulated minutes', M(pg, 'm.time') == bb + 10)
    pg.click('#reset'); check('Restart resets clock, counters and agent floor', M(pg, 'm.time') == 0 and M(pg, 'm.received') == 0 and M(pg, 'm.floor.metrics().arrived') == 0 and pg.inner_text('#clock') == '08:00')
    pg.select_option('#speed', '1'); pg.click('#play'); time.sleep(2); slow = M(pg, 'm.time')
    pg.click('#reset'); pg.select_option('#speed', '20'); time.sleep(2); fast = M(pg, 'm.time')
    check('Speed 20x runs much faster than 1x', fast > slow * 8, f'1x={slow} 20x={fast}')
    pg.click('#play')  # pause for deterministic checks

    # Internet outage (sidebar checkbox)
    pg.click('#reset'); pg.click('#step'); pg.click('#step')
    base = M(pg, '({admin: m.adminDone, res: m.floor.busy.research, field: m.fieldTime, buf: m.buffered, exec: m.floor.busy.execute})')
    pg.uncheck('#internet')
    for _ in range(3): pg.click('#step')
    after = M(pg, '({admin: m.adminDone, res: m.floor.busy.research, field: m.fieldTime, buf: m.buffered, exec: m.floor.busy.execute})')
    check('Internet off: banner + red pill shown', pg.locator('#outage-banner').is_visible() and 'INTERNET' in pg.inner_text('#outage-banner') and 'off' in pg.get_attribute('#svc-internet', 'class'))
    check('Internet pill exposes its on/off state to assistive technology', pg.get_attribute('#svc-internet', 'aria-pressed') == 'false')
    check('Internet off: reports buffer on machines', after['buf'] == base['buf'] + 60, f"{base['buf']}->{after['buf']}")
    check('Internet off: field machines keep working', after['field'] == base['field'] + 30)
    check('Internet off: remote-model research agent stops; clinic desk stops', after['res'] == base['res'] and after['admin'] == base['admin'])
    check('Internet off: local execution agents keep working', after['exec'] > base['exec'], f"{base['exec']}->{after['exec']}")
    pg.check('#internet'); pg.click('#step'); flushed = M(pg, 'm.buffered')
    check('Restored Internet pill exposes its active state', pg.get_attribute('#svc-internet', 'aria-pressed') == 'true')
    check('Internet restored: buffer flushes at 6/min, not instantly', flushed == after['buf'] - 60, f"{after['buf']}->{flushed}")

    # RTK correction via stage-style pill
    f0 = M(pg, 'm.fieldTime'); pos0 = M(pg, '[d.vehicle("tractor").x, d.vehicle("tractor").z]')
    pg.click('#svc-positioning'); pg.click('#step'); time.sleep(.2)
    check('RTK pill off: field work clock freezes', M(pg, 'm.fieldTime') == f0 and not M(pg, 'm.positioning'))
    check('RTK off: tractor does not move', M(pg, '[d.vehicle("tractor").x, d.vehicle("tractor").z]') == pos0)
    pg.click('#svc-positioning'); check('RTK pill restores the checkbox state too', pg.is_checked('#positioning'))
    pg.click('#reset'); pg.evaluate('window.__district.model.advance(41)'); pg.click('#svc-positioning'); pg.evaluate('window.__district.model.advance(14)')
    check('RTK outage lets an already-dispatched grain load finish while harvest stops', M(pg, 'm.coop.hauled') == 1 and M(pg, 'm.fieldTime') == 41 and M(pg, 'm.coop.cartFill') == 1)
    check('RTK outage text distinguishes harvesting from the in-progress haul', 'already-dispatched grain load can finish' in pg.inner_text('#scenario'))

    # Power outage
    pg.click('#reset'); pg.uncheck('#power')
    for _ in range(10): pg.click('#step')
    check('Power off: no cargo credited, trucks wait at dock', M(pg, 'm.received') == 0 and M(pg, 'm.trucks.every(t => t.phase === "unloading")'))
    check('Power off: agent floor finishes nothing', M(pg, 'm.floor.done.length') == 0)
    check('Power off: self-powered shuttle keeps moving', M(pg, 'm.roadTime') == 100)
    pg.check('#power')

    # Reviewers and compare
    pg.click('#rev-2'); check('Reviewer buttons staff the review desk', M(pg, 'm.floor.reviewers') == 2 and 'on' in pg.get_attribute('#rev-2', 'class'))
    pg.click('#rev-1'); pg.click('#compare')
    rows = pg.locator('#compare-out tbody tr'); txt = pg.inner_text('#compare-out')
    check('Compare staffing renders 3 shift results and labels completed-task cycle time', rows.count() == 3 and '117 min' in txt and '20 min' in txt and 'avg completed cycle' in txt.lower() and 'finished tasks only' in txt.lower(), txt.replace('\n', ' | ')[:160])

    # Plant staffing moves the constraint (original four-stage lesson)
    check('Plant starts with paint as the constraint', M(pg, 'm.plant.metrics().constraint') == 1)
    pg.click('[data-stations="1:2"]'); check('Second paint booth moves the constraint to assembly', M(pg, 'm.plant.machines[1]') == 2 and M(pg, 'm.plant.metrics().constraint') == 3)
    pg.click('[data-stations="3:2"]'); check('Second assembly stand: constraint returns to paint (1.5 vs 2/hr)', M(pg, 'm.plant.metrics().constraint') in (1, 3) and M(pg, 'm.plant.machines[3]') == 2)
    pg.click('[data-stations="1:1"]'); pg.click('[data-stations="3:1"]')

    # Trucks reverse into their dock bay; the grain truck hauls to the co-op
    pg.click('#reset'); pg.evaluate('window.__district.model.advance(14)'); time.sleep(.3)
    rot = pg.evaluate('(() => { const d = window.__district; return [d.vehicle("truck-a").z, d.model.trucks[0].phase]; })()')
    check('Truck backs into Bay A and unloads at the dock', rot[1] == 'unloading' and abs(rot[0] - 23.6) < .2, str(rot))
    g0 = M(pg, 'd.vehicle("graintruck").x'); pg.evaluate('window.__district.model.advance(31)'); time.sleep(.3)
    check('Grain truck leaves the field for the co-op', M(pg, 'm.coop.truck.phase') == 'to-coop' and M(pg, 'd.vehicle("graintruck").x') > g0)
    pg.evaluate('window.__district.model.advance(20)'); check('Grain load dumped at the co-op pit', M(pg, 'm.coop.hauled') >= 1)
    check('Shift readout shows the current shift', 'shift' in pg.inner_text('#shift').lower())

    # Inspector: list, canvas click, hover, follow, close, Escape
    pg.click('#inspect-jump')
    check('Inspect-list shortcut focuses the named-object selector', pg.evaluate('document.activeElement.id') == 'object-select')
    pg.select_option('#object-select', 'coop')
    check('Object list opens inspector with mock data', pg.locator('#inspector').is_visible() and pg.inner_text('#ins-title') == 'Kestrel Grain Co-op')
    check('Inspector details do not live-announce every simulation update', pg.locator('#inspector').get_attribute('aria-live') is None and 'Kestrel Grain Co-op selected' in pg.inner_text('#selection-status'))
    pg.keyboard.press('Escape'); check('Escape closes inspector and announces cleared selection', pg.locator('#inspector').is_hidden() and pg.inner_text('#selection-status') == 'Object selection cleared.')
    pg.click('#reset'); pg.select_option('#speed', '2'); pg.click('#play'); time.sleep(1.5); pg.click('#play')
    pt = M(pg, 'd.worldToScreen(d.vehicle("tractor").x, 1.2, d.vehicle("tractor").z)')
    box = pg.locator('#world').bounding_box()
    pg.mouse.move(box['x'] + pt[0], box['y'] + pt[1]); time.sleep(.3)
    check('Hover over tractor shows hover tag', pg.locator('#hover-card').is_visible() and 'AG-07' in pg.inner_text('#hover-card'))
    pg.mouse.click(box['x'] + pt[0], box['y'] + pt[1]); time.sleep(.2)
    check('Clicking tractor in 3D selects it', M(pg, 'd.selected') == 'tractor' and pg.inner_text('#ins-title') == 'AG-07')
    check('Inspector Follow button visible for vehicles', pg.locator('#follow').is_visible())
    pg.click('#follow'); pg.click('#play'); time.sleep(2.5)
    dist = M(pg, 'Math.hypot(d.controls.target.x - d.vehicle("tractor").x, d.controls.target.z - d.vehicle("tractor").z)')
    check('Follow keeps the camera on the moving tractor', M(pg, 'd.following') and dist < 2.5, f'distance {dist:.2f}')
    pg.click('#close-inspector'); check('Close button deselects', M(pg, 'd.selected') is None)

    # Callout click
    pg.click('#play'); pg.click('#home-view'); time.sleep(2)
    pg.locator('.tag:visible', has_text='CLINIC').first.click(); check('Clicking a callout tag selects its object', M(pg, 'd.selected') == 'clinic')

    # Camera controls
    pg.click('[data-district="farm"]'); time.sleep(2)
    check('Farm tab flies camera to the field and exposes current district', M(pg, 'Math.hypot(d.controls.target.x + 30, d.controls.target.z + 20)') < 1 and abs(M(pg, 'd.camera.zoom') - 2.0) < .05 and pg.get_attribute('[data-district="farm"]', 'aria-current') == 'location' and pg.get_attribute('[data-district="all"]', 'aria-current') is None)
    z = M(pg, 'd.camera.zoom'); pg.click('#zoom-in'); check('Zoom + increases zoom', M(pg, 'd.camera.zoom') > z)
    z = M(pg, 'd.camera.zoom'); pg.click('#zoom-out'); check('Zoom − decreases zoom', M(pg, 'd.camera.zoom') < z)
    pg.click('#home-view'); time.sleep(2); check('Home returns to the wide view and updates current district', abs(M(pg, 'd.camera.zoom') - .6) < .05 and pg.get_attribute('[data-district="all"]', 'aria-current') == 'location')

    # Layers
    pg.select_option('#label-mode', 'off'); time.sleep(.3); check('Labels Off hides all callout tags', pg.locator('.tag:visible').count() == 0)
    pg.select_option('#label-mode', 'all'); time.sleep(.3); n_all = pg.locator('.tag:visible').count()
    pg.select_option('#label-mode', 'smart'); time.sleep(.3); n_smart = pg.locator('.tag:visible').count()
    check('Smart labels show fewer tags than All', 0 < n_smart < n_all, f'smart {n_smart} all {n_all}')
    pg.uncheck('#signals'); pg.uncheck('#utilities'); time.sleep(.2); check('Signals and utilities layers hide', M(pg, 'd.layers') == {'signals': False, 'utilities': False})
    pg.check('#signals'); pg.check('#utilities'); time.sleep(.2); check('Layers show again', M(pg, 'd.layers') == {'signals': True, 'utilities': True})

    # Review backlog spills into Harbor St and stops trucks and street traffic; three reviewers clear it
    pg.click('#reset'); pg.click('#rev-1')
    pg.evaluate('(() => { const m = window.__district.model; for (let i = 0; i < 600 && !m.blocked; i++) m.advance(1); m.advance(20); })()'); time.sleep(.4)
    rec = M(pg, 'm.received'); pg.evaluate('window.__district.model.advance(60)'); time.sleep(.3)
    pg.click('[data-district="agents"]'); time.sleep(2)
    check('Backlog past rack + pad blocks Harbor St (tag shown)', M(pg, 'm.blocked') and pg.locator('.tag:visible', has_text='HARBOR ST BLOCKED').count() == 1)
    check('Blocked street: no parts reach the plant', M(pg, 'm.received') == rec)
    x0 = pg.evaluate('(() => { const d = window.__district; return d.vehicle("car-15").x; })()'); time.sleep(.6)
    check('Blocked street: Harbor St car stands still', pg.evaluate('window.__district.vehicle("car-15").x') == x0)
    pg.click('#rev-3'); pg.evaluate('(() => { const m = window.__district.model; for (let i = 0; i < 600 && m.blocked; i++) m.advance(1); })()'); time.sleep(.3)
    check('Three reviewers clear the street', not M(pg, 'm.blocked')); pg.click('#rev-1')

    # Dependency x-ray and water
    pg.hover('#svc-power'); time.sleep(.3)
    check('Hovering Power x-rays its dependents', M(pg, 'd.xray') == 'power' and pg.locator('.tag.dep:visible').count() > 2)
    pg.mouse.move(5, 5); time.sleep(.2); check('Leaving the pill clears the x-ray', M(pg, 'd.xray') is None)
    pg.select_option('#trace-service', 'power'); time.sleep(.2)
    check('Trace selector keeps Power dependents highlighted', M(pg, 'd.xray') == 'power' and pg.locator('.tag.dep:visible').count() > 2)
    pg.click('#svc-power'); time.sleep(.2)
    check('Dependency trace stays on while the separate Power control cuts service', M(pg, 'd.xray') == 'power' and not M(pg, 'm.power'))
    pg.click('#svc-power'); pg.select_option('#trace-service', '')
    check('Clearing Trace removes highlights without changing restored service', M(pg, 'd.xray') is None and M(pg, 'm.power'))
    pg.locator('#trace-service').focus(); pg.keyboard.press('ArrowDown'); pg.keyboard.press('Enter')
    check('Trace selector can be operated from the keyboard', M(pg, 'd.xray') == 'internet' and pg.locator('#trace-service').input_value() == 'internet')
    pg.select_option('#trace-service', '')
    pg.click('#svc-water'); check('Water pill opens the water tower', M(pg, 'd.selected') == 'waterTower' and 'Water tower' in pg.inner_text('#ins-title'))
    pg.evaluate("() => { const d = window.__district; d.select(null); const v = d.DISTRICTS.clinic[0]; d.flyTo(v, 2.6, .01); }"); time.sleep(.6)
    hx, hy = pg.evaluate("() => { const d = window.__district, r = d.host.getBoundingClientRect(), [x, y] = d.worldToScreen(-30, 2, 13.5); return [r.left + x, r.top + y]; }")
    pg.mouse.move(hx, hy); time.sleep(.4)
    check('Mouse hover on the clinic shows a detail card with live rows', pg.locator('#hover-card').is_visible() and 'Kestrel Harbor Clinic' in pg.inner_text('#hover-card') and pg.locator('#hover-card .hc-row').count() >= 3, pg.inner_text('#hover-card')[:80] if pg.locator('#hover-card').is_visible() else 'hidden')
    pg.mouse.move(5, 5); time.sleep(.3); check('Moving off hides the hover card', pg.locator('#hover-card').is_hidden())
    pg.evaluate("() => window.__district.select('agents')"); time.sleep(.3)
    check('Agent floor inspector says reviewers are people', 'ai agents work, people review' in pg.inner_text('#ins-eyebrow').lower() and 'reviewers (people)' in pg.inner_text('#ins-rows').lower())
    check('Agent floor card states the fixed 6-minute review time', '6 min per task, fixed' in pg.inner_text('#ins-rows'))
    pg.evaluate("() => window.__district.select('spill')"); time.sleep(.3)
    check('Spill card says the road closes only when rack and pad are full', 'rack (16) and pad (20) are both full' in pg.inner_text('#ins-rows') and 'not goods' in pg.inner_text('#ins-rows'))

    # Harbor reveal: the tour makes the quay active, then flies from the wide shot into the landing area.
    tp = b.new_page(viewport={'width': 1920, 'height': 1080}); tp.on('pageerror', lambda e: errors.append(str(e)))
    tp.goto(URL + '?tour&capture'); time.sleep(2)
    tp.evaluate("() => { for (let f = 0; f < 474; f++) window.__frame(1/30); }")
    wide_view = tp.evaluate("() => { const d = window.__district; return {tab: document.querySelector('[data-district=\\\"harbor\\\"]').getAttribute('class'), zoom: d.camera.zoom, x: d.controls.target.x, z: d.controls.target.z}; }")
    check('Tour holds the settled wide harbor reveal before the close-up', wide_view['tab'] == 'on' and abs(wide_view['zoom'] - 1.8) < .02 and abs(wide_view['x'] - 28) < .2 and abs(wide_view['z'] - 56) < .2, str(wide_view))
    tp.evaluate("() => { for (let f = 474; f < 540; f++) window.__frame(1/30); }")
    port_view = tp.evaluate("() => { const d = window.__district; return {tab: document.querySelector('[data-district=\\\"harbor\\\"]').getAttribute('class'), zoom: d.camera.zoom, x: d.controls.target.x, z: d.controls.target.z}; }")
    check('Tour flies into the working quay with Harbor selected', port_view['tab'] == 'on' and abs(port_view['zoom'] - 2.2) < .02 and abs(port_view['x'] - 28) < .2 and abs(port_view['z'] - 52) < .2, str(port_view))
    hover_left = tp.evaluate("() => document.querySelector('#hover-card').getBoundingClientRect().left")
    check('Harbor hover card sits to the right of the quay', hover_left > 1150, f'left {hover_left:.0f}px')

    # Builder-led tour checks: inspectability, changeable assumptions, agent boundary and closing question.
    # The reveal above already advanced 540 frames (18s); continue to frame 756 (25.2s).
    tp.evaluate("() => { for (let f = 540; f < 756; f++) window.__frame(1/30); }")
    check('Tour demonstrates changing a modeled input', tp.evaluate('window.__district.model.plant.machines[1]') == 2 and tp.inner_text('#caption') == 'Add one booth. The modeled constraint moves.')
    tp.evaluate("() => { for (let f = 756; f < 1350; f++) window.__frame(1/30); }")
    check('Tour distinguishes simulated agents from coding agents', 'These office agents are simulated. Coding agents helped build the town.' in tp.inner_text('#caption'))
    tp.evaluate("() => { for (let f = 1350; f < 1500; f++) window.__frame(1/30); }")
    check('Tour demonstrates a controlled staffing comparison', tp.evaluate('window.__district.model.floor.reviewers') == 1 and 'reviewer' in tp.inner_text('#caption').lower())
    check('Tour keeps labels sparse: no callout tags during the tour', tp.locator('.tag:visible').count() == 0)
    tp.evaluate("() => { for (let f = 1500; f < 2640; f++) window.__frame(1/30); }")
    check('Tour ends with a builder-first question', tp.inner_text('#caption') == 'What process would you want to make inspectable?')
    tp.close()

    # Observability layer: metrics, trace, Experiment Lab and break-it, on the full 8-hour shift in the real page
    pg.goto(URL); time.sleep(2); pg.evaluate('window.__district.setRunning(false)'); pg.click('#reset'); pg.click('#rev-1'); pg.evaluate('window.__district.model.advance(480)'); pg.evaluate('window.__district.setRunning(false)')
    om = M(pg, '(() => { const x = m.floor.metrics(); return { wait: x.avgReviewWait, thr: x.throughputPerHour, L: x.littlesLaw, review: x.stations.find(s => s.id === "review").queued }; })()')
    check('Observability metrics on a full shift match the model (wait at review, finished/hr)', pg.inner_text('#obs-wait-review') == f"{om['wait']:.1f}" and pg.inner_text('#obs-throughput') == f"{om['thr']:.1f}", f"{pg.inner_text('#obs-wait-review')} min, {pg.inner_text('#obs-throughput')}/hr")
    pill1 = pg.inner_text('#obs-little .pill')
    check("Little's Law check shows its numbers and fails visibly on the overloaded 1-reviewer shift", pill1.startswith('off by') and f"{om['L']['observedWip']:.2f}" in pg.inner_text('#obs-little'), pill1)
    pg.click('#reset'); pg.click('#rev-2'); pg.evaluate('window.__district.model.advance(480)'); pg.evaluate('window.__district.setRunning(false)')
    pill2 = pg.inner_text('#obs-little .pill')
    check("Little's Law check holds on the stable 2-reviewer shift", pill2.startswith('holds, within'), pill2)
    pg.click('#reset'); pg.click('#rev-1'); pg.evaluate('window.__district.model.advance(480)'); pg.evaluate('window.__district.setRunning(false)')
    check('Work-in-progress table lists all five stages with the review queue', pg.locator('#obs-wip tbody tr').count() == 5 and str(om['review']) in pg.inner_text('#obs-wip tbody tr:nth-child(4)'))
    both = M(pg, 'm.floor.done.slice(-40).filter(t => t.n % 15 === 0).at(-1).id'); plain = M(pg, 'm.floor.done.slice(-40).filter(t => t.n % 3 && t.n % 5).at(-1).id')
    pg.select_option('#trace-task', both)
    spans = M(pg, f'm.floor.task("{both}").spans.length')
    check('Trace bar draws one segment per span and marks rework and human approval', pg.locator('#trace-bar > span:not(.mark)').count() == spans and pg.locator('#trace-bar .mark').count() == 2 and both in pg.inner_text('#trace-summary'), f'{both}: {spans} spans')
    pg.select_option('#trace-task', plain)
    check('Trace of a plain task has no marks and exactly 16 minutes of work', pg.locator('#trace-bar .mark').count() == 0 and 'Working 16 min' in pg.inner_text('#trace-summary'), pg.inner_text('#trace-summary')[:80])
    pg.select_option('#lab-change', 'addReviewer'); pg.click('#lab-run')
    lab = pg.inner_text('#lab-out'); first = [pg.inner_text(f'#lab-out tbody tr:nth-child(1) td:nth-child({i})') for i in (2, 3, 4)]
    check('Experiment Lab compares baseline and change with deltas and top waits', first == ['64', '115', '+51'] and 'In line for review' in lab, str(first))
    pg.click('#rev-2'); check('Experiment Lab result is cleared when staffing changes', 'Run both again' in pg.inner_text('#lab-out')); pg.click('#rev-1')
    pg.select_option('#lab-change', 'cutModelApi'); pg.click('#lab-run')
    check('Experiment Lab model API cut is labelled with its window', '10:00 to 10:30' in pg.inner_text('#lab-out'))
    pg.click('#reset'); pg.click('#step'); pg.click('#step'); res = M(pg, 'm.floor.busy.research')
    pg.click('#break-modelApi')
    for _ in range(3): pg.click('#step')
    check('Break it: model API outage stalls research, shows banner and stall list', M(pg, 'm.floor.busy.research') == res and 'MODEL API DOWN' in pg.inner_text('#outage-banner') and 'research agent' in pg.inner_text('#break-status').lower())
    pg.click('#break-reviewer')
    check('Break it: one failure at a time (reviewers away restores the model API)', M(pg, 'm.modelApi') and not M(pg, 'm.reviewer') and pg.get_attribute('#break-reviewer', 'aria-pressed') == 'true')
    pg.click('#svc-positioning'); pg.click('#break-restore')
    check('Break it: Restore all brings every service back, including toolbar cuts', M(pg, 'm.modelApi && m.reviewer && m.power && m.internet && m.positioning') and 'Nothing broken' in pg.inner_text('#break-status'))
    pg.click('#reset'); check('Trace picker always offers the latest-finished option, even before any task', pg.locator('#trace-task option').count() >= 1)
    pg.evaluate('window.__district.setReviewers(3)'); pg.evaluate('window.__district.model.advance(200)'); pg.click('#rev-1'); pg.evaluate('window.__district.model.advance(60)'); pg.click('#step')
    busy = [pg.inner_text(f'#obs-wip tbody tr:nth-child({i}) td:nth-child(4)') for i in range(1, 6)]
    check('Busy column never exceeds 100% after cutting reviewers mid-shift', all(int(x.rstrip('%')) <= 100 for x in busy), str(busy))

    # Quality and security rules, the checkpoint and the enterprise view, on the full 8-hour shift in the real page.
    # Expected numbers come from the model itself (node), so the page is checked against the engine, not typed values.
    exp = json.loads(subprocess.run(['node', '--input-type=module', '-e', EXPECT_JS], capture_output=True, text=True, cwd=str(Path(__file__).parent), check=True).stdout)
    pg.goto(URL); time.sleep(2); pg.evaluate('window.__district.setRunning(false)'); pg.click('#reset')
    check('Quality and security rules start off: no new counts shown, five stages, checkpoint and least privilege on',
          pg.locator('#obs-qs').is_hidden() and pg.locator('#obs-wip tbody tr').count() == 5 and pg.get_attribute('#rule-defects', 'aria-pressed') == 'false'
          and pg.get_attribute('#rule-checkpoint', 'aria-pressed') == 'true' and pg.get_attribute('#rule-privilege', 'aria-pressed') == 'true')
    pg.click('#rev-2'); pg.click('#rule-defects'); pg.evaluate('window.__district.model.advance(480)'); pg.evaluate('window.__district.setRunning(false)')
    q = exp['quality']; shown = [pg.inner_text(f'#{i}') for i in ('obs-caught-review', 'obs-caught-approval', 'obs-escaped')]
    check('Defects on, full shift: caught at review, caught at approval and escaped match the model', shown == [str(q['caughtReview']), str(q['caughtApproval']), str(q['escaped'])] and pg.locator('#obs-qs').is_visible(), str(shown))
    check('Rules status reads the same counts in words', f"escaped to the customer {q['escaped']}" in pg.inner_text('#rules-status'))
    esc_id = M(pg, 'm.floor.done.filter(t => t.escaped).at(-1).id'); pg.select_option('#trace-task', esc_id)
    want = M(pg, f"m.floor.log.filter(e => e.task === '{esc_id}' && e.type === 'defect' && e.result !== 'caught').length")
    check('Trace marks each miss (review, and approval if it also missed) and the escape', pg.locator('#trace-bar .mark.qs.bad').count() == want and want >= 2 and 'Defect escaped' in pg.inner_text('#trace-summary'), esc_id)
    caught_id = M(pg, 'm.floor.done.filter(t => t.carriedDefect && !t.escaped).at(-1).id'); pg.select_option('#trace-task', caught_id)
    check('Trace marks a caught defect in green', pg.locator('#trace-bar .mark.qs.good').count() >= 1 and 'Defect caught at' in pg.inner_text('#trace-summary'), caught_id)
    pg.select_option('#lab-change', 'removeApproval'); pg.click('#lab-run')
    row = pg.locator('#lab-out tbody tr', has_text='Defects escaped'); cells = [row.locator('td').nth(i).inner_text() for i in range(3)] if row.count() else []
    check('Lab: removing approval with defects on shows the escapes it lets through', cells == [str(exp['labNoApproval']['base']), str(exp['labNoApproval']['variant']), f"+{exp['labNoApproval']['variant'] - exp['labNoApproval']['base']}"], str(cells))
    pg.click('#rule-defects'); check('Changing a rule clears a stale lab result', 'Run both again' in pg.inner_text('#lab-out'))

    pg.click('#reset'); pg.click('#rev-2'); pg.click('#rule-poison'); pg.evaluate('window.__district.model.advance(480)'); pg.evaluate('window.__district.setRunning(false)')
    s = exp['security']
    check('Poisoned requests on, checkpoint on: blocked ones quarantined for a person, slipped ones counted, quarantine row in the table',
          pg.inner_text('#obs-quarantined') == str(s['blocked']) and pg.inner_text('#obs-unsafe') == str(s['unsafe']) and pg.locator('#obs-wip tbody tr').count() == 6, f"{pg.inner_text('#obs-quarantined')} quarantined")
    blk = M(pg, 'm.floor.done.filter(t => t.quarantined).at(-1).id'); pg.select_option('#trace-task', blk)
    check('Trace of a quarantined task shows the quarantine stage and the checkpoint mark', 'Blocked at checkpoint' in pg.inner_text('#trace-summary') and pg.locator('#trace-bar .mark.qs.good').count() >= 1, blk)
    pg.click('#break-checkpoint'); before = M(pg, 'm.floor.security.unsafe'); pg.evaluate('window.__district.model.advance(120)'); pg.click('#step')
    check('Break it: Checkpoint off is pressed, the rule reads off, and unsafe tool actions start to count',
          pg.get_attribute('#break-checkpoint', 'aria-pressed') == 'true' and 'off' in pg.inner_text('#rule-checkpoint') and M(pg, 'm.floor.security.unsafe') > before and 'runs unchecked' in pg.inner_text('#break-status'))
    pg.click('#break-modelApi')
    check('Break it: one failure at a time (a service break turns the checkpoint back on)', M(pg, 'm.floor.rules.checkpoint') and not M(pg, 'm.modelApi'))
    pg.click('#break-checkpoint'); pg.click('#break-restore')
    check('Restore all turns the checkpoint back on', M(pg, 'm.floor.rules.checkpoint') and pg.get_attribute('#break-checkpoint', 'aria-pressed') == 'false')
    pg.click('#rule-checkpoint'); pg.click('#rule-privilege'); d0 = M(pg, 'm.floor.security.denied'); u0 = M(pg, 'm.floor.security.unsafe')
    pg.evaluate('window.__district.model.advance(240)'); pg.click('#step')
    check('Least privilege off with no checkpoint: nothing is refused, every poisoned action is carried out', M(pg, 'm.floor.security.denied') == d0 and M(pg, 'm.floor.security.unsafe') > u0 and 'every tool' not in pg.inner_text('#rules-tools-note') and 'export every customer record' in pg.inner_text('#rules-tools-note'))
    pg.click('#rule-checkpoint'); pg.click('#rule-privilege')
    pg.select_option('#lab-change', 'checkpointOff'); pg.click('#lab-run')
    row = pg.locator('#lab-out tbody tr', has_text='Unsafe tool actions'); cells = [row.locator('td').nth(i).inner_text() for i in range(3)] if row.count() else []
    check('Lab: turning off the checkpoint shows unsafe actions against the baseline that still has the checkpoint', cells[:2] == [str(exp['labCheckpointBase']), str(exp['labCheckpointOff'])], str(cells))

    pg.click('#enterprise-toggle'); time.sleep(.2)
    check('Enterprise view opens a map with every piece, sensors, checkpoints and the incident path',
          pg.locator('#obs-enterprise').is_visible() and pg.get_attribute('#enterprise-toggle', 'aria-expanded') == 'true' and pg.locator('#enterprise-map svg .km-box').count() == exp['map']['boxes']
          and pg.locator('#enterprise-map svg .km-path').count() == exp['map']['steps'] and f"recorded by {exp['map']['seen']} sensors" in pg.inner_text('#enterprise-status'))
    pg.click('#break-checkpoint'); time.sleep(.1)
    check('Enterprise view greys the tool checkpoint when it is off', pg.locator('#enterprise-map svg .km-off').count() >= 1 and 'it is off' in pg.inner_text('#enterprise-status'))
    pg.click('#break-restore'); pg.uncheck('#enterprise-path'); time.sleep(.1)
    check('Enterprise view path can be hidden', pg.locator('#enterprise-map svg .km-path').count() == 0)
    pg.click('#enterprise-toggle'); check('Enterprise view closes', pg.locator('#obs-enterprise').is_hidden())
    pg.goto(URL + '?enterprise'); time.sleep(1.5)
    check('?enterprise opens the enterprise view on load', pg.locator('#obs-enterprise').is_visible())

    # Stage mode and phone layout
    pg.goto(URL + '?stage'); time.sleep(2)
    check('Stage mode: page chrome hidden, world fills window', pg.locator('.sidebar').is_hidden() and abs(pg.locator('#world').bounding_box()['height'] - 1000) < 2)
    check('Stage mode: agent HUD mirrors live metrics', pg.locator('.agent-hud').is_visible() and pg.inner_text('[data-mirror="wip"]') == pg.evaluate('document.getElementById("wip").textContent'))
    pg.locator('[data-rev="3"]').click(); check('Stage reviewer buttons work', M(pg, 'm.floor.reviewers') == 3)
    phone = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); phone.goto(URL); time.sleep(2)
    over = phone.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    check('Phone 390px: no horizontal overflow', over <= 0, f'overflow {over}px')
    speed_label = phone.locator('.speed-control label').bounding_box(); speed_select = phone.locator('#speed').bounding_box()
    check('Phone speed label stays aligned with its selector', abs((speed_label['y'] + speed_label['height']/2) - (speed_select['y'] + speed_select['height']/2)) < 3)
    hud = phone.evaluate("""() => ['.fig','.tabs','.services','.shift','.rail'].map(s => { const r=document.querySelector(s).getBoundingClientRect(); return [s,r.left,r.top,r.right,r.bottom]; })""")
    overlaps = []
    for i, a in enumerate(hud):
        for c in hud[i+1:]:
            if a[1] < c[3] and c[1] < a[3] and a[2] < c[4] and c[2] < a[4]: overlaps.append(f'{a[0]} / {c[0]}')
    check('Phone 390px: figure, tabs, services, shift and zoom occupy separate rows', not overlaps, ', '.join(overlaps))
    check('Phone 390px: both horizontal rows show More controls', phone.locator('.tabs-frame .scroll-cue').is_visible() and phone.locator('.services-frame .scroll-cue').is_visible())
    phone.locator('.tabs-frame .scroll-cue').tap(); time.sleep(.4)
    check('Phone More control reveals additional districts', phone.locator('.tabs').evaluate('(e) => e.scrollLeft') > 0)
    phone.locator('.tabs').evaluate('(e) => { e.scrollLeft=0; }'); time.sleep(.2)
    phone.locator('.tabs-frame .scroll-cue').focus(); phone.keyboard.press('Enter'); time.sleep(.5)
    more_focus = phone.evaluate("() => { const e=document.activeElement, r=e.getBoundingClientRect(), v=document.querySelector('.tabs').getBoundingClientRect(); return {district:e.matches('.tabs button'),fully:r.left>=v.left&&r.right<=v.right,ring:e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none'}; }")
    check('Phone keyboard More leaves focus on a revealed district with a visible ring', more_focus['district'] and more_focus['fully'] and more_focus['ring'], str(more_focus))
    phone.locator('.services-frame .scroll-cue').tap(); time.sleep(.4)
    check('Phone More control reveals additional service controls', phone.locator('.services').evaluate('(e) => e.scrollLeft') > 0)
    phone.select_option('#trace-service', 'internet')
    check('Phone Trace control highlights dependents without cutting service', M(phone, 'd.xray') == 'internet' and M(phone, 'm.internet') and phone.locator('.tag.dep:visible').count() > 0)
    phone.locator('#svc-internet').tap(); time.sleep(.2)
    check('Phone tap cuts Internet while its chosen dependency trace remains visible', not M(phone, 'm.internet') and M(phone, 'd.xray') == 'internet')
    phone.locator('#svc-internet').tap(); phone.select_option('#trace-service', '')
    check('Phone can restore Internet and clear the trace', M(phone, 'm.internet') and M(phone, 'd.xray') is None)
    phone.evaluate('window.scrollTo(0,0)'); phone.locator('#inspect-jump').tap(); time.sleep(.4)
    check('Phone Inspect shortcut brings the object list into view and focus', phone.evaluate('document.activeElement.id') == 'object-select')
    phone.evaluate('window.scrollTo(0,0)'); time.sleep(.3)
    cdp = phone.context.new_cdp_session(phone); box = phone.locator('#world canvas').bounding_box(); tx = box['x'] + box['width'] * .52; ty = box['y'] + box['height'] * .72
    zoom0 = phone.evaluate('window.__district.camera.zoom'); cx0 = phone.evaluate('window.__district.camera.position.x'); cz0 = phone.evaluate('window.__district.camera.position.z')
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':tx,'y':ty,'id':0}]}); time.sleep(.05)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':tx+70,'y':ty,'id':0}]}); time.sleep(.05)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]}); time.sleep(.2)
    moved = phone.evaluate('([x,z]) => Math.abs(window.__district.camera.position.x-x) + Math.abs(window.__district.camera.position.z-z)', [cx0, cz0])
    check('Phone horizontal drag still moves the map camera', moved > .1, f'camera delta {moved:.2f}')
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':tx,'y':ty,'id':0}]}); time.sleep(.05)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':tx,'y':ty-120,'id':0}]}); time.sleep(.1)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]}); time.sleep(.3)
    check('Phone vertical swipe over the map scrolls the page', phone.evaluate('window.scrollY') > 0, f"scrollY={phone.evaluate('window.scrollY')}")
    check('Phone starts at a closer all-district view', zoom0 > .6, f'zoom={zoom0}')
    cdp.detach()

    # Phone: the enterprise view fits, and the lessons' copy buttons work
    phone.goto(URL + '?enterprise'); time.sleep(1.5)
    box = phone.locator('#enterprise-map svg').bounding_box()
    check('Phone 390px: enterprise map fits the screen with no horizontal overflow', box and box['width'] <= 390 and phone.evaluate('document.documentElement.scrollWidth - innerWidth') <= 0, str(box))
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    lp = ctx.new_page(); lp.on('pageerror', lambda e: errors.append(str(e)))
    lessons_dir = Path(__file__).parent / 'lessons'
    for f in sorted(lessons_dir.glob('0*.html')):
        lp.goto(f.as_uri()); lp.click('button.copy'); time.sleep(.2)
        copied = lp.evaluate('navigator.clipboard.readText()').replace(chr(13), '')  # the system clipboard may use Windows line ends
        check(f'Lesson {f.name[:2]}: copy button copies the starter prompt exactly', copied == lp.evaluate("document.getElementById('prompt').textContent") and len(copied) > 300 and lp.inner_text('button.copy') == 'Copied', f'{len(copied)} chars')
    lp.goto((lessons_dir / '07-sensors-and-checkpoints.html').as_uri())
    check('Lesson 7 draws the enterprise map inline, labels as text the reader can select', lp.locator('svg#map-plain .km-box').count() == exp['map']['boxes'] and lp.locator('svg#map-plain text', has_text='Model gateway').count() == 1)
    ctx.close()
    b.close()

check('No console or page errors', not errors, '; '.join(errors)[:300])
passed = sum(ok for _, ok, _ in results)
print(f'\n{passed}/{len(results)} checks passed')
(Path(__file__).parent / 'functional-test-results.json').write_text(json.dumps({'date': time.strftime('%Y-%m-%d %H:%M'), 'passed': passed, 'total': len(results), 'checks': [{'name': n, 'pass': ok, 'detail': d} for n, ok, d in results]}, indent=1))
sys.exit(0 if passed == len(results) else 1)
