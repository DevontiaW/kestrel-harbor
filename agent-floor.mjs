// Agent ops floor: a deterministic serial workflow. AI agents research, plan and execute; people review the output;
// a shift lead approves every third task.
// Illustrative classroom parameters, one tick = one simulated minute. Real agent work varies far more.
export const FLOOR = Object.freeze({
  arriveEvery: 4,   // one task every 4 min = 15 tasks/hour
  approveEvery: 3,  // every 3rd task needs human approval (0 = no approval step)
  reworkEvery: 5,   // every 5th task fails review once and returns to execution
  // Quality and security rules. Off by default (0), so the floor above behaves exactly as before.
  defectEvery: 0,   // every Nth task carries a defect that review has to catch
  missEvery: 0,     // every Nth review that sees a defect misses it (0 = review never misses)
  approveMissEvery: 0, // every Nth defect the human approver sees, the approver misses (0 = approver never misses)
  poisonEvery: 0,   // every Nth task arrives with an instruction hidden in the content it reads (prompt injection)
  checkpoint: true, // a policy check before every tool action; a blocked task goes to the quarantine desk
  slipEvery: 0,     // every Nth poisoned action, the checkpoint lets through because it looks allowed (0 = checkpoint never slips)
  leastPrivilege: true, // each agent holds only the tools its role needs
});
// The settings the page, the lab and the lessons use when the quality or security rules are switched on.
export const QUALITY_ON = Object.freeze({ defectEvery: 4, missEvery: 4, approveMissEvery: 2 }); // neither a multiple of 3, so approval (every 3rd task) sees a fair third of the misses
export const SECURITY_ON = Object.freeze({ poisonEvery: 10, slipEvery: 3 });

// needs: which services a station requires to work. A service counts as down only when it is explicitly false,
// so callers that pass just { internet, power } keep the model API and the reviewers present.
export const STATIONS = Object.freeze([
  { id: 'research', label: 'Research agent', minutes: 3, needs: ['internet', 'modelApi', 'power'], uses: 'Remote model API + web sources' },
  { id: 'plan', label: 'Planning agent', minutes: 3, needs: ['internet', 'modelApi', 'power'], uses: 'Remote model API' },
  { id: 'execute', label: 'Execution agents', minutes: 4, needs: ['power'], uses: 'Local tools and files', slots: 2 },
  { id: 'review', label: 'Reviewer (person)', minutes: 6, needs: ['power', 'reviewer'], uses: 'Checks agent output against evidence' },
  { id: 'approve', label: 'Human approver', minutes: 5, needs: ['power'], uses: 'Ops console' },
]);
// A person checks every task the checkpoint blocks. This station exists only while poisoned requests are switched on
// (or a task has already been sent to it), so the default floor keeps its five stations.
export const QUARANTINE = Object.freeze({ id: 'quarantine', label: 'Quarantine desk (person)', minutes: 10, needs: ['power'], uses: 'Checks blocked tasks by hand' });
const ALL_STATIONS = [...STATIONS, QUARANTINE];
const WORKER = { research: 'research agent', plan: 'planning agent', execute: 'execution agent', review: 'reviewer', approve: 'shift lead', quarantine: 'security lead' };
// Least privilege: the tools each role needs. Without it, every agent runs with one broad account that can use all of them.
export const TOOLS = Object.freeze({
  readSources: 'read web sources', callModel: 'call the model API', editDraft: 'edit the draft', sendEmail: 'send email',
  exportRecords: 'export every customer record',
});
export const ROLE_TOOLS = Object.freeze({ research: ['readSources', 'callModel'], plan: ['callModel'], execute: ['editDraft', 'sendEmail'] });
// What a hidden instruction asks the execution agent to do. Odd-numbered poisoned tasks ask for a tool outside the role;
// even-numbered ones misuse a tool the role does have (send email, pointed at an outside address). Least privilege here
// limits which tools a role holds, not how it uses them; a narrower tool (send only to the customer on file) would refuse it too.
export const INJECTED = Object.freeze({
  exportRecords: { tool: 'exportRecords', label: 'export every customer record' },
  sendOutside: { tool: 'sendEmail', label: 'send the file to an outside address' },
});
export const SCHEMA_VERSION = '1.1.0'; // the event and span shapes documented in docs/EVENT-SCHEMA.md

