// Quality (defects and review misses) and security (poisoned requests, checkpoint, least privilege) on the agent floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AgentFloor, FLOOR, QUALITY_ON, SECURITY_ON, ROLE_TOOLS, INJECTED } from './agent-floor.mjs';
import { runFloor, runExperiment, CHANGES } from './experiment-lab.mjs';
import { lessonNumbers } from './lesson-numbers.mjs';
import { toOtlp } from './trace-export.mjs';
import { NODES, SENSORS, CHECKPOINTS, INCIDENTS, recordedBy, stoppableBy, enterpriseMapSvg, townInsideSvg, INSIDE } from './network-surface.mjs';

const UP = { internet: true, power: true, modelApi: true, reviewer: true };
const rough = i => ({ internet: i % 70 > 8, power: i % 110 > 4, modelApi: !(i >= 200 && i < 230), reviewer: !(i >= 300 && i < 320) });
const run = (opts, minutes = 480, services = () => UP) => { const f = new AgentFloor(opts); for (let i = 0; i < minutes; i++) f.tick(services(i)); return f; };
const all = f => [...f.done, ...f.tasks];
const BOTH = { ...QUALITY_ON, ...SECURITY_ON };

function assertSpansTile(f) {
  for (const t of all(f)) {
    const end = t.finished ?? f.time;
    if (end === t.arrival) { assert.equal(t.spans.length, 0); continue; }
    assert.equal(t.spans[0].start, t.arrival, `${t.id} starts at arrival`);
    for (let i = 1; i < t.spans.length; i++) assert.equal(t.spans[i].start, t.spans[i - 1].end, `${t.id} span ${i} contiguous`);
    assert.equal(t.spans.at(-1).end, end, `${t.id} ends at finish or now`);
    const sum = p => t.spans.filter(p).reduce((a, s) => a + s.end - s.start, 0);
    assert.equal(sum(() => true), end - t.arrival);
    assert.equal(sum(s => s.state === 'working'), t.worked);
    assert.equal(sum(s => s.cause === 'queue'), t.queued);
    assert.equal(sum(s => s.cause === 'blocked'), t.blocked);
    assert.equal(sum(s => s.cause === 'approval'), t.approval);
  }
  const m = f.metrics(); assert.equal(m.arrived, m.wip + m.done, 'tasks conserved');
}

// ---- default-off: the new rules change nothing ----
// Fingerprints of the default floor taken on main before this work (event log, every task with its spans, and every metric
// that existed then), for 1, 2 and 3 reviewers, the five original lab changes and the lesson 1 to 5 numbers.
const h = o => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const old = o => { const { quality, security, escaped, unsafe, ...rest } = o; return rest; };
const OLD_LESSON_KEYS = ['shiftHours', 'shiftEnd', 'outage', 'arrivalsPerHour', 'arriveEvery', 'arrived', 'reviewMinutes', 'approveMinutes', 'approveEvery', 'reworkEvery', 'agentMinutes', 'workMinutes', 'reviewsPerHour', 'reviewMinutesNeeded', 'reviewCapacityPerHour', 'one', 'two', 'three', 'last', 'faster', 'cut', 'away', 'reworkPct', 'noApproval', 'approveAll'];

test('default-off: with the quality and security rules at their defaults, every existing output is byte-for-byte unchanged', () => {
  assert.equal(FLOOR.defectEvery, 0); assert.equal(FLOOR.missEvery, 0); assert.equal(FLOOR.poisonEvery, 0); assert.equal(FLOOR.approveMissEvery, 0); assert.equal(FLOOR.slipEvery, 0);
  const fp = {};
  for (const r of [1, 2, 3]) { const f = runFloor({ reviewers: r }); fp[`r${r}`] = h({ log: f.log, tasks: all(f), m: old(f.metrics()) }); }
  fp.lab = h(['addReviewer', 'removeApproval', 'approveEveryTask', 'longerReview', 'cutModelApi'].map(id => { const r = runExperiment(id); return [r.baseline, r.variant].map(old); }));
  const n = lessonNumbers(); fp.lessons = h(Object.fromEntries(OLD_LESSON_KEYS.map(k => [k, n[k]])));
  assert.deepEqual(fp, { r1: '72dcf5d2a7b14bf0', r2: '115f8127e8e26418', r3: 'ec9bbacd4e3c50f0', lab: 'a2e51359aed6d913', lessons: 'a7c5e8693a936344' });
  assert.deepEqual([1, 2, 3].map(r => runFloor({ reviewers: r }).done.length), [64, 115, 115]);
});

