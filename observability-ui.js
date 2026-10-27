// Observability section for the agent floor: metrics, a single-task trace, Experiment Lab v0 and break-it controls.
// Every number shown here is read from the model's event log or metrics; nothing is typed in by hand.
import { STATIONS, QUALITY_ON, SECURITY_ON, ROLE_TOOLS, TOOLS, INJECTED } from './agent-floor.mjs';
import { CHANGES, HORIZON, runExperiment, describeWait, littlesLawHolds } from './experiment-lab.mjs';
import { enterpriseMapSvg, recordedBy, stoppableBy } from './network-surface.mjs';

const $ = id => document.getElementById(id);
const ALL_SERVICES = ['internet', 'positioning', 'power', 'modelApi', 'reviewer'];
const NAME = { research: 'Research', plan: 'Planning', execute: 'Execution', review: 'Review', approve: 'Approval', quarantine: 'Quarantine' };
const RULE_KEYS = ['defectEvery', 'missEvery', 'approveMissEvery', 'poisonEvery', 'slipEvery', 'checkpoint', 'leastPrivilege'];
const nth = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
// The floor's quality and security rules, to give the Experiment Lab the same starting point as the page.
export const floorRules = floor => Object.fromEntries(RULE_KEYS.map(k => [k, floor.rules[k]]));
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
const signed = (v, d = 1) => { const a = fmt(Math.abs(v), d); return `${Number(a) === 0 ? '±' : v > 0 ? '+' : '−'}${a}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One failure at a time. `service` is the District flag the control switches off.
const BREAKS = [
  { id: 'modelApi', label: 'Model API outage' },
  { id: 'reviewer', label: 'Reviewers away' },
  { id: 'power', label: 'Power loss' }, // stops people too, not only the agents
];

export function mountObservability({ getModel, clock, refresh }) {
  let lastOptions = null, labRun = null; // labRun: the model and staffing the last Experiment Lab result was run for
  // ---- break it on purpose ----
  const restoreAll = model => { for (const k of ALL_SERVICES) if (!model[k]) model.setService(k, true); if (!model.floor.rules.checkpoint) model.setRule('checkpoint', true); };
  for (const b of BREAKS) $(`break-${b.id}`).addEventListener('click', () => {
    const model = getModel(), broken = !model[b.id];
    restoreAll(model); // one failure at a time, including any cut from the toolbar
    if (!broken) model.setService(b.id, false);
    refresh();
  });
  $('break-checkpoint').addEventListener('click', () => {
    const model = getModel(), off = model.floor.rules.checkpoint;
    restoreAll(model);
    if (off) model.setRule('checkpoint', false);
    refresh();
  });
  $('break-restore').addEventListener('click', () => { restoreAll(getModel()); refresh(); });
  // ---- quality and security rules ----
  $('rule-defects').textContent = `Defects: every ${nth(QUALITY_ON.defectEvery)} task; review misses every ${nth(QUALITY_ON.missEvery)} one it sees, the approver every ${nth(QUALITY_ON.approveMissEvery)}`;
  $('rule-poison').textContent = `Poisoned requests: every ${nth(SECURITY_ON.poisonEvery)} task; the checkpoint misses every ${nth(SECURITY_ON.slipEvery)} one`;
  $('rule-defects').addEventListener('click', () => { const m = getModel(), on = !m.floor.rules.defectEvery; m.setRule('defectEvery', on ? QUALITY_ON.defectEvery : 0); m.setRule('missEvery', on ? QUALITY_ON.missEvery : 0); m.setRule('approveMissEvery', on ? QUALITY_ON.approveMissEvery : 0); refresh(); });
  $('rule-poison').addEventListener('click', () => { const m = getModel(), on = !m.floor.rules.poisonEvery; m.setRule('poisonEvery', on ? SECURITY_ON.poisonEvery : 0); m.setRule('slipEvery', on ? SECURITY_ON.slipEvery : 0); refresh(); });
  $('rule-checkpoint').addEventListener('click', () => { const m = getModel(); m.setRule('checkpoint', !m.floor.rules.checkpoint); refresh(); });
  $('rule-privilege').addEventListener('click', () => { const m = getModel(); m.setRule('leastPrivilege', !m.floor.rules.leastPrivilege); refresh(); });
  $('rules-tools').innerHTML = `<table><thead><tr><th>Agent</th><th>Tools its role needs</th></tr></thead><tbody>${Object.entries(ROLE_TOOLS).map(([role, tools]) => `<tr><th scope="row">${NAME[role]}</th><td>${tools.map(t => TOOLS[t]).join(', ')}</td></tr>`).join('')}</tbody></table>`;
  // ---- enterprise view ----
  const toggleEnterprise = open => { $('obs-enterprise').hidden = !open; $('enterprise-toggle').setAttribute('aria-expanded', String(open)); $('enterprise-toggle').classList.toggle('on', open); };
  $('enterprise-toggle').addEventListener('click', () => { toggleEnterprise($('obs-enterprise').hidden); refresh(); });
  $('enterprise-path').addEventListener('change', () => refresh());
  if (new URLSearchParams(location.search).has('enterprise')) toggleEnterprise(true);
  // ---- trace ----
  $('trace-task').addEventListener('change', () => renderTrace(getModel(), clock));
  // ---- experiment lab ----
  const lab = $('lab-change');
  for (const [id, c] of Object.entries(CHANGES)) { const o = document.createElement('option'); o.value = id; o.textContent = c.label; lab.append(o); }
  $('lab-run').addEventListener('click', () => { const model = getModel(); renderLab(model, clock); labRun = { model, reviewers: model.floor.reviewers, rules: JSON.stringify(floorRules(model.floor)) }; });

  return function render() {
    const model = getModel(), floor = model.floor, m = floor.metrics();
    renderMetrics(m, clock);
    renderBreak(model);
    renderRules(floor, m);
    if (!$('obs-enterprise').hidden) renderEnterprise(floor, m);
    if (labRun && (labRun.model !== model || labRun.reviewers !== floor.reviewers || labRun.rules !== JSON.stringify(floorRules(floor)))) { labRun = null; $('lab-out').innerHTML = '<p>Staffing or the clock was reset since the last run. Run both again to compare against the floor as it is now.</p>'; }
    // Trace options: refresh only when the task list changes, so an open picker is not rebuilt under the reader.
    const tasks = [...floor.done.slice(-40), ...floor.tasks].sort((a, b) => b.n - a.n);
    const sig = tasks.map(t => `${t.id}${t.finished ?? ''}`).join(',');
    if (sig !== lastOptions) {
      lastOptions = sig; const sel = $('trace-task'), keep = sel.value;
      const opts = [new Option('Latest finished task', '')];
      for (const t of tasks) opts.push(new Option(`${t.id} · ${t.finished !== undefined ? `finished in ${t.finished - t.arrival} min` : `still in ${NAME[t.stage].toLowerCase()}`}`, t.id));
      sel.replaceChildren(...opts); sel.value = tasks.some(t => t.id === keep) ? keep : '';
    }
    renderTrace(model, clock);
  };
}

function renderMetrics(m, clock) {
  const rows = m.stations.map(s => `<tr><th scope="row">${NAME[s.id]}</th><td>${s.queued}</td><td>${s.working} of ${s.capacity}</td><td>${Math.round(s.utilization * 100)}%</td><td>${fmt(s.avgWait)}</td></tr>`).join('');
  $('obs-wip').innerHTML = `<table><thead><tr><th>Stage</th><th>Waiting</th><th>Working</th><th>Busy</th><th>Average wait, min</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('obs-wait-review').textContent = fmt(m.avgReviewWait);
  $('obs-cycle').textContent = fmt(m.avgCycle);
  $('obs-system').textContent = fmt(m.littlesLaw.avgTimeInSystem);
  $('obs-throughput').textContent = fmt(m.throughputPerHour);
  const q = m.quality, s = m.security;
  $('obs-qs').hidden = !(q.defects || s.poisoned);
  $('obs-caught-review').textContent = q.caughtReview; $('obs-caught-approval').textContent = q.caughtApproval; $('obs-escaped').textContent = q.escaped;
  $('obs-unsafe').textContent = s.unsafe; $('obs-quarantined').textContent = s.blocked;
  const L = m.littlesLaw;
  if (!m.time) { $('obs-little').textContent = 'Run the clock to see the check.'; return; }
  const off = Math.round(Math.abs(L.finishedGap) * 100), holds = littlesLawHolds(L.finishedGap);
  $('obs-little').innerHTML = `<p class="law">Counted: on average <b>${fmt(L.observedWip, 2)}</b> tasks were in the system from ${clock(0)} to ${clock(m.time)}.<br>Predicted from finished work only: <b>${fmt(L.finishedPerMinute, 3)}</b> finished per minute × <b>${fmt(m.avgCycle, 1)}</b> minutes each = <b>${fmt(L.finishedPrediction, 2)}</b> tasks. <span class="pill${holds ? '' : ' warn'}">${holds ? `holds, within ${off}%` : `off by ${off}%`}</span></p>`
    + `<p>${holds ? 'When work leaves about as fast as it arrives, two numbers you can measure on finished work predict the pile.' : 'The rule only holds when work leaves about as fast as it arrives. Off by this much means the pile is still growing (or the shift has only just started), so averages of finished work understate how many tasks are waiting.'}</p>`;
}

