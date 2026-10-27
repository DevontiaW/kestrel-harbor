// Enterprise view: the town's pieces mapped onto a generic, vendor-neutral enterprise deployment, with the places to watch
// (sensors) and the places to decide and stop (checkpoints). Deterministic: a scripted incident is recorded by a sensor
// if and only if the sensor sits on the incident's path, and can be stopped only by a checkpoint on that path.
// The same code draws the diagram for the page, lesson 7 and the docs, so the labels are identical everywhere.

// Each piece: the enterprise name, what it is in plain words, and the town piece it stands for.
// x, y, w, h place it on a 340-wide drawing that stays readable on a 375-pixel phone screen. Labels wrap to fit.
const H = 58;
export const NODES = Object.freeze([
  { id: 'provider', name: 'Model service', town: 'the remote model API', x: 10, y: 24, w: 155, h: H },
  { id: 'outside', name: 'Outside address', town: 'anywhere beyond the harbor', x: 175, y: 24, w: 155, h: H },
  { id: 'egress', name: 'Network edge (egress gate)', town: 'the internet uplink at the exchange', x: 10, y: 108, w: 320, h: H },
  { id: 'gateway', name: 'Model gateway', town: 'the model API link', x: 10, y: 192, w: 155, h: H },
  { id: 'idp', name: 'Identity provider', town: 'the ops office: who may do what', x: 175, y: 192, w: 155, h: H },
  { id: 'agents', name: 'Agents', town: 'research, planning, execution', x: 14, y: 290, w: 140, h: H },
  { id: 'tools', name: 'Tools', town: 'local tools and files', x: 190, y: 290, w: 136, h: H },
  { id: 'people', name: 'People: review, approval', town: 'the review desk and shift lead', x: 10, y: 384, w: 320, h: H },
  { id: 'collector', name: 'Log collector', town: 'the event log', x: 10, y: 468, w: 155, h: H },
  { id: 'siem', name: 'SIEM', town: 'none; links records, raises alerts', x: 175, y: 468, w: 155, h: H },
]);
// The agent segment: a separate network lane for the agents and their tools (the fiber lane to the agent floor).
export const SEGMENT = Object.freeze({ name: 'Agent network segment', town: 'fiber lane to the agent floor', x: 4, y: 266, w: 332, h: 102 });
const HEIGHT = 580;

// Places to watch: each sensor records what passes the piece it sits on, and sends its records to the collector.
export const SENSORS = Object.freeze([
  { id: 'trace', at: 'agents', name: 'Agent traces', what: 'every step of every task (the town\'s event log)' },
  { id: 'toolLog', at: 'tools', name: 'Tool-call log', what: 'every tool action an agent tries' },
  { id: 'promptLog', at: 'gateway', name: 'Prompt and response log', what: 'every model call' },
  { id: 'flowLog', at: 'egress', name: 'Connection log', what: 'every connection leaving the network' },
  { id: 'approvalLog', at: 'people', name: 'Approval log', what: 'who approved what, and when' },
  { id: 'signInLog', at: 'idp', name: 'Sign-in log', what: 'which person or agent got which access' },
]);
// Places to decide and stop: policy enforcement points. The identity provider is the policy decision point they ask.
export const CHECKPOINTS = Object.freeze([
  { id: 'toolCheckpoint', at: 'tools', name: 'Tool checkpoint', what: 'checks each tool action before it runs (built in the town)', built: true },
  { id: 'gatewayPolicy', at: 'gateway', name: 'Gateway policy', what: 'which agent may call which model, with what data', built: false },
  { id: 'egressGate', at: 'egress', name: 'Egress gate', what: 'which outside addresses may be reached', built: false },
]);

// The work flows (solid) and the record flows (dotted). Each edge is a straight vertical or horizontal line.
const EDGES = [
  { from: 'agents', to: 'gateway', d: 'M84 290V252' }, { from: 'gateway', to: 'egress', d: 'M84 192V168' }, { from: 'egress', to: 'provider', d: 'M84 108V84' },
  { from: 'agents', to: 'tools', d: 'M154 319H188' }, { from: 'tools', to: 'egress', d: 'M208 290V276H170V168' }, { from: 'egress', to: 'outside', d: 'M252 108V84' },
  { from: 'agents', to: 'people', d: 'M84 348V382' },
];
const RECORDS = ['M84 442V468', 'M165 497H175'];