test('default-off: no defect or tool events, no quarantine station, and turning the checkpoint or least privilege off alone changes nothing', () => {
  const f = runFloor({ reviewers: 2 });
  assert.ok(f.log.every(e => e.type !== 'defect' && e.type !== 'tool'));
  assert.equal(f.metrics().stations.length, 5);
  assert.ok(all(f).every(t => !('defect' in t) && !('poisoned' in t)));
  const key = g => h({ log: g.log, tasks: all(g) });
  assert.equal(key(runFloor({ reviewers: 2, checkpoint: false, leastPrivilege: false })), key(f));
});

// ---- minute accounting and determinism ----
test('minutes tile exactly with defects, quarantines and the checkpoint on or off, 1 to 3 reviewers, calm and rough days', () => {
  for (const reviewers of [1, 2, 3]) for (const rules of [QUALITY_ON, SECURITY_ON, { ...SECURITY_ON, checkpoint: false }, { ...SECURITY_ON, checkpoint: false, leastPrivilege: false }, BOTH])
    for (const services of [() => UP, rough]) assertSpansTile(run({ reviewers, ...rules }, 480, services));
});

test('determinism: the same rules give the same events, tasks and metrics, run after run', () => {
  for (const rules of [BOTH, { ...BOTH, checkpoint: false }]) {
    const a = run({ reviewers: 2, ...rules }, 480, rough), b = run({ reviewers: 2, ...rules }, 480, rough);
    assert.deepEqual(a.log, b.log); assert.deepEqual(all(a), all(b)); assert.deepEqual(a.metrics(), b.metrics());
  }
  assert.deepEqual(runExperiment('checkpointOff', { baseline: { reviewers: 2 } }), runExperiment('checkpointOff', { baseline: { reviewers: 2 } }));
});

// ---- quality ----
test('defects: every 4th task carries one; each is caught at review, caught at approval, escapes, or is still on the floor', () => {
  const f = runFloor({ reviewers: 2, ...QUALITY_ON }), q = f.metrics().quality;
  assert.equal(q.defects, all(f).filter(t => t.n % QUALITY_ON.defectEvery === 0).length);
  assert.ok(all(f).every(t => !!t.carriedDefect === (t.n % QUALITY_ON.defectEvery === 0)));
  const stillDefective = f.tasks.filter(t => t.defect).length;
  assert.equal(q.defects, q.caughtReview + q.caughtApproval + q.escaped + stillDefective);
  // Counters match the event log.
  const ev = (stage, result) => f.log.filter(e => e.type === 'defect' && e.stage === stage && e.result === result).length;
  assert.equal(ev('review', 'caught'), q.caughtReview); assert.equal(ev('review', 'missed'), q.missedReview);
  assert.equal(ev('approve', 'caught'), q.caughtApproval); assert.equal(ev('approve', 'missed'), q.missedApproval); assert.equal(ev('done', 'escaped'), q.escaped);
  // Escaped tasks are exactly the finished tasks that still carry the defect; they never passed an approval.
  for (const t of f.done.filter(t => t.escaped)) { assert.equal(t.defect, true); const approved = f.log.some(e => e.task === t.id && e.type === 'left' && e.stage === 'approve'), missed = f.log.some(e => e.task === t.id && e.type === 'defect' && e.stage === 'approve' && e.result === 'missed'); assert.equal(approved, missed, 'an escaped task either skipped approval or the approver missed it'); }
});

test('miss rule: every Nth review that sees a defect misses it (QUALITY_ON.missEvery), counted across the shift', () => {
  const f = runFloor({ reviewers: 2, ...QUALITY_ON });
  const results = f.log.filter(e => e.type === 'defect' && e.stage === 'review').map(e => e.result);
  results.forEach((r, i) => assert.equal(r, (i + 1) % QUALITY_ON.missEvery === 0 ? 'missed' : 'caught', `review ${i + 1}`));
  assert.ok(results.length > 20);
});

