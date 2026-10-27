import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentFloor, FLOOR } from './agent-floor.mjs';
const ALL = { internet: true, power: true };
const run = (f, minutes, services = ALL) => { for (let i = 0; i < minutes; i++) f.tick(services); return f; };
const conserve = f => { const m = f.metrics(); assert.equal(m.arrived, m.wip + m.done); };

test('the first task moves research, plan, execute, review in 3+3+4+6 minutes', () => {
  const f = run(new AgentFloor(), 4); // arrives at minute 4, starts at minute 5
  assert.equal(f.tasks[0].stage, 'research');
  run(f, 16); assert.equal(f.done.length, 1); assert.equal(f.done[0].finished - f.done[0].arrival, 16); conserve(f);
});

test('one reviewer is the bottleneck: review queue grows over a shift, two reviewers keep it short', () => {
  const one = run(new AgentFloor({ reviewers: 1 }), 480).metrics();
  const two = run(new AgentFloor({ reviewers: 2 }), 480).metrics();
  const q = m => m.stations.find(s => s.id === 'review').queued;
  assert.ok(q(one) > 25, `one reviewer queue ${q(one)}`);
  assert.ok(q(two) <= 2, `two reviewer queue ${q(two)}`);
  assert.ok(two.avgCycle < one.avgCycle / 3);
  assert.ok(one.stations.find(s => s.id === 'review').utilization > .95);
  assert.ok(two.throughputPerHour > one.throughputPerHour);
});

test('internet loss stops the remote-model stations; local execution and review keep working their queues', () => {
  const f = run(new AgentFloor({ reviewers: 2 }), 120);
  const before = { ...f.busy };
  run(f, 30, { internet: false, power: true });
  assert.equal(f.busy.research, before.research); assert.equal(f.busy.plan, before.plan);
  assert.ok(f.busy.review > before.review);
  assert.ok(f.metrics().wait.blocked > 0); conserve(f);
});

test('power loss stops every station and arrivals queue as blocked', () => {
  const f = run(new AgentFloor(), 60); const done = f.done.length; const busy = { ...f.busy };
  run(f, 40, { internet: true, power: false });
  assert.equal(f.done.length, done); assert.deepEqual(f.busy, busy); conserve(f);
});

test('every third task waits for the human approver and every fifth is reworked once', () => {
  const f = run(new AgentFloor({ reviewers: 2 }), 600);
  const third = f.done.find(t => t.n % FLOOR.approveEvery === 0);
  const plain = f.done.find(t => t.n % FLOOR.approveEvery && t.n % FLOOR.reworkEvery);
  const fifth = f.done.find(t => t.n % FLOOR.reworkEvery === 0);
  assert.ok(third.approval >= 0 && third.worked === 3 + 3 + 4 + 6 + 5 + (third.reworked ? 10 : 0));
  assert.equal(plain.worked, 16); assert.ok(fifth.reworked); conserve(f);
});

test('task minutes are fully attributed: working + queue + blocked + approval', () => {
  const f = new AgentFloor();
  for (let i = 0; i < 300; i++) f.tick({ internet: i % 50 > 10, power: i % 90 > 5 });
  for (const t of [...f.done, ...f.tasks]) {
    const age = (t.finished ?? f.time) - t.arrival;
    assert.equal(t.worked + t.queued + t.blocked + t.approval, age);
  }
  conserve(f);
});
