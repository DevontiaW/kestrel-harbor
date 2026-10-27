import { AgentFloor } from './agent-floor.mjs';
import { PlantLine, Coop, WaterSystem, Fishery } from './plant-line.mjs';
// Classroom parameters, not vendor specifications. One tick = one simulated minute; minute 0 = 08:00.
export const PARAMETERS = Object.freeze({ transit: 12, unload: 4, offsite: 20, crates: 4, kitCrates: 4, admin: 6, requestEvery: 10, fieldCircuit: 120, flushPerMinute: 6, saleEvery: 90, rack: 16, pad: 20 });
// Review backlog storage: an intake rack inside the agent floor, then a marked overflow pad. Past both, work spills into Harbor St.
export const SHIFTS = Object.freeze({ length: 480, firstStart: -120, overlap: 20 }); // shifts start 06:00, 14:00, 22:00

// Which shift is on, and whether workers are arriving or leaving (the 20 minutes either side of a change).
export function shiftInfo(time) {
  const into = ((time - SHIFTS.firstStart) % SHIFTS.length + SHIFTS.length) % SHIFTS.length;
  const index = Math.floor((time - SHIFTS.firstStart) / SHIFTS.length);
  const names = ['Day', 'Swing', 'Night'];
  return { name: names[((index % 3) + 3) % 3], changing: into < SHIFTS.overlap || into >= SHIFTS.length - SHIFTS.overlap,
    arriving: into >= SHIFTS.length - SHIFTS.overlap ? (into - (SHIFTS.length - SHIFTS.overlap)) / SHIFTS.overlap : null,
    leaving: into < SHIFTS.overlap ? into / SHIFTS.overlap : null, minutesToChange: SHIFTS.length - into };
}