test('approval catches much of what review missed: removing it lets more defects escape; approving every task lets fewer escape, but not none', () => {
  const base = runExperiment('removeApproval', { baseline: { reviewers: 2, ...QUALITY_ON } });
  assert.ok(base.deltas.escaped > 0, `escapes rise by ${base.deltas.escaped}`);
  assert.equal(base.variant.quality.caughtApproval, 0);
  assert.ok(base.baseline.quality.caughtApproval > 0);
  const every = runFloor({ reviewers: 2, ...QUALITY_ON, approveEvery: 1 }).metrics();
  assert.ok(every.quality.escaped < base.baseline.quality.escaped && every.quality.escaped > 0, 'approving every task helps but, with an imperfect approver, does not stop every escape');
});

// ---- security ----
test('poisoned requests: every 10th task; a perfect checkpoint (slipEvery 0) blocks each one before its tool action and a person clears it', () => {
  const f = runFloor({ reviewers: 2, ...SECURITY_ON, slipEvery: 0 }), s = f.metrics().security;
  assert.equal(s.poisoned, all(f).filter(t => t.n % SECURITY_ON.poisonEvery === 0).length);
  assert.equal(s.unsafe, 0); assert.equal(s.denied, 0); assert.ok(s.blocked > 0);
  const tools = f.log.filter(e => e.type === 'tool');
  assert.ok(tools.every(e => e.result === 'blocked')); assert.equal(tools.length, s.blocked);
  for (const e of tools) {
    const t = f.task(e.task), next = f.log.filter(x => x.task === t.id && x.minute >= e.minute);
    assert.deepEqual(next.slice(1, 3).map(x => [x.type, x.stage]), [['left', 'execute'], ['entered', 'quarantine']], `${t.id} goes to quarantine`);
    assert.ok(t.quarantined && t.spans.some(sp => sp.stage === 'quarantine' && sp.state === 'working') || !t.finished);
  }
  assert.equal(f.metrics().stations.at(-1).id, 'quarantine');
  assert.equal(s.cleared, f.log.filter(e => e.type === 'left' && e.outcome === 'cleared').length);
});

test('checkpoint off: least privilege refuses the out-of-role export; the in-role send to an outside address is carried out', () => {
  const f = runFloor({ reviewers: 2, ...SECURITY_ON, checkpoint: false }), s = f.metrics().security;
  assert.ok(!ROLE_TOOLS.execute.includes(INJECTED.exportRecords.tool) && ROLE_TOOLS.execute.includes(INJECTED.sendOutside.tool));
  const tools = f.log.filter(e => e.type === 'tool');
  assert.ok(tools.every(e => (e.request === 'exportRecords' ? 'denied' : 'carried-out') === e.result));
  assert.equal(s.unsafe, tools.filter(e => e.result === 'carried-out').length); assert.equal(s.denied, tools.filter(e => e.result === 'denied').length);
  assert.ok(s.unsafe > 0 && s.denied > 0); assert.equal(s.blocked, 0);
  assert.ok(f.log.every(e => e.stage !== 'quarantine'));
  const open = runFloor({ reviewers: 2, ...SECURITY_ON, checkpoint: false, leastPrivilege: false }).metrics().security;
  assert.equal(open.unsafe, s.unsafe + s.denied); assert.equal(open.denied, 0);
});

test('lab: turning off the checkpoint shows unsafe actions; removing least privilege shows more', () => {
  const cp = runExperiment('checkpointOff', { baseline: { reviewers: 2 } });
  assert.ok(cp.baseline.unsafe < cp.variant.unsafe, 'the baseline checkpoint stops most but not all'); assert.ok(cp.deltas.unsafe > 0);
  assert.equal(cp.baseline.security.poisoned, cp.variant.security.poisoned, 'both runs get the same poisoned requests');
  const lp = runExperiment('leastPrivilegeOff', { baseline: { reviewers: 2 } });
  assert.equal(lp.baseline.security.blocked, 0, 'least privilege change runs with the checkpoint off, so it shows something from the page defaults');
  assert.ok(runExperiment('checkpointOff', { baseline: { reviewers: 2, checkpoint: false } }).deltas.unsafe > 0, 'checkpoint change shows a difference even if the page checkpoint is already off');
  assert.ok(lp.deltas.unsafe > 0);
  for (const id of ['checkpointOff', 'leastPrivilegeOff']) assert.ok(CHANGES[id].describe({ reviewers: 1 }).includes(String(SECURITY_ON.poisonEvery)));
});