function renderBreak(model) {
  for (const b of BREAKS) { const btn = $(`break-${b.id}`), down = !model[b.id]; btn.classList.toggle('on', down); btn.setAttribute('aria-pressed', String(down)); }
  const services = { internet: model.internet, power: model.power, modelApi: model.modelApi, reviewer: model.reviewer };
  const stalled = STATIONS.filter(s => s.needs.some(n => services[n] === false)), moving = STATIONS.filter(s => !stalled.includes(s));
  const words = list => list.map(s => s.label.toLowerCase()).join(', ');
  const rules = model.floor.rules, cpOff = !rules.checkpoint;
  const btn = $('break-checkpoint'); btn.classList.toggle('on', cpOff); btn.setAttribute('aria-pressed', String(cpOff));
  const checkpointNote = cpOff ? ` Checkpoint off: a poisoned task's tool action now runs unchecked.${rules.poisonEvery ? '' : ' Switch on poisoned requests below to see it happen.'}` : '';
  $('break-status').textContent = (!stalled.length ? (cpOff ? 'Nothing stalls: work keeps flowing.' : 'Nothing broken. Pick one failure, predict what stops, then press it.')
    : `Stalled: ${words(stalled)}.${moving.length ? ` Still moving: ${words(moving)}, until the work in front of them runs out.` : ''}`) + checkpointNote;
  $('break-status').classList.toggle('warning', stalled.length > 0 || cpOff);
}