// Scripted incidents. A path lists the pieces the action crosses, in order.
export const INCIDENTS = Object.freeze({
  sendOutside: { button: 'Send a customer file to an outside address', label: 'A poisoned task tells the execution agent to send a customer file to an outside address', path: ['agents', 'tools', 'egress', 'outside'] },
  modelLeak: { button: 'Paste a customer file into a model call', label: 'An agent pastes a customer file into a model call', path: ['agents', 'gateway', 'egress', 'provider'] },
});
export const recordedBy = id => SENSORS.filter(s => INCIDENTS[id].path.includes(s.at));
export const stoppableBy = id => CHECKPOINTS.filter(c => INCIDENTS[id].path.includes(c.at))
  .sort((a, b) => INCIDENTS[id].path.indexOf(a.at) - INCIDENTS[id].path.indexOf(b.at)); // earliest on the path first

// Split text into lines of at most `max` characters, breaking at spaces.
const wrap = (text, max) => text.split(' ').reduce((lines, w) => {
  const last = lines.at(-1);
  if (last && (last + ' ' + w).length <= max) lines[lines.length - 1] = `${last} ${w}`; else lines.push(w);
  return lines;
}, []);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Colors: light by default, dark when the reader's device asks for it (theme 'auto'); theme 'light' for a page that has
// no dark mode. Class names carry a "km" prefix so the style block cannot reach anything else on the page.
const style = theme => `<style>${LIGHT}${theme === 'auto' ? DARK : ''}</style>`;
const LIGHT = `.km-bg{fill:#fff}.km-box{fill:#f6f8f4;stroke:#8d9a8e;stroke-width:1.2}.km-t{fill:#202723;font:600 13px system-ui,-apple-system,'Segoe UI',sans-serif}.km-s{fill:#5d6b62;font:11.5px system-ui,-apple-system,'Segoe UI',sans-serif}.km-seg{fill:none;stroke:#3e7aa6;stroke-width:1.2;stroke-dasharray:5 4}.km-segt{fill:#3e7aa6;font:600 11px system-ui,-apple-system,'Segoe UI',sans-serif}.km-work{stroke:#202723;stroke-width:1.6;fill:none}.km-rec{stroke:#5d6b62;stroke-width:1.4;stroke-dasharray:2 3;fill:none}.km-sen{fill:#3e7aa6}.km-chk{fill:#c2502e}.km-off{fill:#9aa39c}.km-mk{fill:#fff;font:700 11px system-ui,sans-serif;text-anchor:middle}.km-hot .km-box{stroke:#c2502e;stroke-width:2.4}.km-path{stroke:#c2502e;stroke-width:3.2}.km-ah{fill:#202723}.km-ahp{fill:#c2502e}`;
const DARK = `@media (prefers-color-scheme:dark){.km-bg{fill:#1b211e}.km-box{fill:#242c28;stroke:#7d8a80}.km-t{fill:#eef2ec}.km-s{fill:#b3beb5}.km-work{stroke:#e4e9e2}.km-ah{fill:#e4e9e2}.km-rec{stroke:#b3beb5}.km-seg{stroke:#7fb2d8}.km-segt{fill:#7fb2d8}.km-sen{fill:#5d9ccc}.km-chk{fill:#e0714c}.km-hot .km-box{stroke:#e0714c}.km-path{stroke:#e0714c}.km-ahp{fill:#e0714c}}`;
const marker = (x, y, kind, on = true) => kind === 'S'
  ? `<g><circle class="km-sen" cx="${x}" cy="${y}" r="9"/><text class="km-mk" x="${x}" y="${y + 4}">S</text></g>`
  : `<g><path class="${on ? 'km-chk' : 'km-off'}" d="M${x} ${y - 10}L${x + 10} ${y}L${x} ${y + 10}L${x - 10} ${y}Z"/><text class="km-mk" x="${x}" y="${y + 4}">C</text></g>`;