export class AgentFloor {
  // options: reviewers, arriveEvery, approveEvery, reworkEvery, minutes ({ review: 8 } overrides a station's minutes)
  constructor({ reviewers = 1, minutes = {}, ...rules } = {}) {
    this.time = 0; this.reviewers = reviewers; this.nextId = 1;
    this.rules = { ...FLOOR, ...rules };
    this.minutes = Object.fromEntries(ALL_STATIONS.map(s => [s.id, minutes[s.id] ?? s.minutes]));
    this.tasks = []; this.done = [];
    this.busy = Object.fromEntries(ALL_STATIONS.map(s => [s.id, 0]));
    this.quality = { defects: 0, caughtReview: 0, missedReview: 0, caughtApproval: 0, missedApproval: 0, escaped: 0 };
    this.security = { poisoned: 0, blocked: 0, denied: 0, slipped: 0, unsafe: 0, cleared: 0 };
    this.defectReviews = 0;   // reviews that saw a defect, for the miss rule
    this.defectApprovals = 0; // approvals that saw a defect, for the approver's miss rule
    this.toolChecks = 0;      // poisoned tool actions the checkpoint examined, for the slip rule
    this.wait = { work: 0, queue: 0, blocked: 0, approval: 0 };
    this.log = [];            // every event, in order: entered, started, left, finished
    this.waitBy = {};         // waiting minutes by cause key, e.g. "queue|review" or "blocked|research|modelApi"
    this.entries = Object.fromEntries(ALL_STATIONS.map(s => [s.id, 0]));
    this.stageWait = Object.fromEntries(ALL_STATIONS.map(s => [s.id, 0]));
    this.wipMinutes = 0;      // sum over minutes of tasks in the system, sampled each minute (for Little's Law)
    this.capMinutes = Object.fromEntries(ALL_STATIONS.map(s => [s.id, 0])); // capacity actually staffed, minute by minute
  }
  // The stations in use: the five fixed ones, plus quarantine once poisoned requests are on or a task has been sent there.
  get stations() { return this.rules.poisonEvery > 0 || this.entries.quarantine > 0 ? ALL_STATIONS : STATIONS; }
  capacity(id) { return id === 'review' ? this.reviewers : ALL_STATIONS.find(s => s.id === id).slots || 1; }
  missing(station, services) { return station.needs.filter(n => services[n] === false); }
  available(station, services) { return this.missing(station, services).length === 0; }

  emit(t, type, detail = {}) { this.log.push({ minute: this.time, task: t.id, type, ...detail }); }
  // Record one minute of a task's life as a span. Consecutive identical minutes merge into one span.
  mark(t, state, cause = null, by = null) {
    const last = t.spans.at(-1), worker = state === 'working' ? t.worker : null;
    if (last && last.end === this.time - 1 && last.stage === t.stage && last.state === state && last.cause === cause && String(last.by) === String(by) && last.worker === worker) last.end = this.time;
    else t.spans.push({ stage: t.stage, state, cause, by, worker, start: this.time - 1, end: this.time });
    if (state === 'waiting') { const key = [cause, t.stage, ...(by || [])].join('|'); this.waitBy[key] = (this.waitBy[key] || 0) + 1; this.stageWait[t.stage]++; }
  }
  enter(t, stage) { t.stage = stage; t.state = 'queued'; t.progress = 0; t.worker = null; this.entries[stage]++; this.emit(t, 'entered', { stage }); }

