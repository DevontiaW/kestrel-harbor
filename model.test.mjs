import test from 'node:test';
import assert from 'node:assert/strict';
import { Factory, analyze } from './model.mjs';
test('Independent capacity checkpoints match the existing Larkspur library', () => {
  assert.equal(analyze([2, 1, 2, 1], 2).capacity, 1);
  assert.deepEqual(analyze([2, 2, 2, 1], 2).bottlenecks, [3]);
  assert.equal(analyze([2, 2, 2, 1], 2).capacity, 1.5);
  assert.equal(analyze([2, 2, 2, 2], 2).capacity, 2);
  assert.equal(analyze([4, 1, 2, 1], 2).capacity, 1);
  assert.equal(analyze([2, 2, 2, 2], .5).output, .5);
});
test('First bicycle requires all 175 processing minutes', () => {
  const f = new Factory(); f.advance(174.999); assert.equal(f.completed.length, 0);
  f.advance(175); assert.equal(f.completed.length, 1); assert.equal(f.completed[0].exited, 175);
});
test('Eight-hour hand schedule: original 6, extra paint 8, both improvements 11', () => {
  assert.equal(new Factory().advance(480).completed.length, 6);
  assert.equal(new Factory([2, 2, 2, 1]).advance(480).completed.length, 8);
  assert.equal(new Factory([2, 2, 2, 2]).advance(480).completed.length, 11);
});
test('No bicycles disappear or duplicate, no slot exceeds its resources', () => {
  for (const m of [[2, 1, 2, 1], [2, 2, 2, 1], [2, 2, 2, 2], [1, 3, 1, 4]]) {
    const f = new Factory(m, 3);
    for (let t = 0; t <= 480; t += 7) {
      f.advance(t);
      const units = [...f.completed, ...f.queues.flat(), ...f.busy.flat().filter(Boolean).map(s => s.unit)];
      assert.equal(units.length, f.arrived); assert.equal(new Set(units.map(u => u.id)).size, f.arrived);
      assert(f.metrics().utilization.every(u => u >= 0 && u <= 1 + 1e-9));
    }
  }
});
test('Frame size does not affect results', () => {
  const a = new Factory().advance(480), b = new Factory();
  for (let t = 1; t <= 480; t++) b.advance(t);
  assert.deepEqual(a.metrics(), b.metrics());
});
test('Low release rate produces no queues; overload builds paint inventory', () => {
  assert.deepEqual(new Factory([2, 1, 2, 1], .5).advance(480).metrics().queues, [0, 0, 0, 0]);
  assert(new Factory().advance(480).queues[1].length > 0);
});