test('event order (docs/EVENT-SCHEMA.md 1.1.0): defect and tool events come just before the check\'s left or finished event', () => {
  const f = run({ reviewers: 2, ...BOTH, checkpoint: false }), g = run({ reviewers: 2, ...BOTH });
  for (const floor of [f, g]) {
    floor.log.forEach((e, i) => {
      if (e.type !== 'defect' && e.type !== 'tool') return;
      const next = floor.log.slice(i + 1).find(x => x.task === e.task);
      if (!next) return;
      if (e.type === 'defect' && e.result === 'escaped') assert.equal(next.type, 'finished');
      else { assert.equal(next.type, 'left', JSON.stringify([e, next])); assert.equal(next.stage, e.stage); }
      if (e.type === 'tool' && e.result === 'blocked') assert.equal(floor.log.slice(i + 1).filter(x => x.task === e.task)[1].stage, 'quarantine');
    });
  }
});

// ---- enterprise view ----
test('enterprise map: an incident is recorded by a sensor if and only if the sensor sits on its path; checkpoints listed earliest first', () => {
  for (const [id, inc] of Object.entries(INCIDENTS)) {
    for (const s of SENSORS) assert.equal(recordedBy(id).includes(s), inc.path.includes(s.at), `${id} / ${s.id}`);
    const stops = stoppableBy(id);
    for (const c of CHECKPOINTS) assert.equal(stops.includes(c), inc.path.includes(c.at));
    const order = stops.map(c => inc.path.indexOf(c.at)); assert.deepEqual(order, [...order].sort((a, b) => a - b));
  }
  assert.deepEqual(stoppableBy('sendOutside').map(c => c.id), ['toolCheckpoint', 'egressGate']);
  assert.ok(!recordedBy('sendOutside').some(s => s.at === 'gateway'), 'the model gateway never sees a tool sending a file');
  assert.ok(CHECKPOINTS.filter(c => c.built).every(c => c.at === 'tools'), 'only the tool checkpoint is built in the town');
});

test('diagrams: every label is drawn, the path and the off checkpoint are marked, light-only on request, and two maps on one page share no ids', () => {
  const svg = enterpriseMapSvg({ highlight: 'sendOutside', checkpointOn: false });
  for (const n of NODES) assert.ok(svg.includes(`>${n.name}<`), n.name);
  assert.equal((svg.match(/km-work km-path/g) || []).length, INCIDENTS.sendOutside.path.length - 1, 'one red line per step of the path');
  assert.ok(svg.includes('km-off') && svg.includes('switched off'));
  assert.ok(svg.includes('prefers-color-scheme:dark') && !enterpriseMapSvg({ theme: 'light' }).includes('prefers-color-scheme'));
  const ids = s => [...s.matchAll(/ id="([^"]+)"/g)].map(m => m[1]), a = ids(enterpriseMapSvg({ id: 'a' })), b = ids(enterpriseMapSvg({ id: 'b' }));
  assert.equal(a.filter(x => b.includes(x)).length, 0);
  const inside = townInsideSvg(); for (const box of INSIDE) assert.ok(inside.includes(box.name));
  assert.ok(!/—/.test(svg + inside), 'no em dashes');
});

test('trace export still works with quarantine and defect tasks', () => {
  const f = run({ reviewers: 2, ...BOTH }), doc = toOtlp(f), spans = doc.resourceSpans[0].scopeSpans[0].spans;
  assert.ok(spans.some(s => s.name.startsWith('quarantine')));
  assert.equal(spans.length, all(f).reduce((a, t) => a + 1 + t.spans.length, 0));
});

