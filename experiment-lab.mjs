// Experiment Lab v0: run the agent floor twice from the same empty start for the same horizon,
// once as a baseline and once with exactly one change, then report the differences. Deterministic.
import { AgentFloor, SECURITY_ON } from './agent-floor.mjs';

export const HORIZON = 480; // one 8-hour shift, 08:00 to 16:00
export const START_HOUR = 8; // minute 0 of the shift is 08:00

// The Little's Law check "holds" when prediction and count are within 10%. The page and the lessons share this rule.
export const littlesLawHolds = gap => Math.round(Math.abs(gap) * 100) <= 10;

// Each change is one intervention. `options` change the floor; `outage` cuts one service for a window of minutes.
export const CHANGES = Object.freeze({
  addReviewer: { label: 'Add a reviewer', describe: b => `${b.reviewers + 1} reviewers instead of ${b.reviewers}`, options: b => ({ reviewers: b.reviewers + 1 }) },
  removeApproval: { label: 'Remove the human approval step', describe: () => 'no task waits for the shift lead', options: () => ({ approveEvery: 0 }) },
  approveEveryTask: { label: 'Approve every task', describe: () => 'the shift lead approves every task, not every third', options: () => ({ approveEvery: 1 }) },
  longerReview: { label: 'Lengthen review to 8 minutes', describe: () => 'each review takes 8 minutes instead of 6', options: () => ({ minutes: { review: 8 } }) },
  cutModelApi: { label: 'Cut the model API for 30 minutes', describe: () => 'model API down 10:00 to 10:30', options: () => ({}), outage: { service: 'modelApi', from: 120, to: 150 } },
  // Security changes need poisoned requests to show anything, so `both` switches them on in both runs; the change is still one thing.
  checkpointOff: { label: 'Turn off the checkpoint', describe: () => `no policy check before tool actions (both runs: a poisoned request every ${SECURITY_ON.poisonEvery}th task; the baseline has the checkpoint on)`, options: () => ({ checkpoint: false }), both: { ...SECURITY_ON, checkpoint: true } },
  leastPrivilegeOff: { label: 'Give agents every tool (no least privilege)', describe: () => `agents share one account that can use every tool (both runs: a poisoned request every ${SECURITY_ON.poisonEvery}th task, checkpoint off, so only least privilege stands in the way)`, options: () => ({ leastPrivilege: false }), both: { ...SECURITY_ON, checkpoint: false, leastPrivilege: true } },
});

// Run one floor for `horizon` minutes. Outage minutes are counted from 08:00: from 120 to 150 is 10:00 to 10:30.
export function runFloor(options = {}, { horizon = HORIZON, outage = null } = {}) {
  const floor = new AgentFloor(options);
  for (let minute = 0; minute < horizon; minute++) {
    const services = { internet: true, power: true, modelApi: true, reviewer: true };
    if (outage && minute >= outage.from && minute < outage.to) services[outage.service] = false;
    floor.tick(services);
  }
  return floor;
}

export function summarize(floor) {
  const m = floor.metrics(), review = m.stations.find(s => s.id === 'review');
  return { minutes: floor.time, finished: m.done, stillInSystem: m.wip, finishedPerHour: m.throughputPerHour, avgCompletedCycle: m.avgCycle,
    avgTimeInSystem: m.littlesLaw.avgTimeInSystem, avgReviewWait: m.avgReviewWait, reviewBusy: review.utilization, blockedMinutes: m.wait.blocked, topWaits: m.topWaits,
    // Quality and security (all zero while those rules are off).
    escaped: m.quality.escaped, unsafe: m.security.unsafe, quality: m.quality, security: m.security };
}

const DELTA_KEYS = ['finished', 'stillInSystem', 'finishedPerHour', 'avgCompletedCycle', 'avgTimeInSystem', 'avgReviewWait', 'reviewBusy', 'escaped', 'unsafe'];

// baseline: floor options for the baseline run (default: the page's starting floor, 1 reviewer).
export function runExperiment(changeId, { baseline = { reviewers: 1 }, horizon = HORIZON } = {}) {
  const change = CHANGES[changeId];
  if (!change) throw new Error(`Unknown change: ${changeId}`);
  if (change.both) baseline = { ...baseline, ...change.both };
  const base = summarize(runFloor(baseline, { horizon }));
  const variant = summarize(runFloor({ ...baseline, ...change.options(baseline) }, { horizon, outage: change.outage }));
  const deltas = Object.fromEntries(DELTA_KEYS.map(k => [k, variant[k] - base[k]]));
  return { change: changeId, label: change.label, description: change.describe(baseline), horizon, baseline: base, variant, deltas };
}

// Plain words for a waiting cause, e.g. { cause: 'blocked', stage: 'research', by: ['modelApi'] }.
const STAGE_WORDS = { research: 'research', plan: 'planning', execute: 'execution', review: 'review', approve: 'the shift lead' };
const SERVICE_WORDS = { internet: 'internet down', modelApi: 'model API down', power: 'power down', reviewer: 'reviewers away' };
export function describeWait(w) {
  if (w.cause === 'queue') return `In line for ${STAGE_WORDS[w.stage]}`;
  if (w.cause === 'approval') return 'Waiting for the shift lead to approve';
  return `Stopped at ${STAGE_WORDS[w.stage]}: ${w.by.map(b => SERVICE_WORDS[b] || `${b} down`).join(' + ')}`;
}