export class District {
  constructor() {
    this.time = 0; this.remainder = 0;
    this.internet = true; this.positioning = true; this.power = true; this.modelApi = true; this.reviewer = true; // modelApi and reviewer: break-it controls for the agent floor
    this.fieldTime = 0; this.roadTime = 0;
    this.dispatched = 1; this.receivedLoads = 0; this.received = 0; this.inventory = 0; this.kits = 0;
    this.requests = 1; this.adminQueue = 1; this.adminProgress = null; this.adminDone = 0;
    this.generated = 0; this.transmitted = 0; this.buffered = 0;
    this.trucks = [{ id: 'truck-a', phase: 'inbound', elapsed: 0 }, { id: 'truck-b', phase: 'offsite', elapsed: 0 }];
    this.floor = new AgentFloor(); this.plant = new PlantLine(); this.coop = new Coop(); this.water = new WaterSystem(); this.fish = new Fishery();
    this.sold = 0; this.blocked = false;
    this.events = [{ time: 0, text: 'Supplier truck TRK-2207 dispatched. All services available.' }];
  }
  get online() { return this.internet && this.power; }
  get storeStock() { return this.plant.completed.length - this.sold; }
  event(text) { this.events.unshift({ time: this.time, text }); this.events.length = Math.min(this.events.length, 6); }
  setService(name, value) {
    if (!['internet', 'positioning', 'power', 'modelApi', 'reviewer'].includes(name)) throw new Error('Unknown service');
    this[name] = Boolean(value);
    if (name === 'reviewer') this.event(value ? 'Reviewers back at the review desk.' : 'Reviewers away from the review desk.');
    else this.event(`${{ internet: 'Internet', positioning: 'RTK correction', power: 'Power', modelApi: 'Model API' }[name]} ${value ? 'restored' : 'lost'}.`);
    if (this.online && this.buffered) this.event(`${this.buffered} buffered reports start sending at ${PARAMETERS.flushPerMinute}/min.`);
  }
  // Quality and security rules on the agent floor (see agent-floor.mjs). New tasks pick up a changed rule as they arrive.
  setRule(name, value) {
    const words = { defectEvery: 'Defects', missEvery: 'Review misses', approveMissEvery: 'Approval misses', poisonEvery: 'Poisoned requests', slipEvery: 'Checkpoint misses', checkpoint: 'Checkpoint', leastPrivilege: 'Least privilege' };
    if (!(name in words)) throw new Error('Unknown rule');
    this.floor.rules[name] = typeof this.floor.rules[name] === 'boolean' ? Boolean(value) : Math.max(0, Math.floor(Number(value) || 0));
    this.event(`${words[name]} ${this.floor.rules[name] ? 'on' : 'off'}.`);
  }
  setReviewers(n) { this.floor.reviewers = n; this.event(`Review desk staffed with ${n} reviewer${n > 1 ? 's' : ''}.`); }
  setStations(stage, n) { this.plant.setMachines(stage, n); this.event(`Plant: ${['cut & weld', 'paint', 'wheels', 'assembly'][stage]} now has ${n} station${n > 1 ? 's' : ''}.`); }
  advance(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error('Advance requires nonnegative minutes');
    this.remainder += minutes;
    const ticks = Math.floor(this.remainder + 1e-9); this.remainder -= ticks;
    for (let i = 0; i < ticks; i++) this.tick();
    return this;
  }
  tick() {
    this.time++;
    this.roadTime++; // Self-powered, onboard route-following model; no remote steering.
    if (this.positioning) this.fieldTime++;
    this.generated += 2;
    if (this.online) { const flush = Math.min(this.buffered, PARAMETERS.flushPerMinute); this.transmitted += 2 + flush; this.buffered -= flush; }
    else this.buffered += 2;
    for (const truck of this.trucks) {
      if (truck.phase === 'unloading' && !this.power) continue;
      if (this.blocked && ((truck.phase === 'inbound' && truck.elapsed === 2) || (truck.phase === 'outbound' && truck.elapsed === 9))) continue; // held behind the spill on Harbor St
      truck.elapsed++;
      const duration = truck.phase === 'offsite' ? PARAMETERS.offsite : truck.phase === 'unloading' ? PARAMETERS.unload : PARAMETERS.transit;
      if (truck.elapsed < duration) continue;
      truck.elapsed = 0;
      if (truck.phase === 'offsite') { truck.phase = 'inbound'; this.dispatched++; }
      else if (truck.phase === 'inbound') { truck.phase = 'unloading'; this.event(`${truck.id === 'truck-a' ? 'TRK-2207' : 'TRK-2214'} backed into its receiving bay.`); }
      else if (truck.phase === 'unloading') {
        truck.phase = 'outbound'; this.receivedLoads++; this.received += PARAMETERS.crates; this.inventory += PARAMETERS.crates;
        this.event(`${PARAMETERS.crates} parts crates received at the plant dock.`);
      } else truck.phase = 'offsite';
    }
    // Receiving kits crates into bike kits (4 crates each) and releases them to cutting & welding.
    if (this.power) while (this.inventory >= PARAMETERS.kitCrates) { this.inventory -= PARAMETERS.kitCrates; this.kits++; this.plant.release(); }
    const before = this.plant.completed.length;
    this.plant.tick(this.power);
    if (this.plant.completed.length > before) this.event(`Bike ${this.plant.completed.at(-1).id} finished final assembly.`);
    if (this.time % PARAMETERS.saleEvery === 0 && this.storeStock > 0) this.sold++;
    this.coop.tick({ harvesting: this.positioning, power: this.power });
    this.water.tick(this.power);
    const spoiledBefore = this.fish.spoiled; this.fish.tick(this.power);
    if (this.fish.spoiled > spoiledBefore && spoiledBefore === 0) this.event('Fish house above 5 °C: catch is spoiling.');
    if (this.time % PARAMETERS.requestEvery === 0) { this.requests++; this.adminQueue++; }
    if (this.online && this.modelApi) { // the clinic admin desk also calls the remote model API
      if (this.adminProgress !== null && ++this.adminProgress >= PARAMETERS.admin) { this.adminProgress = null; this.adminDone++; }
      if (this.adminProgress === null && this.adminQueue > 0) { this.adminQueue--; this.adminProgress = 0; }
    }
    this.floor.tick({ internet: this.internet, power: this.power, modelApi: this.modelApi, reviewer: this.reviewer });
    const waiting = this.floor.tasks.filter(t => t.stage === 'review' && t.state === 'queued').length, spill = waiting > PARAMETERS.rack + PARAMETERS.pad;
    if (spill !== this.blocked) { this.blocked = spill; this.event(spill ? 'Review backlog spilled into Harbor St: trucks held.' : 'Harbor St cleared: trucks moving.'); }
  }
  metrics() {
    return { time: this.time, fieldTime: this.fieldTime, roadTime: this.roadTime, dispatched: this.dispatched, receivedLoads: this.receivedLoads, received: this.received, inventory: this.inventory, kits: this.kits,
      requests: this.requests, adminQueue: this.adminQueue, adminProgress: this.adminProgress, adminDone: this.adminDone, generated: this.generated, transmitted: this.transmitted, buffered: this.buffered,
      trucks: this.trucks.map(t => ({ ...t })), floor: this.floor.metrics(), plant: this.plant.metrics(), coop: { ...this.coop, truck: { ...this.coop.truck } }, water: this.water.level, sold: this.sold, blocked: this.blocked, fish: { temp: this.fish.temp, store: this.fish.store, landed: this.fish.landed, shipped: this.fish.shipped, spoiled: this.fish.spoiled, boats: this.fish.boats.map(b => ({ ...b })) } };
  }
}