  tick(services) {
    this.time++;
    const waiting = this.tasks.filter(t => t.state === 'queued'); // snapshot so a task never counts twice in one minute
    this.wipMinutes += this.tasks.length;
    const stations = this.stations;
    for (const s of stations) this.capMinutes[s.id] += Math.max(this.capacity(s.id), this.tasks.filter(t => t.stage === s.id && t.state === 'working').length);
    // 1. Work in-process tasks; finished tasks join the next queue.
    for (const s of stations) {
      const down = this.missing(s, services);
      for (const t of this.tasks.filter(t => t.stage === s.id && t.state === 'working')) {
        if (down.length) { t.blocked++; this.wait.blocked++; this.mark(t, 'waiting', 'blocked', down); continue; }
        t.progress++; t.worked++; this.busy[s.id]++; this.wait.work++; this.mark(t, 'working');
        if (t.progress >= this.minutes[s.id]) this.route(t);
      }
    }
    // 2. Waiting tasks accrue waiting time by cause.
    for (const t of waiting) {
      const down = this.missing(ALL_STATIONS.find(x => x.id === t.stage), services);
      const cause = down.length ? 'blocked' : t.stage === 'approve' ? 'approval' : 'queue';
      t[cause === 'queue' ? 'queued' : cause]++; this.wait[cause]++;
      this.mark(t, 'waiting', cause, down.length ? down : null);
    }
    // 3. Arrivals.
    if (this.time % this.rules.arriveEvery === 0) {
      const n = this.nextId++;
      const t = { id: `T-${String(n).padStart(3, '0')}`, n, arrival: this.time, stage: null, state: 'queued', progress: 0, worked: 0, queued: 0, blocked: 0, approval: 0, reworked: false, worker: null, spans: [] };
      // Quality and security marks are added only when their rule is on, so the default floor's tasks are unchanged.
      if (this.rules.defectEvery > 0 && n % this.rules.defectEvery === 0) { t.defect = true; t.carriedDefect = true; this.quality.defects++; }
      if (this.rules.poisonEvery > 0 && n % this.rules.poisonEvery === 0) {
        t.poisoned = true; t.injected = (n / this.rules.poisonEvery) % 2 ? 'exportRecords' : 'sendOutside'; this.security.poisoned++;
      }
      this.tasks.push(t); this.enter(t, 'research');
    }
    // 4. Start queued tasks in free slots (FIFO), only where the station is available.
    for (const s of this.stations) {
      if (!this.available(s, services)) continue;
      const busyHere = this.tasks.filter(t => t.stage === s.id && t.state === 'working');
      let free = this.capacity(s.id) - busyHere.length;
      const used = new Set(busyHere.map(t => t.slot));
      for (const t of this.tasks) {
        if (free <= 0) break;
        if (t.stage === s.id && t.state === 'queued') {
          let slot = 1; while (used.has(slot)) slot++; used.add(slot);
          t.state = 'working'; t.progress = 0; t.slot = slot; free--;
          t.worker = this.capacity(s.id) > 1 || s.id === 'review' ? `${WORKER[s.id]} ${slot}` : WORKER[s.id];
          this.emit(t, 'started', { stage: s.id, worker: t.worker });
        }
      }
    }
  }
  route(t) {
    const from = t.stage, by = t.worker;
    if (from === 'review') {
      if (t.defect) { // this review sees a defect: it catches it unless the miss rule says this one slips through
        this.defectReviews++;
        const missed = this.rules.missEvery > 0 && this.defectReviews % this.rules.missEvery === 0;
        this.emit(t, 'defect', { stage: from, worker: by, result: missed ? 'missed' : 'caught' });
        if (!missed) {
          this.quality.caughtReview++; t.defect = false; t.reworked = true; // the fix counts as the task's one rework
          this.emit(t, 'left', { stage: from, worker: by, outcome: 'rework' }); this.enter(t, 'execute'); return;
        }
        this.quality.missedReview++;
      }
      const rework = t.n % this.rules.reworkEvery === 0 && !t.reworked;
      this.emit(t, 'left', { stage: from, worker: by, outcome: rework ? 'rework' : 'pass' });
      if (rework) { t.reworked = true; this.enter(t, 'execute'); }
      else if (this.rules.approveEvery && t.n % this.rules.approveEvery === 0) this.enter(t, 'approve');
      else this.finish(t);
      return;
    }
    if (from === 'approve' && t.defect) { // the shift lead catches what review missed, unless the miss rule says this one slips through
      this.defectApprovals++;
      if (this.rules.approveMissEvery > 0 && this.defectApprovals % this.rules.approveMissEvery === 0) {
        this.quality.missedApproval++; this.emit(t, 'defect', { stage: from, worker: by, result: 'missed' });
      } else {
        this.quality.caughtApproval++; t.defect = false;
        this.emit(t, 'defect', { stage: from, worker: by, result: 'caught' });
        this.emit(t, 'left', { stage: from, worker: by, outcome: 'rejected' }); this.enter(t, 'execute'); return;
      }
    }
    if (from === 'execute' && t.poisoned && this.toolAction(t, by)) return;
    if (from === 'quarantine') { // a person removes the hidden instruction; the task runs execution again, clean
      this.security.cleared++; t.poisoned = false;
      this.emit(t, 'left', { stage: from, worker: by, outcome: 'cleared' }); this.enter(t, 'execute'); return;
    }
    this.emit(t, 'left', { stage: from, worker: by, outcome: from === 'approve' ? 'approved' : 'done' });
    if (from === 'research') this.enter(t, 'plan');
    else if (from === 'plan') this.enter(t, 'execute');
    else if (from === 'execute') this.enter(t, 'review');
    else this.finish(t);
  }
  // The execution agent tries the action the hidden instruction asked for. Returns true when the task went to quarantine.
  toolAction(t, by) {
    const ask = INJECTED[t.injected], detail = { stage: 'execute', worker: by, tool: ask.tool, request: t.injected };
    // policy enforcement point: the action is checked before it runs. Every slipEvery-th poisoned action looks allowed and gets through the check.
    const slipped = this.rules.checkpoint && this.rules.slipEvery > 0 && ++this.toolChecks % this.rules.slipEvery === 0;
    if (slipped) { this.security.slipped++; detail.slipped = true; }
    if (this.rules.checkpoint && !slipped) {
      this.security.blocked++; t.quarantined = true;
      this.emit(t, 'tool', { ...detail, result: 'blocked' });
      this.emit(t, 'left', { stage: 'execute', worker: by, outcome: 'blocked' }); this.enter(t, 'quarantine'); return true;
    }
    t.poisoned = false; // without a working checkpoint the hidden instruction is acted on (or refused) once, then spent
    if (this.rules.leastPrivilege && !ROLE_TOOLS.execute.includes(ask.tool)) { this.security.denied++; this.emit(t, 'tool', { ...detail, result: 'denied' }); return false; }
    this.security.unsafe++; t.unsafe = true; this.emit(t, 'tool', { ...detail, result: 'carried-out' });
    return false;
  }
  finish(t) {
    t.state = 'done'; t.stage = 'done'; t.finished = this.time; t.worker = null;
    if (t.defect) { this.quality.escaped++; t.escaped = true; this.emit(t, 'defect', { stage: 'done', worker: null, result: 'escaped' }); }
    this.emit(t, 'finished', { cycle: t.finished - t.arrival, approved: t.spans.some(s => s.stage === 'approve' && s.state === 'working'), reworked: t.reworked });
    this.tasks.splice(this.tasks.indexOf(t), 1); this.done.push(t);
  }
  task(id) { return this.tasks.find(t => t.id === id) || this.done.find(t => t.id === id) || null; }
  // The top waiting causes so far, largest first, as { key, cause, stage, by, minutes }.
  topWaits(n = 3) {
    return Object.entries(this.waitBy).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
      .map(([key, minutes]) => { const [cause, stage, ...by] = key.split('|'); return { key, cause, stage, by, minutes }; });
  }
  metrics() {
    const hours = this.time / 60;
    const cycle = this.done.length ? this.done.reduce((a, t) => a + t.finished - t.arrival, 0) / this.done.length : 0;
    const stations = this.stations.map(s => {
      const here = this.tasks.filter(t => t.stage === s.id);
      return { id: s.id, queued: here.filter(t => t.state === 'queued').length, working: here.filter(t => t.state === 'working').length,
        capacity: this.capacity(s.id), utilization: this.capMinutes[s.id] ? this.busy[s.id] / this.capMinutes[s.id] : 0,
        entered: this.entries[s.id], avgWait: this.entries[s.id] ? this.stageWait[s.id] / this.entries[s.id] : 0 };
    });
    const arrived = this.nextId - 1, taskMinutes = this.wait.work + this.wait.queue + this.wait.blocked + this.wait.approval;
    // Little's Law: average work in progress = rate x average time in system.
    // - bookkeeping: arrivals x time in system of every task (unfinished minutes included). This always equals the counted
    //   work in progress, so it checks the event log, not the floor.
    // - finishedCheck: finished per minute x average time of finished tasks, measured only on work that left. It matches
    //   the counted work in progress when the floor is stable and misses badly when work piles up faster than it leaves.
    const rate = this.time ? arrived / this.time : 0, timeInSystem = arrived ? taskMinutes / arrived : 0;
    const observedWip = this.time ? this.wipMinutes / this.time : 0, departures = this.time ? this.done.length / this.time : 0;
    const finishedPrediction = departures * cycle;
    const littlesLaw = { arrivalsPerMinute: rate, avgTimeInSystem: timeInSystem, predictedWip: rate * timeInSystem, observedWip,
      finishedPerMinute: departures, finishedPrediction, finishedGap: observedWip ? (finishedPrediction - observedWip) / observedWip : 0 };
    return { time: this.time, arrived, wip: this.tasks.length, done: this.done.length,
      throughputPerHour: hours ? this.done.length / hours : 0, avgCycle: cycle, stations, wait: { ...this.wait }, reviewers: this.reviewers,
      avgReviewWait: stations.find(s => s.id === 'review').avgWait, littlesLaw, topWaits: this.topWaits(),
      quality: { ...this.quality }, security: { ...this.security } };
  }
}