function renderRules(floor, m) {
  const r = floor.rules, q = m.quality, s = m.security;
  for (const [id, on] of [['rule-defects', r.defectEvery > 0], ['rule-poison', r.poisonEvery > 0], ['rule-checkpoint', r.checkpoint], ['rule-privilege', r.leastPrivilege]]) {
    $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on));
  }
  $('rule-checkpoint').textContent = `Checkpoint before tool actions: ${r.checkpoint ? 'on' : 'off'}`;
  $('rule-privilege').textContent = `Least privilege: ${r.leastPrivilege ? 'on' : 'off'}`;
  const parts = [];
  if (q.defects) parts.push(`Defects so far: ${q.defects}. Caught at review ${q.caughtReview}, caught at approval ${q.caughtApproval}, missed at approval ${q.missedApproval}, escaped to the customer ${q.escaped}.`);
  if (s.poisoned) parts.push(`Poisoned requests so far: ${s.poisoned}. Stopped at the checkpoint and sent to a person ${s.blocked}, slipped past the checkpoint ${s.slipped}, refused by least privilege ${s.denied}, unsafe tool actions carried out ${s.unsafe}.`);
  $('rules-status').textContent = parts.join(' ') || 'The defect rule and the poisoned-request rule are both off, so there is nothing to catch or stop yet and the floor runs exactly as in lessons 1 to 5. The two protections below (checkpoint, least privilege) are on, ready for when you switch a rule on. Switch one on, predict, then watch the counts.';
  $('rules-status').classList.toggle('warning', q.escaped > 0 || s.unsafe > 0);
  $('rules-tools-note').textContent = r.leastPrivilege ? 'Least privilege on: each agent holds only these tools.'
    : `Least privilege off: every agent shares one account that can also ${TOOLS.exportRecords}.`;
}

let lastMap = '';
function renderEnterprise(floor, m) {
  const showPath = $('enterprise-path').checked, s = m.security, key = `${showPath}|${floor.rules.checkpoint}`;
  if (key !== lastMap || !$('enterprise-map').firstChild) { lastMap = key; $('enterprise-map').innerHTML = enterpriseMapSvg({ highlight: showPath ? 'sendOutside' : null, checkpointOn: floor.rules.checkpoint, theme: 'light', id: 'enterprise-svg' }); }
  const seen = recordedBy('sendOutside').map(x => x.name.toLowerCase()), stop = stoppableBy('sendOutside');
  $('enterprise-status').textContent = `${INJECTED.sendOutside.label[0].toUpperCase()}${INJECTED.sendOutside.label.slice(1)}: recorded by ${seen.length} sensors (${seen.join(', ')}); `
    + `could be stopped at ${stop.map(c => c.name.toLowerCase()).join(' or ')}. In the town, only the ${stop[0].name.toLowerCase()} is built, and it is ${floor.rules.checkpoint ? 'on' : 'off'}. `
    + (s.poisoned ? `So far: ${s.blocked} stopped, ${s.unsafe} unsafe actions carried out.` : 'Switch on poisoned requests to see it work.');
}