// The enterprise map as inline SVG. highlight: an incident id to draw its path in red. checkpointOn: whether the
// town's tool checkpoint is switched on (drawn grey when off).
export function enterpriseMapSvg({ highlight = null, checkpointOn = true, id = 'enterprise-map', theme = 'auto' } = {}) {
  const path = highlight ? INCIDENTS[highlight].path : [];
  const onPath = e => path.includes(e.from) && path.includes(e.to) && Math.abs(path.indexOf(e.from) - path.indexOf(e.to)) === 1;
  const boxes = NODES.map(n => {
    const s = SENSORS.some(x => x.at === n.id), c = CHECKPOINTS.find(x => x.at === n.id);
    const marks = [s && marker(n.x + n.w - 12, n.y, 'S'), c && marker(n.x + n.w - (s ? 36 : 12), n.y, 'C', !c.built || checkpointOn)].filter(Boolean).join('');
    return `<g class="${path.includes(n.id) ? 'km-hot' : ''}"><rect class="km-box" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6"/>`
      + `<text class="km-t" x="${n.x + 8}" y="${n.y + 21}">${esc(n.name)}</text>`
      + wrap(`Town: ${n.town}`, Math.floor((n.w - 14) / 6.2)).map((l, i) => `<text class="km-s" x="${n.x + 8}" y="${n.y + 38 + i * 14}">${esc(l)}</text>`).join('') + `${marks}</g>`;
  }).join('');
  const lines = EDGES.map(e => `<path class="km-work${onPath(e) ? ' km-path' : ''}" d="${e.d}" marker-end="url(#${id}-${onPath(e) ? "hot" : "arrow"})"/>`).join('')
    + RECORDS.map(d => `<path class="km-rec" d="${d}"/>`).join('');
  const legendY = 556;
  const legend = `${marker(18, legendY, 'S')}<text class="km-s" x="32" y="${legendY + 4}">Sensor: watch here</text>${marker(170, legendY, 'C', checkpointOn)}<text class="km-s" x="184" y="${legendY + 4}">${checkpointOn ? 'Checkpoint: decide and stop' : 'Grey: checkpoint switched off'}</text>`;
  const title = 'Enterprise map: where the town\'s pieces sit in a company network, with sensors (S) and checkpoints (C)';
  const desc = `${NODES.map(n => `${n.name} (town: ${n.town})`).join('; ')}. Sensors on: ${SENSORS.map(s => s.name).join(', ')}. Checkpoints: ${CHECKPOINTS.map(c => c.name).join(', ')}.${highlight ? ` Highlighted: ${INCIDENTS[highlight].label}.` : ''}`;
  return `<svg class="km" id="${id}" viewBox="0 0 340 ${HEIGHT}" role="img" aria-labelledby="${id}-t ${id}-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-width:520px;display:block">`
    + `<title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${style(theme)}`
    + `<defs><marker id="${id}-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path class="km-ah" d="M0 0L8 4L0 8Z"/></marker>`
    + `<marker id="${id}-hot" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path class="km-ahp" d="M0 0L8 4L0 8Z"/></marker></defs>`
    + `<rect class="km-bg" width="340" height="${HEIGHT}" rx="8"/><text class="km-segt" x="10" y="15">OUTSIDE YOUR NETWORK</text>`
    + `<rect class="km-seg" x="${SEGMENT.x}" y="${SEGMENT.y}" width="${SEGMENT.w}" height="${SEGMENT.h}" rx="8"/><text class="km-segt" x="${SEGMENT.x + SEGMENT.w - 8}" y="${SEGMENT.y + SEGMENT.h - 6}" text-anchor="end">${esc(SEGMENT.name.toUpperCase())}</text>`
    + lines + boxes + legend + '</svg>';
}

// "How the town works inside": engine, event log, metrics and trace, screen. Same colors and dark mode as the map.
export const INSIDE = Object.freeze([
  { name: 'Simulation engine', town: 'a clock ticks once a minute; tasks move between stations' },
  { name: 'Event log', town: 'every minute of every task: working or waiting, and why' },
  { name: 'Metrics and trace', town: 'counted from the log, never typed in' },
  { name: 'Screen', town: 'the town, the panels and the lessons' },
]);
export function townInsideSvg({ id = 'town-inside', theme = 'auto' } = {}) {
  const h = 62, gap = 30, top = 10, total = top * 2 + INSIDE.length * h + (INSIDE.length - 1) * gap;
  const parts = INSIDE.map((b, i) => {
    const y = top + i * (h + gap);
    return `<rect class="km-box" x="10" y="${y}" width="320" height="${h}" rx="6"/><text class="km-t" x="22" y="${y + 25}">${i + 1}. ${esc(b.name)}</text><text class="km-s" x="22" y="${y + 45}">${esc(b.town)}</text>`
      + (i < INSIDE.length - 1 ? `<path class="km-work" d="M170 ${y + h}V${y + h + gap - 2}" marker-end="url(#${id}-arrow)"/>` : '');
  }).join('');
  return `<svg class="km" id="${id}" viewBox="0 0 340 ${total}" role="img" aria-labelledby="${id}-t" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-width:520px;display:block">`
    + `<title id="${id}-t">${esc(`How the town works inside: ${INSIDE.map(b => b.name).join(', then ')}`)}</title>${style(theme)}`
    + `<defs><marker id="${id}-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path class="km-ah" d="M0 0L8 4L0 8Z"/></marker></defs>`
    + `<rect class="km-bg" width="340" height="${total}" rx="8"/>${parts}</svg>`;
}
