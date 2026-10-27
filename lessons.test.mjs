import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fillNumbers, lessonNumbers } from './lesson-numbers.mjs';
import { AgentFloor, QUALITY_ON, SECURITY_ON } from './agent-floor.mjs';
import { recordedBy, NODES, INCIDENTS } from './network-surface.mjs';

const lessons = readdirSync('lessons-src').filter(f => /^\d\d-.*\.html$/.test(f));
const numbers = lessonNumbers();

test('there are eight lessons and every page is built from the current model (no drift, no unfilled numbers)', () => {
  assert.equal(lessons.length, 8);
  for (const f of [...lessons, 'index.html']) {
    const built = readFileSync(`lessons/${f}`, 'utf8');
    assert.equal(built, fillNumbers(readFileSync(`lessons-src/${f}`, 'utf8'), numbers), `${f} is stale: run npm run build`);
    assert.ok(!built.includes('{{'), `${f} has an unfilled number`);
  }
});

test('an unknown number name fails the build instead of shipping braces', () => {
  assert.throws(() => fillNumbers('{{one.nope}}', numbers), /Unknown lesson number/);
});

test('each lesson follows the practicum contract: one idea, prediction before reveal, break-it step, new-case question, Monday check', () => {
  for (const f of lessons) {
    const html = readFileSync(`lessons-src/${f}`, 'utf8');
    const at = s => html.indexOf(s);
    assert.equal(html.match(/class="idea"/g)?.length, 1, `${f}: exactly one idea`);
    assert.ok(at('class="predict"') > 0 && at('class="predict"') < at('<details class="reveal"'), `${f}: prediction comes before the reveal`);
    assert.ok(at('Break it in the town') > at('<details class="reveal"'), `${f}: break-it step`);
    assert.ok(at('A different situation') > 0 && at('On Monday') > at('A different situation'), `${f}: new case, then Monday`);
    assert.ok(html.includes('href="../index.html"'), `${f}: links to the town`);
    assert.ok(at('class="idea"') < at('class="predict"'));
    assert.ok(!/—/.test(html), `${f}: no em dashes in reader-facing text`);
    // The lesson itself (everything before the optional build section) stays phone length.
    const lesson = html.slice(0, at('<section class="build"'));
    const words = lesson.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words < 900, `${f}: ${words} words, phone length`);
  }
});

// ---- Build it yourself with AI ----
const built = Object.fromEntries(lessons.map(f => [f, readFileSync(`lessons/${f}`, 'utf8')]));
const section = f => built[f].slice(built[f].indexOf('<section class="build"'), built[f].indexOf('</section>', built[f].indexOf('<section class="build"')));
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const checks = f => text(section(f).slice(section(f).indexOf('class="checks"')));
const prompt = f => { const s = section(f); return s.slice(s.indexOf('<pre id="prompt">'), s.indexOf('</pre>')); };

test('every lesson ends with one clearly headed "Build it yourself with AI" section after the lesson: rule, prompt with copy button, done, checks', () => {
  for (const f of lessons) {
    const html = built[f], at = s => html.indexOf(s), s = section(f);
    assert.equal(html.match(/<section class="build"/g)?.length, 1, `${f}: one build section`);
    assert.ok(at('<section class="build"') > at('class="monday"'), `${f}: after the lesson`);
    assert.ok(s.includes('Build it yourself with AI</h2>'), `${f}: heading`);
    const order = ['class="fundamental"', 'data-copy="prompt"', '<pre id="prompt">', 'What "done" looks like', 'Check the AI\'s work', 'class="checks"'].map(x => s.indexOf(x));
    assert.ok(order.every(i => i > 0) && order.every((x, i) => !i || x > order[i - 1]), `${f}: rule, prompt, done, checks in order`);
    assert.ok(html.includes('<script src="copy.js"></script>'), `${f}: copy button script`);
    const words = text(s).split(' ').filter(Boolean).length;
    assert.ok(words < 650, `${f}: build section ${words} words`);
    assert.ok(text(checks(f)).match(/\d/g).length >= 2, `${f}: checks carry numbers`);
  }
  assert.ok(readFileSync('lessons/copy.js', 'utf8').includes('navigator.clipboard'));
});

