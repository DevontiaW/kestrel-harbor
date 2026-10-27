import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentFloor, FLOOR } from './agent-floor.mjs';
import { District } from './district-model.mjs';
import { runExperiment, runFloor, CHANGES, describeWait } from './experiment-lab.mjs';
import { toOtlp } from './trace-export.mjs';

const UP = { internet: true, power: true, modelApi: true, reviewer: true };
const run = (f, minutes, services = () => UP) => { for (let i = 0; i < minutes; i++) f.tick(services(i)); return f; };
// A rough day: every service fails at different, overlapping times.
const rough = i => ({ internet: i % 70 > 8, power: i % 110 > 4, modelApi: !(i >= 200 && i < 230), reviewer: !(i >= 300 && i < 320) });
const allTasks = f => [...f.done, ...f.tasks];

// The core accounting check: a task's spans tile its whole life, minute by minute, with no gaps and no overlaps.
function assertSpansTile(f) {
  for (const t of allTasks(f)) {
    const end = t.finished ?? f.time;
    if (end === t.arrival) { assert.equal(t.spans.length, 0); continue; }
    assert.equal(t.spans[0].start, t.arrival, `${t.id} first span starts at arrival`);
    for (let i = 1; i < t.spans.length; i++) assert.equal(t.spans[i].start, t.spans[i - 1].end, `${t.id} span ${i} is contiguous`);
    assert.equal(t.spans.at(-1).end, end, `${t.id} last span ends at finish or now`);
    const sum = (pred) => t.spans.filter(pred).reduce((a, s) => a + s.end - s.start, 0);
    assert.equal(sum(() => true), end - t.arrival);
    assert.equal(sum(s => s.state === 'working'), t.worked);
    assert.equal(sum(s => s.cause === 'queue'), t.queued);
    assert.equal(sum(s => s.cause === 'blocked'), t.blocked);
    assert.equal(sum(s => s.cause === 'approval'), t.approval);
    for (const s of t.spans) assert.ok(s.end > s.start);
  }
}

test('event log: every task\'s spans account for every minute of a full 8-hour shift, 1 to 3 reviewers', () => {
  for (const reviewers of [1, 2, 3]) { const f = run(new AgentFloor({ reviewers }), 480); assertSpansTile(f); assert.equal(f.metrics().arrived, f.metrics().wip + f.metrics().done); }
});

test('event log: minute accounting still exact on a rough day with every kind of outage', () => {
  const f = run(new AgentFloor({ reviewers: 2 }), 480, rough); assertSpansTile(f);
  const causes = new Set(allTasks(f).flatMap(t => t.spans.filter(s => s.by).flatMap(s => s.by)));
  for (const c of ['internet', 'power', 'modelApi', 'reviewer']) assert.ok(causes.has(c), `some span is blocked by ${c}`);
  const m = f.metrics(); assert.equal(m.arrived, m.wip + m.done);
});

test('events: entered, started, left and finished line up with the task life, reviewer named, approval and rework recorded', () => {
  const f = run(new AgentFloor({ reviewers: 2 }), 480);
  for (const t of f.done) {
    const ev = f.log.filter(e => e.task === t.id);
    assert.deepEqual(ev[0], { minute: t.arrival, task: t.id, type: 'entered', stage: 'research' });
    assert.equal(ev.at(-1).type, 'finished'); assert.equal(ev.at(-1).minute, t.finished); assert.equal(ev.at(-1).cycle, t.finished - t.arrival);
    const left = ev.filter(e => e.type === 'left');
    const reviews = left.filter(e => e.stage === 'review');
    assert.ok(reviews.every(e => /^reviewer \d$/.test(e.worker)), 'who reviewed is recorded');
    assert.equal(reviews.filter(e => e.outcome === 'rework').length, t.n % FLOOR.reworkEvery === 0 ? 1 : 0);
    const approved = left.some(e => e.stage === 'approve' && e.outcome === 'approved');
    assert.equal(approved, t.n % FLOOR.approveEvery === 0); assert.equal(ev.at(-1).approved, approved);
    // every stage entered is started once and left once, in that order
    assert.equal(ev.filter(e => e.type === 'entered').length, ev.filter(e => e.type === 'started').length);
    assert.equal(ev.filter(e => e.type === 'started').length, left.length);
  }
  const minutes = f.log.map(e => e.minute); assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b), 'log is in time order');
});

