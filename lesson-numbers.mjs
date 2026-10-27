// Every number quoted in the lesson pages, computed from the model. build.mjs replaces {{name}} in lessons-src/*.html
// with these values, so a lesson can never drift from the simulation it describes.
import { FLOOR, STATIONS, QUALITY_ON, SECURITY_ON, QUARANTINE, INJECTED, ROLE_TOOLS, TOOLS } from './agent-floor.mjs';
import { NODES, SENSORS, CHECKPOINTS, INCIDENTS, recordedBy, stoppableBy, enterpriseMapSvg, townInsideSvg } from './network-surface.mjs';
import { runFloor, runExperiment, littlesLawHolds, HORIZON, START_HOUR, CHANGES } from './experiment-lab.mjs';

const r0 = v => String(Math.round(v)), r1 = v => (Math.round(v * 10) / 10).toFixed(1), pct = v => `${Math.round(v * 100)}%`;
const minutesOf = id => STATIONS.find(s => s.id === id).minutes;
const station = (f, id) => f.metrics().stations.find(s => s.id === id);
const clock = t => `${String(START_HOUR + Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const verdict = gap => littlesLawHolds(gap) ? 'holds' : 'fails';

// The lesson 2 card draws work, one wait, work. Fail the build if the task's trace has any other shape.
export function checkTraceShape(task) {
  const s = task.spans, waitsAfterWork = s.filter((x, i) => x.state === 'waiting' && s[i - 1]?.state === 'working').length;
  if (s[0]?.state !== 'working' || s.at(-1)?.state !== 'working' || waitsAfterWork !== 1) throw new Error(`${task.id} trace is not work, wait, work`);
}

export function lessonNumbers() {
  const one = runFloor({ reviewers: 1 }), two = runFloor({ reviewers: 2 }), three = runFloor({ reviewers: 3 });
  const m1 = one.metrics(), m2 = two.metrics(), m3 = three.metrics();
  const perHour = 60 / FLOOR.arriveEvery, reviewsPerHour = perHour * (1 + 1 / FLOOR.reworkEvery);
  // Lesson 2: the last finished task with one reviewer, and the shift-wide waiting share.
  const last = one.done.at(-1), lastWork = last.worked, lastLife = last.finished - last.arrival;
  checkTraceShape(last);
  // Lesson 3: tasks arrive faster (every 3 minutes instead of 4) with the same single reviewer.
  const faster = runFloor({ reviewers: 1, arriveEvery: 3 }).metrics();
  // Lesson 4: failures on a floor with 2 reviewers (review is no longer the constraint).
  const cut = runExperiment('cutModelApi', { baseline: { reviewers: 2 } });
  // Reviewers away for the same window as the model API outage.
  const outage = CHANGES.cutModelApi.outage, away = runFloor({ reviewers: 2 }, { outage: { ...outage, service: 'reviewer' } }).metrics();
  const reworkShare = 1 / FLOOR.reworkEvery;
  // Where the outage's extra time went: task-minutes stopped by the outage versus extra waiting in line.
  const cutM = runFloor({ reviewers: 2 }, { outage }).metrics(), taskMinutes = m => m.wait.work + m.wait.queue + m.wait.blocked + m.wait.approval;
  const cutExtra = taskMinutes(cutM) - taskMinutes(m2);
  // Lesson 5: approval placement, 2 reviewers.
  const noApproval = runExperiment('removeApproval', { baseline: { reviewers: 2 } });
  const approveAll = runFloor({ reviewers: 2, ...CHANGES.approveEveryTask.options() }).metrics();
  const approverLoadAll = perHour * minutesOf('approve');
  return {
    shiftHours: String(HORIZON / 60), shiftEnd: clock(HORIZON), outage: { from: clock(outage.from), to: clock(outage.to), minutes: String(outage.to - outage.from) }, arrivalsPerHour: r0(perHour), arriveEvery: String(FLOOR.arriveEvery), arrived: String(m1.arrived),
    reviewMinutes: String(minutesOf('review')), approveMinutes: String(minutesOf('approve')), approveEvery: String(FLOOR.approveEvery), reworkEvery: String(FLOOR.reworkEvery),
    agentMinutes: String(minutesOf('research') + minutesOf('plan') + minutesOf('execute')), workMinutes: String(minutesOf('research') + minutesOf('plan') + minutesOf('execute') + minutesOf('review')),
    reviewsPerHour: r0(reviewsPerHour), reviewMinutesNeeded: r0(reviewsPerHour * minutesOf('review')), reviewCapacityPerHour: r0(60 / minutesOf('review')),
    one: { finished: String(m1.done), left: String(m1.wip), cycle: r0(m1.avgCycle), reviewQueue: String(station(one, 'review').queued), reviewBusy: pct(station(one, 'review').utilization),
      researchBusy: pct(station(one, 'research').utilization), executeBusy: pct(station(one, 'execute').utilization), perHour: r1(m1.throughputPerHour), reviewWait: r0(m1.avgReviewWait),
      inSystem: r1(m1.littlesLaw.avgTimeInSystem), avgWip: r1(m1.littlesLaw.observedWip), rate: String(m1.littlesLaw.arrivalsPerMinute),
      finRate: (Math.round(m1.littlesLaw.finishedPerMinute * 1000) / 1000).toFixed(3), finPred: r1(m1.littlesLaw.finishedPrediction), gap: pct(Math.abs(m1.littlesLaw.finishedGap)), verdict: verdict(m1.littlesLaw.finishedGap),
      waitShare: pct((m1.wait.queue + m1.wait.blocked + m1.wait.approval) / (m1.wait.work + m1.wait.queue + m1.wait.blocked + m1.wait.approval)) },
    two: { avgWip: r1(m2.littlesLaw.observedWip), finRate: (Math.round(m2.littlesLaw.finishedPerMinute * 1000) / 1000).toFixed(3), finPred: r1(m2.littlesLaw.finishedPrediction), gap: pct(Math.abs(m2.littlesLaw.finishedGap)), verdict: verdict(m2.littlesLaw.finishedGap), finished: String(m2.done), left: String(m2.wip), cycle: r0(m2.avgCycle), reviewBusy: pct(station(two, 'review').utilization), approvalWait: String(m2.wait.approval), perHour: r1(m2.throughputPerHour) },
    three: { finished: String(m3.done), cycle: r1(m3.avgCycle), reviewBusy: pct(station(three, 'review').utilization), approvalWait: String(m3.wait.approval) },
    last: { workBefore: String(last.spans.slice(0, last.spans.findIndex(s => s.state === 'waiting')).reduce((a, s) => a + s.end - s.start, 0)),
      workAfter: String(last.spans.slice(last.spans.findLastIndex(s => s.state === 'waiting') + 1).reduce((a, s) => a + s.end - s.start, 0)),
      reviewPhrase: (() => { const w = last.spans.filter(s => s.stage === 'review' && s.state === 'waiting').reduce((a, s) => a + s.end - s.start, 0); return w === lastLife - lastWork ? 'all of them' : `${w} of them`; })(),
      reviewWait: String(last.spans.filter(s => s.stage === 'review' && s.state === 'waiting').reduce((a, s) => a + s.end - s.start, 0)), id: last.id, life: String(lastLife), work: String(lastWork), wait: String(lastLife - lastWork), arrived: clock(last.arrival), finished: clock(last.finished) },
    faster: { extra: String(faster.arrived - m1.arrived), perHour: r0(60 / 3), arrived: String(faster.arrived), finished: String(faster.done), left: String(faster.wip), avgWip: r1(faster.littlesLaw.observedWip), inSystem: r1(faster.littlesLaw.avgTimeInSystem) },
    cut: { finishedDelta: String(cut.deltas.finished), cycleBase: r1(cut.baseline.avgCompletedCycle), cycleCut: r1(cut.variant.avgCompletedCycle), systemBase: r1(cut.baseline.avgTimeInSystem), systemCut: r1(cut.variant.avgTimeInSystem),
      blocked: String(cut.variant.blockedMinutes) },
    away: { finished: String(away.done), blocked: String(away.wait.blocked), reviewWait: r1(away.avgReviewWait), reviewWaitBase: r1(m2.avgReviewWait) },
    // Reader-test wording (kept out of `one`, `two` and `cut`, which the default-off fingerprint locks).
    l3: { oneVerdict: verdict(m1.littlesLaw.finishedGap) === 'holds' ? 'holds' : 'does not apply here', twoVerdict: verdict(m2.littlesLaw.finishedGap) === 'holds' ? 'holds' : 'does not apply here' },
    l4: { finished: String(cut.variant.finished), extra: r0(cutExtra), blockedShare: pct(cut.variant.blockedMinutes / cutExtra), rest: r0(cutExtra - cut.variant.blockedMinutes) },
    reworkPct: pct(reworkShare),
    noApproval: { finishedNo: String(noApproval.variant.finished), finishedDelta: String(noApproval.deltas.finished), systemBase: r1(noApproval.baseline.avgTimeInSystem), systemNo: r1(noApproval.variant.avgTimeInSystem) },
    approveAll: { waitHours: r0(approveAll.wait.approval / 60), inSystem: r1(approveAll.littlesLaw.avgTimeInSystem), finished: String(approveAll.done), left: String(approveAll.wip), approvalWait: String(approveAll.wait.approval), approverBusy: pct(approveAll.stations.find(s => s.id === 'approve').utilization), load: r0(approverLoadAll) },
    approveNth: nth(FLOOR.approveEvery), reworkNth: nth(FLOOR.reworkEvery),
    ...governNumbers({ one, two, last, cut, noApproval, approveAll, outage }),
  };
}

// Lessons 6 to 8 and the "Build it yourself" checks. All on the 2-reviewer floor unless named otherwise.
function governNumbers({ one, two, last, cut, noApproval, approveAll, outage }) {
  const q = rules => runFloor({ reviewers: 2, ...QUALITY_ON, ...rules }).metrics();
  const qBase = q({}), qNo = q({ approveEvery: 0 }), qAll = q({ approveEvery: 1 });
  const qRow = m => ({ finished: String(m.done), escaped: String(m.quality.escaped), caughtReview: String(m.quality.caughtReview), caughtApproval: String(m.quality.caughtApproval), missedApproval: String(m.quality.missedApproval), inSystem: r1(m.littlesLaw.avgTimeInSystem) });
  const s = rules => runFloor({ reviewers: 2, ...SECURITY_ON, ...rules }).metrics();
  const sOn = s({}), sLp = s({ checkpoint: false }), sOff = s({ checkpoint: false, leastPrivilege: false });
  const sRow = m => ({ unsafe: String(m.security.unsafe), denied: String(m.security.denied), slipped: String(m.security.slipped), blocked: String(m.security.blocked), finished: String(m.done), inSystem: r1(m.littlesLaw.avgTimeInSystem) });
  const lastWork = last.worked, lastLife = last.finished - last.arrival;
  const seen = recordedBy('sendOutside'), stops = stoppableBy('sendOutside'), leakSeen = recordedBy('modelLeak'), leakStops = stoppableBy('modelLeak');
  const names = list => list.map(x => x.name.toLowerCase()).join(', ');
  const short = name => name.replace(/ \(.*\)$/, '');
  const boxes = (list, sep = ', ') => list.map(x => short(NODES.find(n => n.id === x.at).name)).join(sep);
  const m2 = two.metrics();
  return {
    q6: { defectNth: nth(QUALITY_ON.defectEvery), missNth: nth(QUALITY_ON.missEvery), approveMissNth: nth(QUALITY_ON.approveMissEvery), approveMissEvery: String(QUALITY_ON.approveMissEvery), catchOf: `${QUALITY_ON.missEvery - 1} of every ${QUALITY_ON.missEvery}`,
      defectEvery: String(QUALITY_ON.defectEvery), defectEvery2: String(2 * QUALITY_ON.defectEvery), defectEvery3: String(3 * QUALITY_ON.defectEvery), missEvery: String(QUALITY_ON.missEvery),
      notApproved: `${FLOOR.approveEvery - 1} in ${FLOOR.approveEvery}`,
      notCaught: `${FLOOR.approveEvery - 1} in ${FLOOR.approveEvery} never approved, plus 1 in ${QUALITY_ON.approveMissEvery} of the approved ones missed`,
      expected: r0(qBase.quality.defects / QUALITY_ON.missEvery * (1 - (1 / FLOOR.approveEvery) * (1 - 1 / QUALITY_ON.approveMissEvery))),
      defects: String(qBase.quality.defects), missed: String(qBase.quality.missedReview), seenAtApproval: String(qBase.quality.caughtApproval + qBase.quality.missedApproval), stillIn: String(qBase.quality.defects - qBase.quality.caughtReview - qBase.quality.caughtApproval - qBase.quality.escaped),
      base: qRow(qBase), none: qRow(qNo), all: qRow(qAll), moreEscaped: String(qNo.quality.escaped - qBase.quality.escaped), moreFinished: String(qNo.done - qBase.done), cleanFinished: String(m2.done) },
    s8: { poisonNth: nth(SECURITY_ON.poisonEvery), slipNth: nth(SECURITY_ON.slipEvery), slipEvery: String(SECURITY_ON.slipEvery), slipList: [1, 2, 3].map(i => nth(i * SECURITY_ON.slipEvery)).join(', '), reached: String(sOn.security.blocked + sOn.security.slipped), notReached: String(sOn.security.poisoned - sOn.security.blocked - sOn.security.slipped), ...Object.fromEntries(['A', 'B', 'C', 'D'].map((k, i) => [`poison${k}`, String((i + 1) * SECURITY_ON.poisonEvery)])), poisoned: String(sOn.security.poisoned), quarantineMinutes: String(QUARANTINE.minutes),
      on: sRow(sOn), lp: sRow(sLp), off: sRow(sOff), baseInSystem: r1(m2.littlesLaw.avgTimeInSystem), baseFinished: String(m2.done),
      exportLabel: INJECTED.exportRecords.label, sendLabel: INJECTED.sendOutside.label, executeTools: ROLE_TOOLS.execute.map(t => TOOLS[t]).join(' and ') },
    net7: { sensors: String(SENSORS.length), checkpoints: String(CHECKPOINTS.length), seen: String(seen.length), seenNames: names(seen), stops: String(stops.length), stopNames: names(stops).replace(/, ([^,]*)$/, ' and $1'), first: stops[0].name.toLowerCase(),
      missedSensor: SENSORS.find(x => x.at === 'gateway').name.toLowerCase(), leakSeen: String(leakSeen.length), leakSeenNames: names(leakSeen), leakFirst: leakStops[0].name.toLowerCase(),
      // The same answers in the box names a reader's own map uses (the prompt names the boxes, not the sensors).
      // The lesson 7 starter prompt, built from the same map so it cannot drift from the checks.
      promptBoxes: NODES.map(n => short(n.name)).join(', '), promptSensors: SENSORS.map(x => boxes([x])).join(', '), promptCheckpoints: CHECKPOINTS.map(c => boxes([c])).join(', '),
      incident1: INCIDENTS.sendOutside.button, path1: INCIDENTS.sendOutside.path.map(id => short(NODES.find(n => n.id === id).name)).join(', then '),
      incident2: INCIDENTS.modelLeak.button, path2: INCIDENTS.modelLeak.path.map(id => short(NODES.find(n => n.id === id).name)).join(', then '),
      sensorList: SENSORS.map(x => `${x.name.toLowerCase()} (${boxes([x])})`).join(', '),
      checkpointList: CHECKPOINTS.map(c => `${c.name.toLowerCase()} (${boxes([c])}${c.built ? ', built in the town' : ', drawn only'})`).join(', '),
      seenBoxes: boxes(seen), stopBoxes: boxes(stops, ', then '), leakSeenBoxes: boxes(leakSeen), leakStopBoxes: boxes(leakStops, ', then '), missedBox: boxes(SENSORS.filter(x => x.at === 'gateway')) },
    build: {
      minutes: String(HORIZON), seq: Object.fromEntries(['approve', 'rework', 'arrive'].flatMap(k => [2, 3].map(i => [`${k}${i}`, String(i * FLOOR[`${k}Every`])]))), min: Object.fromEntries(STATIONS.map(st => [st.id, String(st.minutes)])), executeSlots: String(STATIONS.find(st => st.id === 'execute').slots),
      l1: { three: String(runFloor({ reviewers: 3 }).done.length), oneLeft: String(one.metrics().wip) },
      l2: { task: String(last.n), arrivedMinute: String(last.arrival), finishedMinute: String(last.finished), work: String(lastWork), wait: String(lastLife - lastWork) },
      l4: { from: String(outage.from + 1), to: String(outage.to), blocked: String(cut.variant.blockedMinutes), finishedDelta: String(cut.deltas.finished) },
      l5: { none: String(noApproval.variant.finished), all: String(approveAll.done) },
    },
    svg: { townInside: townInsideSvg(), enterpriseMap: enterpriseMapSvg({ id: 'map-plain' }), incidentMap: enterpriseMapSvg({ id: 'map-incident', highlight: 'sendOutside' }) },
  };
}
const nth = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// Replace {{a.b}} tokens; throw on any unknown name so a typo cannot ship as literal braces.
export function fillNumbers(html, numbers = lessonNumbers()) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), numbers);
    if (typeof v !== 'string') throw new Error(`Unknown lesson number: ${key}`);
    return v;
  });
}