// ---- imperfect checks: the approver and the checkpoint miss on a fixed pattern ----
test('approver miss rule: every Nth defect the approver sees is missed, counted across the shift; the missed task finishes with the defect', () => {
  const f = runFloor({ reviewers: 2, ...QUALITY_ON, approveEvery: 1 }), q = f.metrics().quality;
  const seen = f.log.filter(e => e.type === 'defect' && e.stage === 'approve').map(e => e.result);
  assert.ok(seen.length >= 4, 'the approver sees enough defects to test the pattern');
  seen.forEach((r, i) => assert.equal(r, (i + 1) % QUALITY_ON.approveMissEvery === 0 ? 'missed' : 'caught', `approval sighting ${i + 1}`));
  assert.equal(q.caughtApproval + q.missedApproval, seen.length);
  assert.equal(q.missedApproval, Math.floor(seen.length / QUALITY_ON.approveMissEvery));
  const missedIds = f.log.filter(e => e.type === 'defect' && e.stage === 'approve' && e.result === 'missed').map(e => e.task);
  for (const id of missedIds) { const t = f.task(id); assert.ok(f.log.some(e => e.task === id && e.type === 'left' && e.stage === 'approve' && e.outcome === 'approved')); if (t.finished) assert.equal(t.escaped, true); }
  assert.ok(q.missedApproval > 0);
  assert.equal(q.defects, q.caughtReview + q.caughtApproval + q.escaped + f.tasks.filter(t => t.defect).length, 'every defect is accounted for');
  assertSpansTile(f);
});

test('approver miss rule: off (0) means the approver never misses; with the page settings the exact counts are 30 defects, 22 / 1 / 1 / 5', () => {
  assert.equal(runFloor({ reviewers: 2, ...QUALITY_ON, approveMissEvery: 0 }).metrics().quality.missedApproval, 0);
  const on = runFloor({ reviewers: 2, ...QUALITY_ON }).metrics().quality;
  assert.deepEqual([on.defects, on.caughtReview, on.caughtApproval, on.missedApproval, on.escaped], [30, 22, 1, 1, 5]);
  assert.equal(runFloor({ reviewers: 2 }).metrics().quality.missedApproval, 0);
});

test('checkpoint slip rule: every Nth poisoned action the checkpoint examines looks allowed; least privilege then still applies', () => {
  const f = runFloor({ reviewers: 2, ...SECURITY_ON }), s = f.metrics().security;
  const tools = f.log.filter(e => e.type === 'tool');
  tools.forEach((e, i) => assert.equal(!!e.slipped, (i + 1) % SECURITY_ON.slipEvery === 0, `poisoned action ${i + 1}`));
  assert.equal(s.slipped, tools.filter(e => e.slipped).length);
  assert.equal(s.blocked, tools.filter(e => e.result === 'blocked').length);
  assert.equal(s.blocked + s.slipped, tools.length, 'every action that reaches a tool is blocked or slips');
  for (const e of tools.filter(e => e.slipped)) assert.equal(e.result, e.request === 'exportRecords' ? 'denied' : 'carried-out');
  assert.equal(s.unsafe + s.denied, s.slipped);
  assert.deepEqual([s.poisoned, s.blocked, s.slipped, s.denied, s.unsafe], [12, 8, 3, 2, 1]);
  assert.equal(f.log.filter(e => e.type === 'entered' && e.stage === 'quarantine').length, s.blocked, 'only blocked tasks are quarantined');
  assertSpansTile(f);
});

test('checkpoint slip rule: never fires with the checkpoint off, with poisoning off, or when set to 0', () => {
  assert.equal(runFloor({ reviewers: 2, ...SECURITY_ON, checkpoint: false }).metrics().security.slipped, 0);
  assert.equal(runFloor({ reviewers: 2, slipEvery: 3 }).metrics().security.slipped, 0);
  const none = runFloor({ reviewers: 2, ...SECURITY_ON, slipEvery: 0 }).metrics().security;
  assert.equal(none.slipped, 0); assert.equal(none.unsafe, 0);
  assert.ok(runFloor({ reviewers: 2 }).log.every(e => !('slipped' in e)));
});

test('imperfect checks tile minutes and stay deterministic on calm and rough days, 1 to 3 reviewers', () => {
  for (const reviewers of [1, 2, 3]) for (const services of [() => UP, rough]) {
    const f = run({ reviewers, ...BOTH, approveEvery: 1 }, 480, services); assertSpansTile(f);
    assert.deepEqual(f.log, run({ reviewers, ...BOTH, approveEvery: 1 }, 480, services).log);
  }
});