test('metrics: Little\'s Law bookkeeping balances exactly; the finished-work check holds on a stable floor and fails on an overloaded one', () => {
  for (const [reviewers, services] of [[1, () => UP], [2, () => UP], [3, () => UP], [2, rough]]) {
    const L = run(new AgentFloor({ reviewers }), 480, services).metrics().littlesLaw;
    // Bookkeeping identity: two ways of counting the same task-minutes. It checks the log, not the floor.
    assert.ok(Math.abs(L.observedWip - L.predictedWip) < 1e-9, `reviewers ${reviewers}: ${L.observedWip} vs ${L.predictedWip}`);
  }
  // The reader-facing check uses finished work only, so it can fail: it holds on a stable floor and misses on an overloaded one.
  const one = run(new AgentFloor({ reviewers: 1 }), 480).metrics(), two = run(new AgentFloor({ reviewers: 2 }), 480).metrics();
  assert.equal(one.littlesLaw.arrivalsPerMinute, 0.25);
  assert.ok(Math.abs(two.littlesLaw.finishedGap) < 0.05, `stable floor within 5%: ${two.littlesLaw.finishedGap}`);
  assert.ok(one.littlesLaw.finishedGap < -0.3, `overloaded floor misses by over 30%: ${one.littlesLaw.finishedGap}`);
  assert.ok(Math.abs(two.littlesLaw.finishedPrediction - two.done / 480 * two.avgCycle) < 1e-12);
});

test('utilization stays within 0 to 100% when reviewers are cut while three are working; spans still tile', () => {
  const f = run(new AgentFloor({ reviewers: 3 }), 200);
  f.reviewers = 1; run(f, 100);
  for (const s of f.metrics().stations) assert.ok(s.utilization >= 0 && s.utilization <= 1, `${s.id} ${s.utilization}`);
  const names = f.tasks.filter(t => t.stage === 'review' && t.state === 'working').map(t => t.worker);
  assert.equal(new Set(names).size, names.length, 'no two tasks share a reviewer');
  assertSpansTile(f);
});

test('metrics: average wait at review equals the review waiting minutes in the spans, per task that entered review', () => {
  const f = run(new AgentFloor({ reviewers: 1 }), 480), m = f.metrics();
  const reviewWaiting = allTasks(f).flatMap(t => t.spans).filter(s => s.stage === 'review' && s.state === 'waiting').reduce((a, s) => a + s.end - s.start, 0);
  const review = m.stations.find(s => s.id === 'review');
  assert.equal(m.avgReviewWait, reviewWaiting / review.entered);
  assert.ok(m.avgReviewWait > 60, `one reviewer: ${m.avgReviewWait.toFixed(1)} min average wait`);
  assert.equal(m.topWaits[0].cause, 'queue'); assert.equal(m.topWaits[0].stage, 'review');
});

test('break it: model API outage stops research and planning only; reviewer absence stops review only', () => {
  const f = run(new AgentFloor({ reviewers: 2 }), 120); const before = { ...f.busy };
  run(f, 30, () => ({ ...UP, modelApi: false }));
  assert.equal(f.busy.research, before.research); assert.equal(f.busy.plan, before.plan);
  assert.ok(f.busy.execute > before.execute && f.busy.review > before.review);
  const mid = { ...f.busy };
  run(f, 30, () => ({ ...UP, reviewer: false }));
  assert.equal(f.busy.review, mid.review); assert.ok(f.busy.research > mid.research && f.busy.execute > mid.execute);
  assert.ok(f.topWaits(10).some(w => w.cause === 'blocked' && w.by.includes('reviewer')));
  assertSpansTile(f);
});

test('district: model API cut stops the clinic admin desk and research agents; reviewer control reaches the floor', () => {
  const d = new District(); d.advance(30); const admin = d.adminDone, research = d.floor.busy.research;
  d.setService('modelApi', false); d.advance(30);
  assert.equal(d.adminDone, admin); assert.equal(d.floor.busy.research, research);
  d.setService('modelApi', true); d.setService('reviewer', false); const review = d.floor.busy.review; d.advance(20);
  assert.equal(d.floor.busy.review, review); assert.ok(d.adminDone > admin);
  assert.throws(() => d.setService('bogus', false));
});

test('experiment lab: same start and horizon, deterministic, baseline untouched by the change', () => {
  const a = runExperiment('addReviewer'), b = runExperiment('addReviewer');
  assert.deepEqual(a, b);
  assert.equal(a.baseline.finished, 64); assert.equal(a.variant.finished, 115); assert.equal(a.deltas.finished, 51);
  assert.equal(Math.round(a.baseline.avgCompletedCycle), 117); assert.equal(Math.round(a.variant.avgCompletedCycle), 20);
  for (const id of Object.keys(CHANGES)) {
    const r = runExperiment(id);
    // Security changes switch poisoned requests on in both runs (CHANGES[id].both), so their baseline differs on purpose.
    if (!CHANGES[id].both) assert.deepEqual(r.baseline, a.baseline, `${id}: same baseline`);
    else assert.deepEqual(r.baseline, runExperiment(id, { baseline: { reviewers: 1 } }).baseline, `${id}: same baseline every run`);
    for (const k of Object.keys(r.deltas)) assert.equal(r.deltas[k], r.variant[k] - r.baseline[k]);
    assert.ok(r.variant.topWaits.length <= 3 && r.variant.topWaits.every(w => describeWait(w).length > 0));
  }
});

