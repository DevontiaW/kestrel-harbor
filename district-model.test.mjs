import test from 'node:test';
import assert from 'node:assert/strict';
import { District, shiftInfo } from './district-model.mjs';
import { COOP } from './plant-line.mjs';
const conservation = d => {
  assert.equal(d.received, d.inventory + d.kits * 4);
  assert.equal(d.kits, d.plant.released); assert.equal(d.plant.released, d.plant.wip + d.plant.completed.length);
  assert.ok(d.sold <= d.plant.completed.length);
  assert.equal(d.requests, d.adminQueue + d.adminDone + Number(d.adminProgress !== null));
  assert.equal(d.generated, d.transmitted + d.buffered);
  const inTransit = d.trucks.filter(t => ['inbound', 'unloading'].includes(t.phase)).length;
  assert.equal(d.dispatched, d.receivedLoads + inTransit);
};
test('a load takes 12 travel + 4 receiving minutes; 4 crates become one bike kit at cutting & welding', () => {
  const d = new District().advance(15); assert.equal(d.received, 0);
  d.advance(1); assert.equal(d.received, 4); assert.equal(d.kits, 1); assert.equal(d.plant.metrics().working[0], 1);
  d.advance(45); assert.equal(d.plant.metrics().working[1], 1); conservation(d);
});
test('the plant keeps the original lesson: paint (1/hr) is the constraint; a second booth moves it to assembly (1.5/hr)', () => {
  const run = paint => { const d = new District(); d.setReviewers(3); /* keep Harbor St clear so the plant lesson is isolated */ if (paint > 1) d.setStations(1, paint); d.advance(16 * 60); const a = d.plant.completed.length; d.advance(8 * 60); return { d, rate: (d.plant.completed.length - a) / 8 }; };
  const one = run(1), two = run(2);
  assert.ok(Math.abs(one.rate - 1) < .15, `rate ${one.rate}`); assert.equal(one.d.plant.metrics().constraint, 1);
  assert.ok(Math.abs(two.rate - 1.5) < .15, `rate ${two.rate}`); assert.equal(two.d.plant.metrics().constraint, 3);
  assert.ok(one.d.plant.metrics().queues[1] > 10, 'kits pile up in front of paint'); conservation(one.d); conservation(two.d);
});
test('internet loss buffers reports and blocks remote work, not onboard motion or the plant', () => {
  const d = new District(); d.setService('internet', false); d.advance(200);
  assert.equal(d.fieldTime, 200); assert.equal(d.roadTime, 200); assert.equal(d.adminDone, 0);
  assert.equal(d.buffered, 400); assert.equal(d.transmitted, 0); assert.ok(d.plant.completed.length > 0);
  d.setService('internet', true); assert.equal(d.buffered, 400);
  d.advance(7); assert.equal(d.adminDone, 1); assert.equal(d.buffered, 400 - 42);
  d.advance(60); assert.equal(d.buffered, 0); conservation(d);
});
test('RTK loss pauses harvesting, not an in-progress grain haul or road vehicles', () => {
  const d = new District().advance(20); d.setService('positioning', false); d.advance(40);
  assert.equal(d.fieldTime, 20); assert.equal(d.roadTime, 60); assert.equal(d.coop.loadsReady + d.coop.hauled, 0);
  d.setService('positioning', true); d.advance(10); assert.equal(d.fieldTime, 30); conservation(d);
});
test('a grain load already dispatched can finish its trip during an RTK outage', () => {
  const d = new District().advance(COOP.fillMinutes + 1);
  assert.equal(d.coop.truck.phase, 'to-coop');
  const filled = d.coop.cartFill, fieldTime = d.fieldTime;
  d.setService('positioning', false); d.advance(COOP.haul + COOP.dump);
  assert.equal(d.coop.hauled, 1); assert.equal(d.coop.truck.phase, 'to-field');
  assert.equal(d.coop.cartFill, filled); assert.equal(d.fieldTime, fieldTime); conservation(d);
});
test('power loss holds the dock, the plant and the co-op; the water tower carries demand from storage', () => {
  const d = new District(); d.setService('power', false); d.advance(100);
  assert.equal(d.received, 0); assert.ok(d.trucks.every(t => t.phase === 'unloading' && t.elapsed === 0));
  assert.equal(d.plant.completed.length, 0); assert.equal(d.fieldTime, 100); assert.equal(d.buffered, 200);
  assert.equal(d.water.level, 50); assert.equal(d.water.pressure, 'normal');
  d.advance(80); assert.equal(d.water.pressure, 'low');
  d.setService('power', true); d.advance(4); assert.equal(d.received, 8); assert.ok(d.water.level > 10); conservation(d);
});
test('the farm co-op: every 40 field minutes fills a cart, the truck hauls it, the mill grinds it', () => {
  const d = new District(); d.advance(COOP.fillMinutes + 1);
  assert.equal(d.coop.truck.phase, 'to-coop');
  d.advance(COOP.haul + COOP.dump); assert.equal(d.coop.hauled, 1);
  d.advance(COOP.mill + 1); assert.equal(d.coop.milled, 1);
});
test('shift changes at 14:00 and 22:00 bring workers in 20 minutes before and out 20 minutes after', () => {
  assert.equal(shiftInfo(0).name, 'Day'); assert.equal(shiftInfo(0).changing, false);
  assert.ok(shiftInfo(350).arriving > 0 && shiftInfo(350).leaving === null);
  assert.equal(shiftInfo(370).name, 'Swing'); assert.ok(shiftInfo(370).leaving >= 0);
  assert.equal(shiftInfo(860).name, 'Night');
});
test('a review backlog past the rack and pad spills into Harbor St and holds supply trucks; three reviewers prevent it', () => {
  const d = new District(); let firstBlock = null;
  for (let i = 0; i < 600 && firstBlock === null; i++) { d.advance(1); if (d.blocked) firstBlock = d.time; }
  assert.ok(firstBlock !== null, 'one reviewer eventually overflows');
  d.advance(20); const received = d.received; d.advance(90); // a truck already at the dock may finish first
  assert.ok(d.blocked); assert.equal(d.received, received, 'no parts arrive while Harbor St is blocked');
  assert.ok(d.trucks.some(t => (t.phase === 'inbound' && t.elapsed === 2) || (t.phase === 'outbound' && t.elapsed === 9)));
  d.setReviewers(3); let cleared = false; for (let i = 0; i < 600 && !cleared; i++) { d.advance(1); cleared = !d.blocked; }
  assert.ok(cleared, 'three reviewers clear the spill'); conservation(d);
  const e = new District(); e.setReviewers(3); e.advance(960); assert.equal(e.blocked, false);
});
test('fishing harbor: catch lands and ships; a power cut warms cold storage and spoils the catch after about 40 minutes', () => {
  const d = new District(); d.advance(240);
  assert.ok(d.fish.landed > 0); assert.equal(d.fish.spoiled, 0); assert.equal(d.fish.landed, d.fish.store + d.fish.shipped + d.fish.spoiled);
  d.fish.store = 20; d.setService('power', false); d.advance(39); assert.equal(d.fish.spoiled, 0, 'storage holds for ~40 min');
  d.advance(15); assert.ok(d.fish.spoiled > 0, 'then the catch spoils'); assert.ok(d.fish.temp > 5);
  d.setService('power', true); d.advance(60); assert.ok(d.fish.temp < 2);
});
test('counts conserve across mixed outages and staffing changes', () => {
  const d = new District();
  for (let i = 0; i < 2500; i++) {
    if (i % 113 === 0) d.setService('internet', !d.internet);
    if (i % 179 === 0) d.setService('power', !d.power);
    if (i % 211 === 0) d.setService('positioning', !d.positioning);
    if (i % 400 === 0) d.setStations(1, 1 + (i / 400) % 2);
    d.advance(1); conservation(d);
  }
});
test('fixed ticks make results independent of animation frame sizes; zero advances nothing', () => {
  const a = new District().advance(120); const b = new District();
  for (let i = 0; i < 1200; i++) b.advance(.1);
  assert.deepEqual(a.metrics(), b.metrics()); const before = b.metrics(); b.advance(0); assert.deepEqual(b.metrics(), before);
});
