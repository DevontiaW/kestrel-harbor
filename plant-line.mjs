// Larkspur Cycle Works as a tick-based serial line inside the district. Same stages, minutes and station
// counts as the original four-stage lesson (model.mjs), but kits arrive from the receiving dock and every
// station needs district power. One tick = one simulated minute.
import { STAGES } from './model.mjs';
export { STAGES };

export class PlantLine {
  constructor(machines = [2, 1, 2, 1]) {
    this.machines = [...machines]; this.time = 0; this.nextId = 1;
    this.queues = STAGES.map(() => []); this.slots = this.machines.map(n => Array(n).fill(null));
    this.released = 0; this.completed = []; this.busy = [0, 0, 0, 0];
  }
  setMachines(i, n) { // grow or shrink a station; work on a removed machine returns to the front of its queue
    while (this.slots[i].length < n) this.slots[i].push(null);
    while (this.slots[i].length > n) { const s = this.slots[i].pop(); if (s) this.queues[i].unshift(s.unit); }
    this.machines[i] = n;
  }
  release() { this.queues[0].push({ id: `BK-${String(this.nextId++).padStart(4, '0')}`, entered: this.time }); this.released++; }
  tick(power) {
    this.time++;
    if (!power) return;
    this.slots.forEach((slots, i) => slots.forEach((s, j) => {
      if (!s) return;
      s.progress++; this.busy[i]++;
      if (s.progress >= STAGES[i].minutes) {
        slots[j] = null;
        if (i === STAGES.length - 1) this.completed.push({ ...s.unit, exited: this.time });
        else this.queues[i + 1].push(s.unit);
      }
    }));
    this.slots.forEach((slots, i) => slots.forEach((s, j) => { if (!s && this.queues[i].length) slots[j] = { unit: this.queues[i].shift(), progress: 0 }; }));
  }
  get wip() { return this.released - this.completed.length; }
  metrics() {
    const caps = STAGES.map((s, i) => 60 * this.machines[i] / s.minutes), cap = Math.min(...caps);
    return { released: this.released, completed: this.completed.length, wip: this.wip, machines: [...this.machines],
      queues: this.queues.map(q => q.length), working: this.slots.map(s => s.filter(Boolean).length),
      capacities: caps, constraint: caps.findIndex(c => Math.abs(c - cap) < 1e-9),
      utilization: this.busy.map((b, i) => this.time ? b / (this.time * this.machines[i]) : 0) };
  }
}

// Farm co-op: the harvester fills a grain cart; a farm truck hauls each load to the elevator, the mill grinds it.
export const COOP = Object.freeze({ fillMinutes: 40, haul: 9, dump: 5, mill: 25 });
export class Coop {
  constructor() { this.cartFill = 0; this.loadsReady = 0; this.truck = { phase: 'field', elapsed: 0 }; this.hauled = 0; this.bin = 0; this.milling = null; this.milled = 0; }
  tick({ harvesting, power }) {
    if (harvesting && ++this.cartFill >= COOP.fillMinutes) { this.cartFill = 0; this.loadsReady++; }
    const t = this.truck;
    if (t.phase === 'field') { if (this.loadsReady > 0) { this.loadsReady--; t.phase = 'to-coop'; t.elapsed = 0; } }
    else if (t.phase === 'to-coop') { if (++t.elapsed >= COOP.haul) { t.phase = 'dumping'; t.elapsed = 0; } }
    else if (t.phase === 'dumping') { if (power && ++t.elapsed >= COOP.dump) { this.hauled++; this.bin++; t.phase = 'to-field'; t.elapsed = 0; } }
    else if (t.phase === 'to-field') { if (++t.elapsed >= COOP.haul) { t.phase = 'field'; t.elapsed = 0; } }
    if (power) {
      if (this.milling !== null && ++this.milling >= COOP.mill) { this.milling = null; this.milled++; }
      if (this.milling === null && this.bin > 0) { this.bin--; this.milling = 0; }
    }
  }
}

// Water: an elevated tank refilled by an electric pump. Storage carries demand through a power cut.
export const WATER = Object.freeze({ demand: .5, pump: 1.2 });
export class WaterSystem {
  constructor() { this.level = 100; }
  tick(power) { this.level = Math.max(0, Math.min(100, this.level - WATER.demand + (power ? WATER.pump : 0))); }
  get pressure() { return this.level > 15 ? 'normal' : this.level > 0 ? 'low' : 'none'; }
}

// Fishing harbor: shrimp boats trawl, land their catch at the fish house, cold storage keeps it, a reefer truck ships it.
// Perishable inventory: cold storage needs power; without it the room warms and, past 5 °C, a box spoils every minute.
export const FISH = Object.freeze({ boats: 3, trawl: 90, run: 10, unload: 8, docked: 20, catch: 6, warm: .1, cool: .2, spoilAt: 5, shipEvery: 60, shipMax: 12 });
export class Fishery {
  constructor() {
    this.time = 0; this.temp = 1; this.store = 0; this.landed = 0; this.shipped = 0; this.spoiled = 0;
    this.boats = Array.from({ length: FISH.boats }, (_, i) => ({ id: i + 1, phase: 'out', elapsed: i * 40, trips: 0 }));
  }
  tick(power) {
    this.time++;
    for (const b of this.boats) {
      if (b.phase === 'unloading' && !power) continue; // hoist and ice need dock power
      b.elapsed++;
      const dur = { out: FISH.trawl, returning: FISH.run, unloading: FISH.unload, docked: FISH.docked, leaving: FISH.run }[b.phase];
      if (b.elapsed < dur) continue;
      b.elapsed = 0;
      if (b.phase === 'out') b.phase = 'returning';
      else if (b.phase === 'returning') b.phase = 'unloading';
      else if (b.phase === 'unloading') { b.phase = 'docked'; b.trips++; this.store += FISH.catch; this.landed += FISH.catch; }
      else if (b.phase === 'docked') b.phase = 'leaving';
      else b.phase = 'out';
    }
    this.temp = power ? Math.max(1, this.temp - FISH.cool) : this.temp + FISH.warm;
    if (this.temp > FISH.spoilAt && this.store > 0) { this.store--; this.spoiled++; }
    if (this.time % FISH.shipEvery === 0) { const n = Math.min(this.store, FISH.shipMax); this.store -= n; this.shipped += n; }
  }
}