const COLORS = { research: '#3e7aa6', plan: '#7b6aa8', execute: '#2f7a5c', review: '#b06a24', approve: '#c2502e', quarantine: '#4a5560' };
// Quality and security moments in a task's log, as marks under the trace bar: [minute, css class, text].
export function traceEvents(task, floor) {
  const out = [];
  for (const e of floor.log) {
    if (e.task !== task.id) continue;
    if (e.type === 'defect' && e.result === 'caught') out.push([e.minute, 'good', `Defect caught at ${e.stage === 'review' ? 'review' : 'approval'}`]);
    if (e.type === 'defect' && e.result === 'missed') out.push([e.minute, 'bad', `${e.stage === 'approve' ? 'Approval' : 'Review'} missed a defect (${e.worker})`]);
    if (e.type === 'defect' && e.result === 'escaped') out.push([e.minute, 'bad', 'Defect escaped']);
    if (e.type === 'tool' && e.result === 'blocked') out.push([e.minute, 'good', 'Blocked at checkpoint']);
    if (e.type === 'tool' && e.result === 'denied') out.push([e.minute, 'good', e.slipped ? 'Slipped past checkpoint, tool refused' : 'Tool refused']);
    if (e.type === 'tool' && e.result === 'carried-out') out.push([e.minute, 'bad', e.slipped ? 'Slipped past checkpoint, unsafe action' : 'Unsafe action']);
  }
  return out;
}
function renderTrace(model, clock) {
  const floor = model.floor, id = $('trace-task').value;
  const task = id ? floor.task(id) : floor.done.at(-1);
  const bar = $('trace-bar'), out = $('trace-summary');
  if (!task) { bar.replaceChildren(); out.textContent = 'No task has finished yet. Run the clock, or pick a task that is still in the system.'; $('trace-axis').textContent = ''; return; }
  const end = task.finished ?? floor.time, life = Math.max(1, end - task.arrival);
  const parts = task.spans.map(s => {
    const left = (s.start - task.arrival) / life * 100, width = (s.end - s.start) / life * 100, mins = s.end - s.start;
    const what = s.state === 'working' ? `${NAME[s.stage]} working (${s.worker})` : describeWait(s);
    const cls = s.state === 'working' ? 'seg-work' : s.cause === 'blocked' ? 'seg-blocked' : 'seg-wait';
    return `<span class="${cls}" style="left:${left}%;width:${width}%;--c:${COLORS[s.stage]}" title="${esc(`${clock(s.start)} to ${clock(s.end)} · ${mins} min · ${what}`)}"></span>`;
  });
  const approval = task.spans.find(s => s.stage === 'approve' && s.state === 'working');
  const mark = (minute, cls, text) => { const x = (minute - task.arrival) / life * 100; return `<span class="mark${cls}${x > 55 ? ' flip' : ''}" style="left:${x}%">${text}</span>`; };
  if (approval) parts.push(mark(approval.start, '', 'Human approval'));
  const rework = floor.log.find(e => e.task === task.id && e.type === 'left' && e.outcome === 'rework');
  if (rework) parts.push(mark(rework.minute, ' rework', 'Sent back'));
  traceEvents(task, floor).forEach(([minute, cls, text], i) => parts.push(mark(minute, ` qs ${cls}${i % 2 ? ' low' : ''}`, text)));
  bar.innerHTML = parts.join('');
  $('trace-axis').innerHTML = `<span>${clock(task.arrival)} arrived</span><span>${task.finished !== undefined ? `${clock(end)} finished` : `${clock(end)} now`}</span>`;
  out.textContent = traceSummary(task, floor);
}