test('experiment lab: each change does what it says', () => {
  const noApproval = runFloor({ reviewers: 2, approveEvery: 0 });
  assert.equal(noApproval.wait.approval, 0); assert.ok(noApproval.log.every(e => e.stage !== 'approve'));
  const longer = runExperiment('longerReview', { baseline: { reviewers: 2 } });
  assert.ok(longer.deltas.avgReviewWait > 0 && longer.deltas.reviewBusy > 0);
  const cut = runExperiment('cutModelApi', { baseline: { reviewers: 2 } });
  assert.ok(cut.variant.topWaits.some(w => w.cause === 'blocked' && w.by.includes('modelApi')), JSON.stringify(cut.variant.topWaits));
  assert.equal(cut.baseline.topWaits.some(w => w.cause === 'blocked'), false);
});

test('trace export: OpenTelemetry-shaped, one trace per task, child spans tile the root, deterministic ids', () => {
  const f = run(new AgentFloor({ reviewers: 2 }), 480, rough), doc = toOtlp(f);
  assert.deepEqual(doc, toOtlp(f));
  const spans = doc.resourceSpans[0].scopeSpans[0].spans;
  const ids = spans.map(s => s.spanId); assert.equal(new Set(ids).size, ids.length);
  assert.ok(spans.every(s => /^[0-9a-f]{32}$/.test(s.traceId) && /^[0-9a-f]{16}$/.test(s.spanId) && s.spanId !== '0000000000000000'));
  assert.equal(spans.length, allTasks(f).reduce((a, t) => a + 1 + t.spans.length, 0));
  for (const root of spans.filter(s => !s.parentSpanId)) {
    const kids = spans.filter(s => s.parentSpanId === root.spanId);
    if (!kids.length) continue;
    assert.equal(kids[0].startTimeUnixNano, root.startTimeUnixNano); assert.equal(kids.at(-1).endTimeUnixNano, root.endTimeUnixNano);
  }
});

// ---- review round 3 ----
import { readFileSync } from 'node:fs';
import { HORIZON } from './experiment-lab.mjs';
import { traceSummary } from './observability-ui.js';

test('experiment lab: both runs last exactly the horizon', () => {
  for (const id of Object.keys(CHANGES)) {
    const r = runExperiment(id);
    assert.equal(r.baseline.minutes, HORIZON, `${id} baseline`); assert.equal(r.variant.minutes, r.horizon, `${id} variant`);
  }
  assert.equal(runExperiment('addReviewer', { horizon: 120 }).variant.minutes, 120);
});

test('wait wording: a reviewer absence reads as reviewers away, services read as down', () => {
  assert.equal(describeWait({ cause: 'blocked', stage: 'review', by: ['reviewer'] }), 'Stopped at review: reviewers away');
  assert.equal(describeWait({ cause: 'blocked', stage: 'research', by: ['modelApi', 'power'] }), 'Stopped at research: model API down + power down');
});

test('trace summary: a task that arrived this minute shows 0 minutes and 0 waiting', () => {
  const f = new AgentFloor({ reviewers: 1 });
  let t; for (let i = 0; i < 60 && !t; i++) { f.tick(UP); t = f.tasks.find(x => x.arrival === f.time); }
  assert.ok(t, 'a task arrived on the current minute');
  const text = traceSummary(t, f);
  assert.match(text, /: 0 minutes so far/); assert.match(text, /Working 0 min, waiting 0 min/);
  // An older task's numbers still add up.
  const g = run(new AgentFloor({ reviewers: 1 }), 120), old = g.tasks[0];
  const life = g.time - old.arrival, m = traceSummary(old, g).match(/(\d+) minutes so far.*Working (\d+) min, waiting (\d+) min/);
  assert.equal(Number(m[1]), life); assert.equal(Number(m[2]) + Number(m[3]), life);
});

test('the page derives the shift length and clock times from the model, and has no em dashes', () => {
  const ui = readFileSync('observability-ui.js', 'utf8');
  assert.ok(!/08:00|16:00|8 hours/.test(ui), 'observability-ui.js types the shift times');
  assert.ok(!/—/.test(readFileSync('district-page.html', 'utf8')), 'district-page.html has an em dash');
});

test('the three reviewer runs still finish 64, 115 and 115 tasks', () => {
  assert.deepEqual([1, 2, 3].map(r => runFloor({ reviewers: r }).done.length), [64, 115, 115]);
});