test('starter prompts stay starter tier: one file, no production setup', () => {
  const banned = /kubernetes|terraform|docker|deploy|policy[- ]as[- ]code|collector config|evaluation harness|eval harness|orchestrat|production|api key|password/i;
  for (const f of lessons) {
    const p = text(prompt(f));
    assert.ok(!banned.test(p), `${f}: prompt mentions ${p.match(banned)?.[0]}`);
    assert.ok(/one HTML file|single-file/i.test(p), `${f}: one-file starter`);
    assert.ok(!/—/.test(p));
  }
});

test('the "check the AI\'s work" numbers match the model', () => {
  const r = n => runFloor({ reviewers: n });
  const one = r(1), two = r(2), three = r(3);
  const has = (f, ...xs) => { const c = checks(f); for (const x of xs) assert.ok(c.includes(x), `${f}: checks should say "${x}": ${c}`); };
  has('01-where-work-waits.html', `${one.done.length} finished and ${one.tasks.length} still in the system`, `${two.done.length} finished`, `3 reviewers: ${three.done.length}`);
  const last = one.done.at(-1);
  has('02-trace-vs-dashboard.html', `task ${last.n}`, `minute ${last.arrival}`, `minute ${last.finished}`, `worked ${last.worked} minutes and waited ${last.finished - last.arrival - last.worked}`);
  const pct = L => `${Math.round(Math.abs(L.finishedGap) * 100)}%`;
  has('03-littles-law.html', `off by ${pct(two.metrics().littlesLaw)}`, `off by ${pct(one.metrics().littlesLaw)}`, 'holds', 'does not apply here');
  const cut = runExperiment('cutModelApi', { baseline: { reviewers: 2 } });
  has('04-failure-modes.html', `${cut.variant.blockedMinutes} task-minutes`, `change by ${cut.deltas.finished}`);
  has('05-human-decision.html', `no approval, ${runFloor({ reviewers: 2, approveEvery: 0 }).done.length} finished`, `every task, ${runFloor({ reviewers: 2, approveEvery: 1 }).done.length}`);
  const q = runFloor({ reviewers: 2, ...QUALITY_ON }).metrics().quality, qNo = runFloor({ reviewers: 2, ...QUALITY_ON, approveEvery: 0 }).metrics(), qAll = runFloor({ reviewers: 2, ...QUALITY_ON, approveEvery: 1 }).metrics();
  has('06-who-decided.html', `${q.defects} defects`, `${q.caughtReview} caught at review, ${q.caughtApproval} at approval, ${q.escaped} escaped`,
    `${qAll.quality.caughtApproval} caught at approval, ${qAll.quality.missedApproval} missed, ${qAll.quality.escaped} escaped, ${qAll.done} finished`, `${qNo.quality.escaped} escaped and ${qNo.done} finished`);
  has('07-sensors-and-checkpoints.html', `${recordedBy('sendOutside').length} sensors, on Agents, Tools, Network edge`, 'Checkpoints, earliest first: Tools, then Network edge', 'Checkpoints, earliest first: Model gateway, then Network edge');
  const s = o => runFloor({ reviewers: 2, ...SECURITY_ON, ...o }).metrics();
  const on = s({}), lp = s({ checkpoint: false }), off = s({ checkpoint: false, leastPrivilege: false });
  has('08-input-is-the-attack.html', `${on.security.blocked} sent to quarantine, ${on.security.unsafe} unsafe, ${on.done} finished`, `${lp.security.unsafe} unsafe and ${lp.security.denied} refused`, `Of the ${on.security.slipped} that slipped past the checkpoint, ${on.security.denied} were refused`, `${off.security.unsafe} unsafe, and ${off.done} finished`);
  assert.equal(off.done, two.done.length, 'lesson 8 claims unchecked poisoned requests do not change output');
});

test('the public README states the quality and security rules the model uses', { skip: !existsSync('README.md') && !existsSync('public/README.md') }, () => {
  const readme = readFileSync(existsSync('public/README.md') ? 'public/README.md' : 'README.md', 'utf8');
  const nthWord = n => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  assert.ok(readme.includes(`every ${nthWord(QUALITY_ON.defectEvery)} task carries a defect, and every ${nthWord(QUALITY_ON.missEvery)} review that sees one misses it`));
  assert.ok(readme.includes(`every ${nthWord(SECURITY_ON.poisonEvery)} task carries a hidden instruction`));
  assert.ok(readme.includes('docs/media/town-demo.gif'));
});

