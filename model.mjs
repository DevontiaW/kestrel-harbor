export const STAGES = [
  { name: 'Cutting & welding', short: 'Cut & weld', minutes: 45, machines: 2 },
  { name: 'Painting', short: 'Paint', minutes: 60, machines: 1 },
  { name: 'Wheel building', short: 'Wheels', minutes: 30, machines: 2 },
  { name: 'Final assembly', short: 'Assembly', minutes: 40, machines: 1 },
];

export function analyze(machines, release) {
  const capacities = STAGES.map((s, i) => 60 * machines[i] / s.minutes);
  const capacity = Math.min(...capacities);
  return { capacities, capacity, bottlenecks: capacities.map((c, i) => Math.abs(c - capacity) < 1e-8 ? i : -1).filter(i => i >= 0),
    output: Math.min(release, capacity), excess: Math.max(0, release - capacity), touchTime: 175 };
}

// Deterministic serial line, FIFO queues, unlimited buffers, no travel time.
// Same-time completions are processed together, then arrivals, then dispatch.
export class Factory {
  constructor(machines = [2, 1, 2, 1], release = 2) {
    if (machines.length !== 4 || machines.some(n => !Number.isInteger(n) || n < 1 || n > 4) || !Number.isFinite(release) || release <= 0 || release > 4) throw new Error('Invalid factory configuration');
    this.machines = [...machines]; this.release = release; this.time = 0; this.nextArrival = 0;
    this.queues = STAGES.map(() => []); this.busy = machines.map(n => Array(n).fill(null));
    this.arrived = 0; this.completed = []; this.areaWip = 0; this.busyMinutes = [0, 0, 0, 0];
    this.advance(0);
  }
  get wip() { return this.arrived - this.completed.length; }
  dispatch() {
    this.busy.forEach((slots, i) => slots.forEach((slot, j) => {
      if (!slot && this.queues[i].length) {
        const unit = this.queues[i].shift();
        slots[j] = { unit, start: this.time, end: this.time + STAGES[i].minutes };
      }
    }));
  }
  advance(target) {
    if (!Number.isFinite(target) || target < this.time) throw new Error('Time must move forward');
    while (true) {
      const next = Math.min(this.nextArrival, ...this.busy.flat().filter(Boolean).map(s => s.end));
      const stop = Math.min(target, next);
      const dt = stop - this.time;
      this.areaWip += dt * this.wip;
      this.busy.forEach((s, i) => { this.busyMinutes[i] += dt * s.filter(Boolean).length; });
      this.time = stop;
      if (next > target + 1e-9) break;
      this.busy.forEach((slots, i) => slots.forEach((slot, j) => {
        if (slot && slot.end <= this.time + 1e-9) {
          slots[j] = null;
          if (i === 3) this.completed.push({ ...slot.unit, exited: this.time });
          else this.queues[i + 1].push(slot.unit);
        }
      }));
      if (this.nextArrival <= this.time + 1e-9) {
        this.queues[0].push({ id: ++this.arrived, entered: this.time });
        this.nextArrival += 60 / this.release;
      }
      this.dispatch();
      if (this.time >= target - 1e-9) break;
    }
    return this;
  }
  metrics() {
    return { time: this.time, released: this.arrived, completed: this.completed.length, wip: this.wip,
      queues: this.queues.map(q => q.length), averageWip: this.time ? this.areaWip / this.time : 0,
      averageFlow: this.completed.length ? this.completed.reduce((sum, u) => sum + u.exited - u.entered, 0) / this.completed.length : null,
      utilization: this.busyMinutes.map((m, i) => this.time ? m / (this.time * this.machines[i]) : 0) };
  }
}