// The sentence under the trace bar. Minutes come from the task's spans, so "so far" and "waiting" always agree,
// including for a task that arrived this minute (0 and 0). (The bar itself uses at least 1 minute to avoid dividing by 0.)
export function traceSummary(task, floor) {
  const life = (task.finished ?? floor.time) - task.arrival;
  const sum = f => task.spans.filter(f).reduce((a, s) => a + s.end - s.start, 0);
  const working = sum(s => s.state === 'working'), waiting = life - working;
  const biggest = Object.entries(task.spans.filter(s => s.state === 'waiting').reduce((acc, s) => { const k = describeWait(s); acc[k] = (acc[k] || 0) + s.end - s.start; return acc; }, {})).sort((a, b) => b[1] - a[1])[0];
  const reviewer = floor.log.filter(e => e.task === task.id && e.type === 'left' && e.stage === 'review').map(e => e.worker).at(-1);
  const approval = task.spans.some(s => s.stage === 'approve' && s.state === 'working');
  const rework = floor.log.some(e => e.task === task.id && e.type === 'left' && e.outcome === 'rework');
  return `${task.id}: ${life} minutes so far${task.finished !== undefined ? ', finished' : ', still in the system'}. Working ${working} min, waiting ${waiting} min${biggest ? ` (largest: ${biggest[0].toLowerCase()}, ${biggest[1]} min)` : ''}.`
    + `${reviewer ? ` Reviewed by ${reviewer}.` : ''}${approval ? ' Needed human approval.' : ''}${rework ? ' Sent back once for rework.' : ''}`
    + traceEvents(task, floor).map(([, , text]) => ` ${text}${text === 'Unsafe action' ? `: ${INJECTED[task.injected]?.label || 'tool misuse'}` : ''}.`).join('');
}

function renderLab(model, clock) {
  const id = $('lab-change').value, r = runExperiment(id, { baseline: { reviewers: model.floor.reviewers, ...floorRules(model.floor) } });
  const quality = r.baseline.quality.defects > 0, security = r.baseline.security.poisoned > 0;
  const rows = [
    ['Finished in the shift', 'finished', 0], [`Still in the system at ${clock(HORIZON)}`, 'stillInSystem', 0], ['Finished per hour', 'finishedPerHour', 1],
    ['Average cycle, finished tasks (min)', 'avgCompletedCycle', 1], ['Average time in system, all tasks (min)', 'avgTimeInSystem', 1],
    ['Average wait at review (min)', 'avgReviewWait', 1], ['Review busy (%)', 'reviewBusy', 0],
    ...(quality ? [['Defects escaped to the customer', 'escaped', 0]] : []), ...(security ? [['Unsafe tool actions carried out', 'unsafe', 0]] : []),
  ].map(([label, k, d]) => { const scale = k === 'reviewBusy' ? 100 : 1; return `<tr><th scope="row">${label}</th><td>${fmt(r.baseline[k] * scale, d)}</td><td>${fmt(r.variant[k] * scale, d)}</td><td>${signed(r.deltas[k] * scale, d)}</td></tr>`; }).join('');
  const waits = s => `<ol>${s.topWaits.map(w => `<li>${esc(describeWait(w))}: ${w.minutes} task-minutes</li>`).join('') || '<li>No waiting at all</li>'}</ol>`;
  const baseRules = { ...floorRules(model.floor), ...(CHANGES[id].both || {}) };
  const extras = [quality && 'defects on', security && `poisoned requests on, checkpoint ${baseRules.checkpoint ? 'on' : 'off'}, least privilege ${baseRules.leastPrivilege ? 'on' : 'off'}`].filter(Boolean);
  $('lab-out').innerHTML = `<p>Baseline: ${model.floor.reviewers} reviewer${model.floor.reviewers > 1 ? 's' : ''}, all services up${extras.length ? `, ${extras.join(', ')}` : ''}. Change: ${esc(r.description)}. Both start empty at ${clock(0)} and run the same ${HORIZON / 60} hours.</p>`
    + `<table><thead><tr><th>Measure</th><th>Baseline</th><th>With change</th><th>Difference</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<p>${quality ? `Defects caught: ${r.baseline.quality.caughtReview} at review and ${r.baseline.quality.caughtApproval} at approval in the baseline; ${r.variant.quality.caughtReview} and ${r.variant.quality.caughtApproval} with the change.` : "With defects off, the model counts what review and approval cost, not the mistakes they catch. Switch defects on to see both."}</p><div class="lab-waits"><div><h4>Top waits, baseline</h4>${waits(r.baseline)}</div><div><h4>Top waits, with change</h4>${waits(r.variant)}</div></div>`;
}