test('starter prompts state the rules the check numbers depend on (queue order, spent instructions, map from the model)', () => {
  // Queue order: the model serves each line by arrival in the shift, not by when a task joined that line. Prove it matters:
  // a variant that serves by join order finishes a different number of tasks with one reviewer.
  class JoinOrder extends AgentFloor { enter(t, stage) { super.enter(t, stage); const i = this.tasks.indexOf(t); if (i >= 0) { this.tasks.splice(i, 1); this.tasks.push(t); } } }
  const variant = new JoinOrder({ reviewers: 1 }); for (let i = 0; i < 480; i++) variant.tick({});
  assert.notEqual(variant.done.length, runFloor({ reviewers: 1 }).done.length, 'join order would change the lesson 1 check');
  assert.ok(text(prompt('01-where-work-waits.html')).includes('arrived in the shift earliest'));
  assert.ok(text(prompt('08-input-is-the-attack.html')).includes('acted on (or refused) only once'));
  assert.ok(text(prompt('08-input-is-the-attack.html')).includes('the checkpoint runs first'));
  assert.ok(text(prompt('08-input-is-the-attack.html')).includes('looks allowed and gets through'));
  assert.ok(text(prompt('06-who-decided.html')).includes('misses it and approves the task anyway'));
  const p7 = text(prompt('07-sensors-and-checkpoints.html'));
  for (const n of NODES) assert.ok(p7.includes(n.name.replace(/ \(.*\)$/, '')), n.name);
  assert.ok(p7.includes(INCIDENTS.sendOutside.button) && p7.includes(INCIDENTS.modelLeak.button));
});

test('break-it steps press Restart before choosing staffing (Restart starts a fresh floor with one reviewer)', () => {
  for (const f of lessons) assert.ok(!/Reviewers \d<\/strong>,( then)? <strong>Restart/.test(readFileSync(`lessons-src/${f}`, 'utf8')), `${f}: Restart would undo the staffing`);
});

test('lesson 8 claims hold in the model: least privilege refuses only out-of-role tools; the checkpoint costs time', () => {
  assert.ok(Number(numbers.s8.on.unsafe) > 0 && Number(numbers.s8.on.unsafe) < Number(numbers.s8.lp.unsafe), 'the checkpoint helps a lot but is not perfect'); assert.ok(Number(numbers.s8.on.inSystem) > Number(numbers.s8.baseInSystem));
  assert.ok(Number(numbers.s8.lp.unsafe) < Number(numbers.s8.off.unsafe));
  assert.ok(Number(numbers.q6.none.escaped) > Number(numbers.q6.base.escaped) && Number(numbers.q6.none.finished) > Number(numbers.q6.base.finished));
  assert.ok(Number(numbers.q6.all.escaped) > 0 && Number(numbers.q6.all.escaped) < Number(numbers.q6.base.escaped), 'approving every task helps but is not perfect');
});

// ---- review round 3 ----
import { runExperiment, runFloor, CHANGES } from './experiment-lab.mjs';
import { checkTraceShape } from './lesson-numbers.mjs';

test('lesson 4: the blocked task-minutes are the model total, not the sum of the top three waits', () => {
  const cut = runExperiment('cutModelApi', { baseline: { reviewers: 2 } });
  const o = CHANGES.cutModelApi.outage, floor = runFloor({ reviewers: 2 }, { outage: o });
  assert.equal(cut.variant.blockedMinutes, floor.metrics().wait.blocked);
  assert.equal(numbers.cut.blocked, String(floor.metrics().wait.blocked));
});

test('lesson 3: "holds" and "fails" come from the gap with the same 10% rule as the page', () => {
  assert.equal(numbers.two.verdict, 'holds'); assert.equal(numbers.one.verdict, 'fails'); assert.equal(numbers.l3.oneVerdict, 'does not apply here');
  const src = readFileSync('lessons-src/03-littles-law.html', 'utf8');
  assert.ok(src.includes('{{l3.twoVerdict}}') && src.includes('{{l3.oneVerdict}}') && !/>(holds|fails|does not apply here) \(off/.test(src));
});

test('lesson 5 does not call tasks being worked "waiting"', () => {
  assert.ok(!readFileSync('lessons-src/05-human-decision.html', 'utf8').includes('still waiting at the end'));
});

test('lesson 4: the outage window and shift end come from the model, not typed numbers', () => {
  const o = CHANGES.cutModelApi.outage;
  assert.equal(numbers.outage.from, `${String(8 + Math.floor(o.from / 60)).padStart(2, '0')}:${String(o.from % 60).padStart(2, '0')}`);
  assert.equal(numbers.outage.minutes, String(o.to - o.from)); assert.equal(numbers.shiftEnd, '16:00');
  assert.ok(!/\b1[25]0\b/.test(readFileSync('lesson-numbers.mjs', 'utf8')), 'lesson-numbers.mjs repeats the outage minutes');
  assert.ok(!/10:00|10:30|16:00|30-minute/.test(readFileSync('lessons-src/04-failure-modes.html', 'utf8')), 'lesson 4 types clock times');
});

test('lesson 2: the trace check fails a trace that begins or ends with a wait', () => {
  const s = (state, start, end) => ({ state, start, end });
  assert.doesNotThrow(() => checkTraceShape({ id: 'ok', spans: [s('working', 0, 5), s('waiting', 5, 9), s('working', 9, 12)] }));
  assert.throws(() => checkTraceShape({ id: 'w1', spans: [s('waiting', 0, 2), s('working', 2, 5), s('waiting', 5, 9), s('working', 9, 12)] }), /work, wait, work/);
  assert.throws(() => checkTraceShape({ id: 'w2', spans: [s('working', 0, 5), s('waiting', 5, 9), s('working', 9, 12), s('waiting', 12, 13)] }), /work, wait, work/);
});

// ---- simulated reader test fixes (2026-10-27) ----
test('lesson 3: Littles Law holds when every task is counted (rate x average time in the system = counted work in progress)', () => {
  const l = runFloor({ reviewers: 1 }).metrics().littlesLaw;
  assert.ok(Math.abs(l.arrivalsPerMinute * l.avgTimeInSystem - l.observedWip) < 1e-9);
  assert.equal(numbers.one.avgWip, (Math.round(l.arrivalsPerMinute * l.avgTimeInSystem * 10) / 10).toFixed(1));
  assert.ok(Number(numbers.one.inSystem) < Number(numbers.one.cycle), 'lesson 3 says the all-task average is lower than the finished-only average');
});

test('lesson 4: the stopped task-minutes plus the extra waiting add up to the extra time the outage cost', () => {
  const o = CHANGES.cutModelApi.outage, base = runFloor({ reviewers: 2 }).metrics(), cut = runFloor({ reviewers: 2 }, { outage: o }).metrics();
  const total = m => m.wait.work + m.wait.queue + m.wait.blocked + m.wait.approval;
  assert.equal(Number(numbers.cut.blocked) + Number(numbers.l4.rest), total(cut) - total(base));
  assert.ok(Math.abs((total(cut) - total(base)) / cut.arrived - (Number(numbers.cut.systemCut) - Number(numbers.cut.systemBase))) < 0.11, 'extra task-minutes per task is the rise in average time in the system');
  assert.ok(Number(numbers.cut.blocked) < Number(numbers.l4.rest), 'lesson 4 says most of the extra time is waiting in line');
});

test('lesson 6: the four places a mistake can end up add up to the mistakes made', () => {
  const b = numbers.q6.base;
  assert.equal(Number(b.caughtReview) + Number(b.caughtApproval) + Number(b.escaped) + Number(numbers.q6.stillIn), Number(numbers.q6.defects));
  assert.ok(Number(b.missedApproval) <= Number(b.escaped), 'missed at approval is counted in escaped');
});

test('lesson 8: exactly one poisoned request arrives too late to reach a tool, and the counts add up', () => {
  const s = numbers.s8;
  assert.equal(s.notReached, '1'); assert.equal(Number(s.reached), Number(s.poisoned) - 1);
  assert.equal(Number(s.on.blocked) + Number(s.on.slipped), Number(s.reached));
  assert.equal(Number(s.on.unsafe), Number(s.on.slipped) - Number(s.on.denied));
});

test('lesson 7: plain-words trip comes before the map, and the jargon notes come after it', () => {
  const html = readFileSync('lessons-src/07-sensors-and-checkpoints.html', 'utf8'), at = s => html.indexOf(s);
  assert.ok(at('First the trip, in plain words') > 0 && at('First the trip, in plain words') < at('{{svg.enterpriseMap}}'));
  assert.ok(at('SIEM') > at('{{svg.enterpriseMap}}'), 'SIEM is explained after the picture');
  assert.ok(html.includes('only the tool-call log shows what was sent'));
});
