import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { District, PARAMETERS as P, shiftInfo } from './district-model.mjs';
import { STATIONS, FLOOR } from './agent-floor.mjs';
import { STAGES, COOP, FISH } from './plant-line.mjs';
import { VEHICLES, MANIFESTS, ADMIN_REQUESTS, PLATES, SUPPLIER } from './mock-data.mjs';
import { SITES as S, H, V, DEPTS, BAYS, AGENT_X, laneH, blockLoop, outerLoop } from './layout.js';
import { dressWorld, rng } from './world-dress.js';
import { buildNetworks } from './networks.js';
import { startTour } from './tour.js';
import { mountObservability } from './observability-ui.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const STAGE = params.has('stage') || params.has('tour'), CAPTURE = params.has('capture');
if (STAGE) document.body.classList.add('stage');
const host = $('world');
const ZONE = { farm: 0x8fb07a, coop: 0xc9b36a, plant: 0x6f97bd, clinic: 0xd27f7f, agents: 0x9483c9, ops: 0x5fa79d, utilities: 0xd29a4a, town: 0xb9b3a6, harbor: 0x4f8fa8 };
const tint = (c, k = .78) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k).getHex();
// v3 palette: the town stays cool and blueprint-like; people share one warm terracotta family; amber is reserved for
// tasks waiting on review; slate grey marks anything held by an outage.
const WARM = { reviewer: 0xc8643c, staff: [0xc8643c, 0xb5573a, 0xd27c58, 0xa9533a], street: [0xbf8d78, 0xad8473, 0xc99f8b, 0xb27a66] }, QUEUE = 0xe3a224, OFF = 0x6b7178;
const PORT = { quay: 0xc9b99c, bollard: 0x556e73 };
const C = { white: 0xfbfcf9, wall: 0xeaefe8, edge: 0x8d9a8e, ink: 0x2b302d, green: 0x2f7a5c, crop: 0xcfdcc0, blue: 0x3e7aa6, amber: 0xc0782f, violet: 0x7b6aa8, water: 0x4f9a93, red: 0xc2502e, grain: 0xd9c98f };
let model = new District(), running = CAPTURE ? false : !matchMedia('(prefers-reduced-motion: reduce)').matches;
let spin = null, selected = null, hovered = null, following = false, xray = null, traceSelection = null, pointer = { x: 0, y: 0 }, renderer, scene, camera, controls, flight = null, nets, animT = 0;
const xrayRings = [], roots = [], vehicleMeshes = {}, materials = new Map(), callouts = [], figures = {};
let sailBoats, pedParts = [], walkers = [], reviewer3, trawlers = [], fishBoxes = [], cones = [], focusRing, routeLine, tokenGroup, peds, traffic = [], boats = [], stationAgents = {}, reviewer2, tankMark, plantPools = [], storeBikes = [], bagStack = [], rackBikes = [], dockCrates = [], paintBooth2, assembly2;
const outline = new THREE.LineBasicMaterial({ color: 0x7f8d81 }), outlineDark = new THREE.LineBasicMaterial({ color: 0x1f2421 });
function mat(color) { if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color })); return materials.get(color); }
function solid(parent, geo, x, y, z, color, edged = true) { const m = new THREE.Mesh(geo, mat(color)); m.position.set(x, y, z); if (edged) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), outline)); parent.add(m); return m; }
const box = (p, x, y, z, w, h, d, color = C.white, edged = true) => solid(p, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, color, edged);
const cyl = (p, x, y, z, r, h, color = C.white, sides = 12) => solid(p, new THREE.CylinderGeometry(r, r, h, sides), x, y + h / 2, z, color);
function line(p, points, color = C.edge, opacity = .65, dash = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(v => new THREE.Vector3(...v)));
  const material = dash ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: .7, gapSize: .5 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new THREE.Line(geometry, material); if (dash) l.computeLineDistances(); p.add(l); return l;
}
function group(id, x = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, 0, z); g.userData.id = id; scene.add(g); roots.push(g); return g; }
function textPlane(text, { size = 52, color = '#6b7b6c', bg = null, width = 12 } = {}) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 1024, 128); }
  ctx.font = `600 ${size}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(text, 512, 64 + size * .36);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8), new THREE.MeshBasicMaterial({ map: tex, transparent: !bg, depthWrite: false, side: THREE.DoubleSide }));
}
function groundText(text, x, z, width = 12) { const m = textPlane(text, { width }); m.rotation.x = -Math.PI / 2; m.position.set(x, .12, z); scene.add(m); }
function sign(parent, text, x, y, z, width, ry = 0, bg = '#ffffff', color = '#202723') { const m = textPlane(text, { width, bg, color, size: 60 }); m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m; }
// Cutaway building: solid north and west walls; glazed columns on the camera-facing south and east sides.
function building(id, x, z, w, d, h = 4, zone = null) {
  const g = group(id, x, z), wall = zone ? tint(ZONE[zone], .84) : C.white; box(g, 0, 0, 0, w, .22, d, C.wall);
  box(g, 0, .22, -d / 2, w, h, .22, wall); box(g, -w / 2, .22, 0, .22, h, d, wall); box(g, w / 2, .22, 0, .22, h * .35, d, C.wall);
  for (let a = -w / 2 + .5; a < w / 2; a += 3) box(g, a, .22, d / 2, .18, h, .18, C.edge);
  for (let a = -d / 2 + .5; a < d / 2; a += 3) box(g, w / 2, .22, a, .18, h, .18, C.edge);
  for (let a = -w / 2 + 1.5; a < w / 2; a += 3) box(g, a, 1.6, -d / 2 + .13, 1.8, 1.25, .04, 0xdce7df);
  box(g, 0, h + .22, d / 2, w, .22, .22); box(g, w / 2, h + .22, 0, .22, .22, d);
  return g;
}
function zonePad(x, z, w, d, zone) { box(scene, x, .015, z, w, .02, d, tint(ZONE[zone]), false); line(scene, [[x - w / 2, .05, z - d / 2], [x + w / 2, .05, z - d / 2], [x + w / 2, .05, z + d / 2], [x - w / 2, .05, z + d / 2], [x - w / 2, .05, z - d / 2]], ZONE[zone], .8); }
function band(g, w, d, h, zone) { box(g, 0, h + .44, d / 2, w, .16, .26, ZONE[zone], false); box(g, w / 2, h + .44, 0, .26, .16, d, ZONE[zone], false); }
const SKIN = [0x8d5a3b, 0xe2b48c, 0x6b4128, 0xc68b5e, 0xf0cfae], HAIR = [0x2b2018, 0x1c1c1c, 0x5a3a22, 0x8a6a3a], PANTS = [0x3a4450, 0x2e3b55, 0x4a5560, 0x434b52];
const SHIRTS = WARM.street, CARS = [0x9fb0bf, 0x6f8294, 0xdfe6ec, 0x4d5d6c, 0xb7c4cf, 0x8a9aa8, 0xf3f5f6];
let personCount = 0;
// A person: two legs that swing from the hip, a shirt (also the status colour at workstations), arms, head and hair.
function person(parent, x, z, shirt = WARM.staff[0], k = personCount++) {
  const a = new THREE.Group(); a.position.set(x, 0, z); parent.add(a);
  const legs = [-.14, .14].map(dx => { const l = new THREE.Group(); l.position.set(dx, .85, 0); a.add(l); box(l, 0, -.85, 0, .2, .85, .24, PANTS[k % PANTS.length], false); return l; });
  const upper = new THREE.Group(); upper.position.y = .85; a.add(upper); // pivots at the hip, so a lean bends the body, not the legs
  const body = box(upper, 0, 0, 0, .6, .74, .36, shirt);
  const arms = [-.38, .38].map(dx => { const g = new THREE.Group(); g.position.set(dx, .7, 0); upper.add(g); box(g, 0, -.6, 0, .15, .6, .17, shirt, false); return g; });
  solid(upper, new THREE.SphereGeometry(.26, 12, 10), 0, 1.02, 0, SKIN[k % SKIN.length], false);
  solid(upper, new THREE.SphereGeometry(.275, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.3), 0, 1.07, -.03, HAIR[k % HAIR.length], false);
  a.userData = { body, legs, upper, arms }; return a;
}
const figure = (parent, x, z, color) => person(parent, x, z, color);
// An AI agent: a boxy workstation robot with a visor that lights while it works.
function robot(parent, x, z, color) {
  const a = new THREE.Group(); a.position.set(x, 0, z); parent.add(a);
  box(a, 0, 0, 0, .46, .8, .4, 0x7d8893, false); const body = box(a, 0, .8, 0, .66, .78, .44, 0x9fb1c2);
  box(a, 0, 1.6, 0, .56, .46, .46, 0xdfe4e6); const visor = box(a, 0, 1.72, .22, .44, .14, .04, 0x59606a, false);
  cyl(a, 0, 2.06, 0, .03, .32, C.ink, 6);
  a.userData = { body, visor, legs: [] }; return a;
}
function desk(g, x, z, color = C.green, kind = 'person') {
  box(g, x, .7, z, 2.6, .2, 1.25); box(g, x - 1, 0, z, .15, .7, 1); box(g, x + 1, 0, z, .15, .7, 1);
  if (kind === 'reviewer') { // paper review: a stack of sheets, one open sheet, a warm lamp pool; the reviewer faces out
    for (let k = 0; k < 3; k++) box(g, x + .75, .9 + k * .07, z - .1, .62, .06, .8, 0xf7f4ee, false);
    const sheet = box(g, x - .1, .9, z - .3, .8, .03, .62, 0xffffff); sheet.rotation.y = .2; box(sheet, .12, .02, 0, .5, .01, .05, 0x9aa3a8, false); box(sheet, .12, .02, .15, .5, .01, .05, 0x9aa3a8, false);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), new THREE.MeshBasicMaterial({ color: 0xf6c9a3, transparent: true, opacity: .75, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.set(x, .25, z - .3); g.add(glow);
    const p = person(g, x, z - 1.05, WARM.reviewer); p.scale.setScalar(1.35); p.userData.glow = glow; p.userData.sheet = sheet; return p; }
  box(g, x, 1.1, z - .2, 1, .75, .1, C.ink); const screen = box(g, x, 1.18, z - .13, .8, .5, .03, color, false);
  const f = (kind === 'robot' ? robot : person)(g, x, z + 1.05, kind === 'robot' ? 0x9fb1c2 : WARM.staff[1]);
  if (kind === 'robot' || kind === 'operator') f.rotation.y = Math.PI; // working at the screen
  f.userData.screen = screen; return f;
}
// A person who walks a short route inside a building while the model says that work is happening.
function walker(parent, pts, { shirt = WARM.staff[walkers.length % WARM.staff.length], period = 8, phase = 0, active = () => true, carry = null } = {}) {
  const p = person(parent, pts[0][0], pts[0][1], shirt), c = carry ? box(p, 0, 1.0, .42, .5, .34, .42, carry) : null; if (c) c.visible = false;
  walkers.push({ p, pts, period, phase, active, c }); return p;
}
function vehicle(id, type, color = C.white) {
  const g = group(id); const truck = type === 'truck', tractor = type === 'tractor', combine = type === 'combine', van = type === 'van', grain = type === 'grain', amb = type === 'ambulance';
  const len = truck ? 5.4 : combine ? 4.4 : tractor ? 3.5 : van || grain ? 4.6 : amb ? 3.8 : 2.8, wide = combine ? 2.4 : truck || grain ? 2.1 : van || amb ? 1.8 : 1.5;
  box(g, 0, .35, 0, wide, .5, len, color);
  if (truck) { box(g, 0, .85, .9, wide, 2.1, 3.5, C.white); box(g, 0, .85, -1.9, wide, 1.35, 1.2, C.ink); box(g, 0, 1.35, -2.53, wide * .8, .6, .04, 0xcbdad5); }
  else if (grain) { box(g, 0, .85, -1.6, wide, 1.3, 1.2, C.ink); box(g, 0, .85, .7, wide, 1.1, 3, C.grain); }
  else if (tractor || combine) { box(g, 0, .85, 0, wide * .7, 1.3, 1.35, C.white); box(g, 0, 1.1, -.7, wide * .6, .8, .04, 0xcbdad5); box(g, 0, .8, -1.25, wide * .85, .5, 1, color); box(g, 0, 2.2, 0, wide * .85, .14, 1.5, C.ink); if (combine) box(g, 0, .25, -2.8, 4.8, .6, .9, C.crop); else { box(g, 0, .2, 2.8, 4.1, .22, 1.5, C.wall); for (let x = -1.7; x <= 1.7; x += .65) box(g, x, .08, 3, .13, .3, 1.3, C.edge); } }
  else if (van || amb) { box(g, 0, .85, 0, wide * .95, 1.6, len * .92, C.white); if (amb) { box(g, wide * .48, 1.3, 0, .03, .25, len * .9, C.red, false); box(g, 0, 2.45, -.6, .9, .2, .4, C.red, false); } else for (let z = -1.5; z <= 1.5; z += 1) box(g, wide * .48, 1.5, z, .03, .5, .7, 0xcbdad5, false); }
  else { box(g, 0, .85, .05, wide * .9, .7, 1.4, color); box(g, 0, 1, -.72, wide * .8, .42, .06, 0xcbdad5); }
  for (const x of [-wide / 2, wide / 2]) for (const z of [-len * .32, len * .32]) { const r = (tractor && z > 0) || combine ? .55 : .34; const wheel = solid(g, new THREE.CylinderGeometry(r, r, .22, 12), x, .4, z, C.ink, false); wheel.rotation.z = Math.PI / 2; }
  if (tractor || combine || van || grain) cyl(g, 0, 2.4, 0, .1, .22, C.blue, 8);
  vehicleMeshes[id] = g; return g;
}

// ---------- Routes ----------
function polyLen(points) { let t = 0; for (let i = 1; i < points.length; i++) t += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); return t; }
function pathPoint(points, fraction) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0); let t = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < lengths.length; i++) { if (t <= lengths[i] || i === lengths.length - 1) { const a = points[i], b = points[i + 1], k = lengths[i] ? t / lengths[i] : 0; return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, angle: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) }; } t -= lengths[i]; }
}
function place(id, x, z, angle) { const g = vehicleMeshes[id]; g.position.set(x, .08, z); g.rotation.y = angle; }
function move(id, points, t) { const p = pathPoint(points, t); place(id, p.x, p.z, p.angle); }
const fieldPath = [[-45, -29], [-17, -29], [-17, -25], [-45, -25], [-45, -21], [-17, -21], [-17, -17], [-45, -17], [-45, -13], [-17, -13], [-17, -9], [-45, -9], [-45, -29]];
const shuttleRoute = outerLoop(V.west, V.east, H.market, H.harbor);
const SHUTTLE_STOPS = [['Clinic', S.clinicDoor.x, H.harbor], ['Plant Gate', S.plantGate.x - 3, H.harbor], ['Ops & Agents', V.east - 4, H.harbor], ['Market St', 4, H.market], ['Mill Rd', V.mill + 6, H.market]].map(([name, x, z]) => {
  let best = 0, bd = Infinity; for (let k = 0; k <= 2000; k++) { const p = pathPoint(shuttleRoute, k / 2000); const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = k / 2000; } } return { name, at: best };
}).sort((a, b) => a.at - b.at);
const SHUTTLE_LAP = 150, DWELL = 4; // minutes per lap, minutes dwelling at each stop
function shuttleState(t) {
  const n = SHUTTLE_STOPS.length, lap = ((t % SHUTTLE_LAP) + SHUTTLE_LAP) % SHUTTLE_LAP, leg = SHUTTLE_LAP / n, i = Math.floor(lap / leg), into = lap - i * leg;
  const s = SHUTTLE_STOPS[i], next = SHUTTLE_STOPS[(i + 1) % n], to = next.at <= s.at ? next.at + 1 : next.at;
  if (into < DWELL) return { frac: s.at, atStop: s.name, next: next.name, speed: 0, stopIndex: i };
  const k = (into - DWELL) / (leg - DWELL), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  return { frac: (s.at + (to - s.at) * e) % 1, atStop: null, next: next.name, speed: Math.round(42 * Math.sin(Math.PI * k)), stopIndex: i };
}
// Supplier trucks arrive west-bound on Harbor St, stop at their bay, swing round and reverse in; they leave east-bound.
const LANE_IN = laneH(H.harbor, -1), BAY_Z = S.plant.z + S.plant.d / 2 + 2.6;
const HOLD_X = S.agents.x + 9.2; // where an inbound truck waits while the review spill closes Harbor St (east of the spill)
const truckIn = i => [[74, LANE_IN], [HOLD_X, LANE_IN], [BAYS[i], LANE_IN]];
const inboundFrac = (i, k) => { const h = 2 / P.transit, a = (74 - HOLD_X) / (74 - BAYS[i]); return k <= h ? k / h * a : a + (k - h) / (.72 - h) * (1 - a); };
const truckOut = i => [[BAYS[i], BAY_Z], [BAYS[i], laneH(H.harbor, 1)], [74, laneH(H.harbor, 1)]];
const grainRoute = [[S.field.x + S.field.w / 2 + 1, -16], [V.mill, -16], [S.coop.x - 6.5, -16]];

// ---------- Scene ----------
const STATION_X = AGENT_X;
function makeScene() {
  scene = new THREE.Scene(); scene.background = new THREE.Color(0xf2f4ef);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe5da, 2.1)); const sun = new THREE.DirectionalLight(0xfff8ea, .9); sun.position.set(-30, 70, 20); scene.add(sun);
  box(scene, 0, -.75, 0, 144, .7, 93, 0xe7ece3).position.z = .5;
  for (let x = -72; x <= 72; x += 4) line(scene, [[x, .01, -46], [x, .01, 47]], 0xc5d0c1, .14);
  for (let z = -46; z <= 46; z += 4) line(scene, [[-72, .01, z], [72, .01, z]], 0xc5d0c1, .14);
  // Street grid: two-lane roads with curbs, centre dashes and zebra crossings at intersections.
  const road = (x0, z0, x1, z1) => { const horiz = z0 === z1; box(scene, (x0 + x1) / 2, 0, (z0 + z1) / 2, horiz ? x1 - x0 : 6, .03, horiz ? 6 : z1 - z0, 0xdfe5dc, false);
    line(scene, [[x0, .06, z0], [x1, .06, z1]], 0xffffff, .95, true); for (const s of [-3, 3]) line(scene, horiz ? [[x0, .05, z0 + s], [x1, .05, z1 + s]] : [[x0 + s, .05, z0], [x1 + s, .05, z1]], C.edge, .5); };
  for (const z of [H.farm, H.market, H.harbor, H.coast]) road(-72, z, 72, z);
  for (const x of Object.values(V)) road(x, H.farm, x, x === V.east ? H.harbor : H.coast);
  for (const x of Object.values(V)) for (const z of [H.market, H.harbor]) for (let k = -2; k <= 2; k++) { box(scene, x + 4.2, .06, z + k * 1.1, 1.4, .02, .5, C.white, false); box(scene, x + k * 1.1, .06, z + 4.2, .5, .02, 1.4, C.white, false); }

  // 01 Farm: field rows, depot and silos, RTK base station.
  const field = group('field'); box(field, S.field.x, .04, S.field.z, S.field.w, .05, S.field.d, 0xe3ead7);
  for (let z = S.field.z - 10; z <= S.field.z + 10; z += 1) { line(field, [[S.field.x - 15, .16, z], [S.field.x + 15, .16, z]], C.crop, .9); for (let x = S.field.x - 14; x <= S.field.x + 14; x += 3.5) box(field, x, .17, z, .07, .28, .9, C.crop, false); }
  const barn = building('barn', S.barn.x, S.barn.z, 12, 4.5, 3, 'farm'); for (let i = 0; i < 2; i++) cyl(barn, 8.5 + i * 2.7, 0, 0, 1.1, 4.2);
  const rtk = group('rtk', S.rtk.x, S.rtk.z); box(rtk, 0, 0, 0, 1.6, .3, 1.6, C.wall); cyl(rtk, 0, .3, 0, .08, 3.2, C.edge, 6); solid(rtk, new THREE.SphereGeometry(.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 3.5, 0, C.white);
  groundText('01 / AUTONOMOUS FIELD', S.field.x, S.field.z + 13.5, 20);
  // 02 Grain co-op: elevator, headhouse, leg, dump pit, scale, mill with bag stack.
  zonePad(S.coop.x + 4, S.coop.z + 1, 27, 19, 'coop');
  const coop = group('coop', S.coop.x, S.coop.z);
  for (let i = 0; i < 4; i++) { cyl(coop, 2 + i * 4.3, 0, -5, 2, 10, C.white, 18); solid(coop, new THREE.ConeGeometry(2.05, 1.1, 18), 2 + i * 4.3, 10.55, -5, C.wall); }
  box(coop, -2.3, 0, -5, 2.4, 15, 2.4, C.white); line(coop, [[-6.5, .3, 4], [-2.3, 14.6, -4.6]], C.ink, .8); line(coop, [[-2.3, 14, -5], [15, 11.2, -5]], C.ink, .6);
  box(coop, -6.5, 0, 4, 3.4, .12, 4.2, C.ink, false); for (let k = -1.4; k <= 1.4; k += .7) box(coop, -6.5 + k, .13, 4, .08, .02, 4, C.white, false);
  box(coop, -6.5, 0, -1.5, 3, .25, 5.5, C.wall);
  const mill = new THREE.Group(); mill.position.set(6, 0, 4.5); coop.add(mill);
  box(mill, 0, 0, 0, 12, .2, 6, C.wall); box(mill, 0, .2, -3, 12, 5, .2); box(mill, -6, .2, 0, .2, 5, 6); for (let a = -5.5; a < 6; a += 3) box(mill, a, .2, 3, .18, 5, .18, C.edge);
  cyl(mill, -2.5, .2, -.5, 1.2, 3, C.white, 14); cyl(mill, -2.5, 3.2, -.5, .5, 1.2, C.ink, 10); figures.miller = figure(mill, 0, 0, C.green);
  for (let i = 0; i < 12; i++) bagStack.push(box(mill, 2.5 + (i % 4) * .9, .2 + Math.floor(i / 4) * .55, 1, .8, .5, .6, C.grain));
  sign(coop, 'KESTREL GRAIN CO-OP', 6, 5.5, 7.62, 6.5);
  groundText('02 / GRAIN CO-OP', S.coop.x + 2, S.coop.z + 12, 14);
  // Utilities and telecom.
  zonePad(S.substation.x + 1, S.substation.z + 11, 15, 35, 'utilities');
  const sub = group('substation', S.substation.x, S.substation.z); box(sub, 0, 0, 0, 12, .2, 10, C.wall);
  for (const x of [-3, 3]) { box(sub, x, .2, 0, 3, 2.5, 4, C.white); for (let z = -1.5; z <= 1.5; z++) cyl(sub, x, 2.7, z, .25, .75, C.ink, 8); }
  for (const x of [-5, 5]) box(sub, x, .2, -3, .2, 6, .2, C.edge); box(sub, 0, 6.2, -3, 10.2, .2, .2, C.edge);
  const tower = group('waterTower', S.waterTower.x, S.waterTower.z);
  for (const [x, z] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) line(tower, [[x, 0, z], [x * .7, 10, z * .7]], C.edge, 1);
  for (let y = 2; y < 10; y += 2.6) line(tower, [[-2 + y * .03, y, -2 + y * .03], [2 - y * .03, y, 2 - y * .03], [-2 + y * .03, y, 2 - y * .03], [2 - y * .03, y, -2 + y * .03]], C.edge, .6);
  cyl(tower, 0, 10, 0, 3, 3.4, C.white, 22); solid(tower, new THREE.ConeGeometry(3.1, 1.3, 22), 0, 14.05, 0, C.wall);
  tankMark = new THREE.Mesh(new THREE.TorusGeometry(3.05, .09, 6, 32), new THREE.MeshBasicMaterial({ color: C.water })); tankMark.rotation.x = Math.PI / 2; tower.add(tankMark);
  const pump = group('pumpHouse', S.pumpHouse.x, S.pumpHouse.z); box(pump, 0, 0, 0, 3.2, 2.4, 2.6, C.white); cyl(pump, 1.9, 0, 0, .35, 1.4, C.water, 10);
  groundText('UTILITIES', S.waterTower.x, S.waterTower.z + 9.5, 10);
  const cell = group('cell', S.cell.x, S.cell.z); const ht = 14;
  for (const x of [-1.2, 1.2]) for (const z of [-1.2, 1.2]) line(cell, [[x, 0, z], [x * .2, ht, z * .2]], C.edge, 1);
  for (let y = 0; y < ht; y += 2) line(cell, [[-1.1 * (1 - y / 18), y, -1.1 * (1 - y / 18)], [1.1 * (1 - (y + 2) / 18), y + 2, -1.1 * (1 - (y + 2) / 18)]], C.edge);
  for (const [x, z] of [[.6, 0], [-.6, 0], [0, .6]]) box(cell, x, 12.2, z, .3, 1.6, .3, C.white);
  stationAgents.beacon = solid(cell, new THREE.SphereGeometry(.3, 10, 8), 0, 14.6, 0, C.blue, false);
  const ex = group('exchange', S.exchange.x, S.exchange.z); box(ex, 0, 0, 0, 4, 2.6, 3, C.white); solid(ex, new THREE.SphereGeometry(.9, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 1, 2.6, 0, C.white);
  const cloud = group('cloud', S.cloud.x, S.cloud.z); cloud.position.y = S.cloud.y; for (const x of [-2, 0, 2]) box(cloud, x, 0, 0, 1.3, 2.5, 1, C.white); line(cloud, [[-3, -1, 0], [3, -1, 0]], C.blue, .5);
  groundText('INTERNET · MODEL API', S.cloud.x, S.cloud.z + 8, 13);

  // 03 Family clinic: canopy and sign on Harbor St, reception, waiting room, exam rooms, ambulance bay, patient lot.
  zonePad(S.clinic.x - 5, S.clinic.z + .5, 36, 16.5, 'clinic');
  const cl = building('clinic', S.clinic.x, S.clinic.z, S.clinic.w, S.clinic.d, 4.2, 'clinic'), cw = S.clinic.w / 2, cd = S.clinic.d / 2; band(cl, S.clinic.w, S.clinic.d, 4.2, 'clinic');
  box(cl, 3, 3.6, cd + 1.6, 6, .22, 3.4, C.white); for (const x of [.4, 5.6]) box(cl, x, 0, cd + 3, .18, 3.6, .18, C.edge);
  sign(cl, 'KESTREL HARBOR CLINIC', 3, 4.15, cd + 3.32, 5.8); const cross = new THREE.Group(); cross.position.set(-cw + 3, 4.5, cd); cl.add(cross); box(cross, 0, 0, 0, 1.8, .55, .2, C.red, false); box(cross, 0, -.62, 0, .55, 1.8, .2, C.red, false);
  stationAgents.clinic = desk(cl, 3, -.5, C.blue); box(cl, 3, 0, 1.2, 4.2, 1, .5, C.white);
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) box(cl, -6 + k * 1.1, 0, 2 + r * 1.6, .8, .5, .7, C.wall);
  for (let i = 0; i < 3; i++) { const x = -cw + 2.2 + i * 3.4; box(cl, x + 1.6, .22, -cd + 2.4, .12, 2.6, 4.6, C.wall); box(cl, x, .22, -cd + 1.6, 2.2, .7, 1, C.white); box(cl, x - .7, .92, -cd + 1.6, .6, .15, .8, C.wall); }
  // Only the clinic's admin desk is modeled. A clerk walks to the records cabinet while an admin request is in progress.
  box(cl, 7.6, .22, -4.4, 1.6, 2, .8, C.wall);
  walker(cl, [[5.6, .2], [7.4, -3.4]], { shirt: WARM.staff[2], period: 6, active: () => model.online && model.adminProgress !== null });
  const ambBay = new THREE.Group(); ambBay.position.set(cw + 2.2, 0, -1); cl.add(ambBay); box(ambBay, 0, 3.4, 0, 3.6, .2, 5, C.white); for (const z of [-2.3, 2.3]) box(ambBay, 1.6, 0, z, .16, 3.4, .16, C.edge);
  vehicle('ambulance', 'ambulance'); place('ambulance', S.clinic.x + cw + 2.2, S.clinic.z - 1, 0);
  for (let i = 0; i < 8; i++) { line(scene, [[S.clinicLot.x - 3, .08, S.clinicLot.z - 7 + i * 2], [S.clinicLot.x + 3, .08, S.clinicLot.z - 7 + i * 2]], C.edge, .6); if (i % 3 !== 1 && i < 7) { vehicle(`clinic-car-${i}`, 'car', CARS[i % CARS.length]); place(`clinic-car-${i}`, S.clinicLot.x, S.clinicLot.z - 6 + i * 2, Math.PI / 2); } }
  groundText('03 / FAMILY CLINIC', S.clinic.x, S.clinic.z - cd - 2, 14);

  // 04 Larkspur Cycle Works: four departments, receiving bays on Harbor St, finished-bike rack, shift door.
  zonePad(S.plant.x, S.plant.z + 1.5, 32, 17, 'plant');
  const pl = building('plant', S.plant.x, S.plant.z, S.plant.w, S.plant.d, 5, 'plant'), pd = S.plant.d / 2; band(pl, S.plant.w, S.plant.d, 5, 'plant');
  for (const d of DEPTS) {
    const dx = d.x; box(pl, dx + 3.4, .22, -pd + 3, .1, 1.2, 5.5, C.wall);
    if (d.id === 0) for (const z of [-3.5, -.5]) { box(pl, dx - 1, .22, z, 2.2, .9, 1.4, C.white); cyl(pl, dx + .6, .22, z, .35, .8, C.ink, 8); box(pl, dx + .6, 1, z - .2, .2, .2, 1.2, C.ink); }
    if (d.id === 1) { box(pl, dx, .22, -2.6, 4.2, 3.6, .15); box(pl, dx - 2.1, .22, -2, .15, 3.6, 3.4); box(pl, dx + 2.1, .22, -2, .15, 3.6, 3.4); box(pl, dx, 3.82, -2, 4.2, .15, 3.4); paintBooth2 = box(pl, dx, .22, -4.6, 3.8, 3, .15, C.green); paintBooth2.visible = false; }
    if (d.id === 2) for (const z of [-3.5, -.5]) { box(pl, dx, .22, z, 1.8, .9, 1, C.white); const rim = solid(pl, new THREE.TorusGeometry(.55, .06, 6, 20), dx, 1.7, z, C.ink, false); rim.rotation.y = Math.PI / 2; }
    if (d.id === 3) { box(pl, dx - .5, .22, -2.5, 3, .8, 1.4, C.white); assembly2 = box(pl, dx - .5, .22, .2, 3, .8, 1.4, C.green); assembly2.visible = false; }
    figures[`dept-${d.id}`] = figure(pl, dx + 1.2, -1.2, C.green);
    const pool = []; for (let k = 0; k < 18; k++) { const c = box(pl, dx - 1.6 + (k % 4) * .78, .22 + Math.floor(k / 12) * .62, 1.6 + Math.floor((k % 12) / 4) * .78, .62, .55, .62, C.white); c.visible = false; pool.push(c); }
    plantPools.push(pool);
    sign(pl, d.name, dx, 4.2, -pd + .14, 4.2, 0, '#ffffff');
  }
  for (const bx of BAYS) { const lx = bx - S.plant.x; box(pl, lx, .22, pd - .05, 3.2, 3.6, .1, 0xcfd8d1); box(pl, lx, 0, pd + 1, 3.2, .2, 2, C.wall); for (let k = 0; k < 3; k++) dockCrates.push(box(pl, lx - 1 + k, .22, pd - 1.2, .8, .7, .8, C.white)); }
  for (let k = 0; k < 8; k++) { const b = new THREE.Group(); b.position.set(12.4, 0, -pd + 1.5 + k * .9); pl.add(b); for (const z of [-.3, .3]) { const wl = solid(b, new THREE.TorusGeometry(.32, .04, 6, 16), 0, .55, z, C.ink, false); wl.rotation.y = Math.PI / 2; } box(b, 0, .6, 0, .05, .25, .6, C.green, false); rackBikes.push(b); }
  sign(pl, 'LARKSPUR CYCLE WORKS', 0, 5.6, pd + .14, 6.5);
  walker(pl, [[-9.5, 5.3], [-11.6, 4.4]], { shirt: WARM.staff[1], period: 4.5, carry: 0xd8d2c4, active: () => model.power && (model.trucks.some(t => t.phase === 'unloading') || model.plant.queues[0].length > 0) });
  walker(pl, [[9.2, 2.4], [11.6, -1]], { shirt: WARM.staff[2], period: 5.5, active: () => model.power && model.plant.metrics().working[3] > 0 });
  groundText('04 / CYCLE WORKS', S.plant.x, S.plant.z - pd - 2, 13);
  // 05 Ops office (human approver) with the staff lot; 06 Agent floor.
  zonePad(S.ops.x, S.ops.z + 4, 15, 18, 'ops');
  const office = building('ops', S.ops.x, S.ops.z, 8, 10, 6, 'ops'); band(office, 8, 10, 6, 'ops'); stationAgents.approve = desk(office, 0, 0, C.blue, 'operator');
  for (let i = 0; i < 6; i++) { line(scene, [[S.staffLot.x - 6 + i * 2.4, .08, S.staffLot.z - 2], [S.staffLot.x - 6 + i * 2.4, .08, S.staffLot.z + 2]], C.edge, .6); if (i % 2 === 0) { vehicle(`staff-car-${i}`, 'car', CARS[(i + 3) % CARS.length]); place(`staff-car-${i}`, S.staffLot.x - 4.8 + i * 2.4, S.staffLot.z, 0); } }
  groundText('05 / OPS · HUMAN', S.ops.x, S.ops.z - 7, 9);
  zonePad(S.agents.x, S.agents.z + .5, 19, 16, 'agents');
  const floor = building('agents', S.agents.x, S.agents.z, S.agents.w, S.agents.d, 4.4, 'agents'); band(floor, S.agents.w, S.agents.d, 4.4, 'agents');
  // Review intake rack (16 slots on two shelves) beside the review desk; a marked overflow pad (20) out front.
  box(floor, 7.3, 0, 2.6, 2.8, .12, 3.4, C.wall); box(floor, 7.3, .9, 2.6, 2.8, .08, 3.4, C.wall); for (const [x, z] of [[5.95, .95], [8.65, .95], [5.95, 4.25], [8.65, 4.25]]) box(floor, x, 0, z, .1, 1.8, .1, C.edge);
  { const px = S.agents.x + 1.5, pz = S.agents.z + S.agents.d / 2 + 1.25; for (let k = -4; k <= 4; k++) line(scene, [[px + k - .5, .06, pz - .9], [px + k + .5, .06, pz + .9]], ZONE.agents, .7); line(scene, [[px - 4.5, .06, pz - .9], [px + 4.5, .06, pz - .9], [px + 4.5, .06, pz + .9], [px - 4.5, .06, pz + .9], [px - 4.5, .06, pz - .9]], ZONE.agents, .9); }
  for (let k = 0; k < 5; k++) { const cone = solid(scene, new THREE.ConeGeometry(.28, .8, 8), S.agents.x - 6 + k * 3, .4, laneH(H.harbor, -1) - 1.3, 0xf3f5f6); cone.visible = false; cones.push(cone); }
  for (const [id, x] of Object.entries(STATION_X)) stationAgents[id] = desk(floor, x, -3.2, C.green, id === 'review' ? 'reviewer' : 'robot');
  stationAgents.execute2 = desk(floor, STATION_X.execute, .2, C.green, 'robot'); reviewer2 = desk(floor, STATION_X.review, -.5, C.green, 'reviewer'); reviewer3 = desk(floor, STATION_X.review, 2.2, C.green, 'reviewer');
  box(floor, 7.6, 0, -3.2, .8, 1.6, 2.2, C.wall);
  groundText('06 / AGENT FLOOR', S.agents.x, S.agents.z - S.agents.d / 2 - 2, 13);
  zonePad(S.field.x, S.field.z, S.field.w + 3, S.field.d + 3, 'farm');
  // Fishing harbor: illustrative waterfront dressing around the existing boat, landing, storage and shipment counts.
  const WH = { x: 28, z: 49.5 };
  box(scene, WH.x, -.4, WH.z, 18, .5, 7, PORT.quay); box(scene, WH.x, -.1, WH.z + 3.35, 18, .18, .35, PORT.bollard, false);
  for (let x = WH.x - 8.3; x <= WH.x + 8.3; x += 2.6) for (const z of [WH.z - 3.1, WH.z + 3.1]) box(scene, x, -1.2, z, .25, .9, .25, C.edge, false);
  zonePad(WH.x, WH.z, 18.4, 7.4, 'harbor');
  // Painted berth mouths and bollards clarify the three independent boat positions; they do not imply a shared queue.
  for (let i = 0; i < 3; i++) {
    const x = 23 + i * 4.6;
    line(scene, [[x - 1.65, .04, WH.z + 2.1], [x - 1.65, .04, WH.z + 3.1]], 0xf4f1e7, .95);
    line(scene, [[x + 1.65, .04, WH.z + 2.1], [x + 1.65, .04, WH.z + 3.1]], 0xf4f1e7, .95);
    cyl(scene, x - 1.85, -.25, WH.z + 2.75, .14, .45, PORT.bollard, 8);
    cyl(scene, x + 1.85, -.25, WH.z + 2.75, .14, .45, PORT.bollard, 8);
  }
  const fh = building('fishhouse', WH.x - 2.5, WH.z - .6, 7, 3.8, 3, 'harbor'); band(fh, 7, 3.8, 3, 'harbor');
  box(fh, 4.6, .1, 0, 2.2, 2.4, 3, C.wall); cyl(fh, 4.6, 2.5, 0, .5, .8, C.ink, 10); // refrigeration marker; no ice-production process is modeled
  box(fh, -2.1, .22, -.5, 2.4, 2.5, 2.6, 0xd2e6ee); box(fh, -2.1, .22, .82, 1, 2, .04, 0x9fbfcc, false); // cold room and its door
  box(fh, 1.1, .22, .1, 2.4, .8, 1.1, 0xb8c4c8); for (let k = 0; k < 3; k++) box(fh, .4 + k * .7, 1.02, .1, .5, .3, .5, 0xdbe8ee);
  box(fh, -4.15, .1, .9, .8, 1, 2, C.white); box(fh, -4.3, 2.3, .9, 1.3, .1, 2.6, ZONE.harbor, false); // market counter and awning on the promenade side
  sign(fh, 'KESTREL SEAFOOD · FISH MARKET', 0, 4.6, -1.9, 6.2, 0, '#ffffff');
  const unloading = () => model.power && model.fish.boats.some(b => b.phase === 'unloading');
  walker(fh, [[2.4, 3.1], [1.9, 1.3], [-2.1, 1.3]], { shirt: WARM.staff[0], period: 3.6, carry: 0xdbe8ee, active: unloading });
  walker(fh, [[2.6, 3.1], [2.2, 1.6], [-1.6, 1.5]], { shirt: WARM.staff[3], period: 3.6, phase: 1.8, carry: 0xdbe8ee, active: unloading });
  walker(fh, [[.2, 1.0], [1.8, 1.0]], { shirt: WARM.staff[2], period: 4, active: () => model.power && model.fish.store > 0 });
  for (const ph of [0, 6]) walker(scene, [[15, 47.4], [21.3, 47.4], [21.3, 48.3]], { shirt: WARM.street[ph ? 2 : 0], period: 12, phase: ph, active: () => model.fish.store > 0 });
  for (let k = 0; k < 12; k++) fishBoxes.push(box(scene, WH.x + 2.5 + (k % 4) * .6, -.15 + Math.floor(k / 8) * .42, WH.z + 1 + Math.floor((k % 8) / 4) * .6, .5, .38, .5, 0xdbe8ee));
  vehicle('reefer', 'truck', C.white); place('reefer', WH.x - 9.5, laneH(H.coast, 1) + .3, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const g = group(`boat-${i + 1}`); box(g, 0, -.1, 0, 1.6, .7, 4.4, C.blue); box(g, 0, .6, -.9, 1.2, 1.1, 1.3, C.white); box(g, 0, 1.7, -.9, 1.3, .1, 1.4, ZONE.harbor, false);
    box(g, 0, .6, .6, .12, 2.6, .12, C.ink, false); for (const sgn of [-1, 1]) { const boom = box(g, sgn * 1.6, 2.4, .6, 3.2, .08, .08, C.ink, false); boom.rotation.z = sgn * .45; boom.position.y = 2.2; line(g, [[sgn * 3, 1.5, .6], [sgn * 3, -.2, 1.6]], C.edge, .7); }
    trawlers.push(g); vehicleMeshes[`boat-${i + 1}`] = g;
  }
  // Town storefront, facing the coast promenade.
  const store = group('store', S.store.x, S.store.z); box(store, 0, 0, 0, 8, 3.6, 5, C.white); box(store, 0, 0, 2.52, 6.4, 2.6, .05, 0xd4e0e6, false);
  box(store, 0, 2.7, 3.2, 7, .12, 1.6, C.green); sign(store, 'LARKSPUR CYCLES', 0, 3.25, 2.56, 5.5, 0, '#ffffff');
  for (let k = 0; k < 5; k++) { const b = new THREE.Group(); b.position.set(-2.4 + k * 1.2, 0, 2.2); store.add(b); for (const x of [-.32, .32]) solid(b, new THREE.TorusGeometry(.3, .04, 6, 16), x, .5, 0, C.ink, false); box(b, 0, .55, 0, .6, .05, .05, C.green, false); storeBikes.push(b); }

  ({ boats, sailBoats } = dressWorld(scene, { C, edgeMaterial: outline, matFor: mat, keepOut: [
    [S.field.x - 17, S.field.z - 16, S.field.x + 17, S.field.z + 15], [S.coop.x - 9, S.coop.z - 8, S.coop.x + 18, S.coop.z + 13], [S.substation.x - 8, S.substation.z - 7, S.substation.x + 8, S.substation.z + 7],
    [S.waterTower.x - 4, S.waterTower.z - 4, S.pumpHouse.x + 3, S.pumpHouse.z + 3], [S.cell.x - 2, S.cell.z - 2, S.cell.x + 2, S.cell.z + 2], [S.exchange.x - 3, S.exchange.z - 3, S.exchange.x + 3, S.exchange.z + 3],
    [S.clinic.x - 13, S.clinic.z - 9, S.clinic.x + 15, S.clinic.z + 10], [S.clinicLot.x - 4, S.clinicLot.z - 8, S.clinicLot.x + 4, S.clinicLot.z + 8], [S.plant.x - 15, S.plant.z - 9, S.plant.x + 15, S.plant.z + 11],
    [S.ops.x - 5, S.ops.z - 8, S.ops.x + 5, S.ops.z + 6], [S.staffLot.x - 7, S.staffLot.z - 3, S.staffLot.x + 7, S.staffLot.z + 3], [S.agents.x - 9, S.agents.z - 9, S.agents.x + 9, S.agents.z + 7],
    [S.store.x - 5, S.store.z - 3, S.store.x + 5, S.store.z + 5], [S.barn.x - 8, S.barn.z - 3, S.barn.x + 11, S.barn.z + 3], [S.rtk.x - 2, S.rtk.z - 2, S.rtk.x + 2, S.rtk.z + 2],
    [S.cloud.x - 4, S.cloud.z - 3, S.cloud.x + 4, S.cloud.z + 9],
    ...[H.farm, H.market, H.harbor].map(z => [-73, z - 4.3, 73, z + 4.3]), [-73, H.coast - 2.6, 73, H.coast + 2.6], ...Object.values(V).map(x => [x - 4.3, -44, x + 4.3, 46]), [18, 44.5, 50, 66], [12, 41, 36, 47]] }));

  // Vehicles and traffic (right-hand lanes; clockwise loops ride the inner lanes so loops never meet head-on).
  vehicle('tractor', 'tractor', 0xcbd8b9); vehicle('harvester', 'combine', C.white); vehicle('truck-a', 'truck', C.white); vehicle('truck-b', 'truck', C.white); vehicle('autovan', 'van', C.white); vehicle('graintruck', 'grain', C.white);
  const loops = [[blockLoop(V.west, V.mill, H.market, H.harbor), 2], [blockLoop(V.mill, V.plant, H.market, H.harbor), 2], [blockLoop(V.plant, V.east, H.farm, H.market), 1], [blockLoop(V.mill, V.plant, H.farm, H.market), 1], [blockLoop(V.west, V.mill, H.farm, H.market), 1],
    [[[-74, laneH(H.coast, 1)], [74, laneH(H.coast, 1)]], 3], [[[74, laneH(H.coast, -1)], [-74, laneH(H.coast, -1)]], 3], [[[-74, laneH(H.market, 1)], [74, laneH(H.market, 1)]], 2], [[[74, laneH(H.harbor, -1)], [-74, laneH(H.harbor, -1)]], 3, 'harbor'], [[[-74, laneH(H.harbor, 1)], [74, laneH(H.harbor, 1)]], 2, 'harbor']];
  const tr = rng(3);
  for (const [route, n, street] of loops) { const len = polyLen(route); for (let i = 0; i < n; i++) { const id = `car-${traffic.length}`; vehicle(id, 'car', CARS[traffic.length % CARS.length]); traffic.push({ id, route, street, period: len / (2.2 + tr() * .3), phase: i / n + tr() * .08, plate: PLATES[traffic.length % PLATES.length], held: null }); } }
  pedParts = [[new THREE.BoxGeometry(.34, .55, .22).translate(0, .275, 0), PANTS], [new THREE.CapsuleGeometry(.19, .32, 3, 8).translate(0, .82, 0), SHIRTS], [new THREE.SphereGeometry(.17, 10, 8).translate(0, 1.33, 0), SKIN]].map(([geo, palette], j) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 80), c = new THREE.Color();
    for (let i = 0; i < 80; i++) m.setColorAt(i, c.setHex(palette[(i * (j + 2) + j) % palette.length])); scene.add(m); return m; });
  peds = pedParts[0];
  tokenGroup = new THREE.Group(); scene.add(tokenGroup);

  nets = buildNetworks(scene, { mat, ink: C.ink, colors: C, movers: (id, y) => () => { const v = vehicleMeshes[id].position.clone(); v.y = y; return v; } });
  focusRing = new THREE.Mesh(new THREE.RingGeometry(2.7, 2.86, 48), new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.DoubleSide, transparent: true, opacity: .8 })); focusRing.rotation.x = -Math.PI / 2; focusRing.position.y = .15; scene.add(focusRing);
  const ringMat = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.DoubleSide, transparent: true, opacity: .9 }); for (let k = 0; k < 24; k++) { const r = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.8, 40), ringMat); r.rotation.x = -Math.PI / 2; r.visible = false; scene.add(r); xrayRings.push(r); }
  routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: C.ink, dashSize: .8, gapSize: .55 })); routeLine.visible = false; scene.add(routeLine);

  camera = new THREE.OrthographicCamera(); camera.position.set(80, 80, 80);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: CAPTURE }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; host.prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(DISTRICTS.all[0]); camera.position.add(DISTRICTS.all[0]); camera.zoom = DISTRICTS.all[1]; camera.updateProjectionMatrix(); controls.update();
  controls.enableDamping = false; controls.minZoom = .5; controls.maxZoom = 6; controls.maxPolarAngle = Math.PI * .45; controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.addEventListener('start', () => { following = false; flight = null; ui(); });
  controls.addEventListener('change', () => draw(0));
  new ResizeObserver(resize).observe(host); resize();
  const raycaster = new THREE.Raycaster(); let down;
  function hit(e) { const b = host.getBoundingClientRect(); pointer = { x: e.clientX - b.left, y: e.clientY - b.top }; raycaster.setFromCamera(new THREE.Vector2(pointer.x / b.width * 2 - 1, 1 - pointer.y / b.height * 2), camera); for (const h of raycaster.intersectObjects(roots, true)) { let o = h.object; while (o && !o.userData.id) o = o.parent; if (o && info(o.userData.id)) return o.userData.id; } return null; }
  renderer.domElement.addEventListener('pointermove', e => setHover(hit(e)));
  renderer.domElement.addEventListener('pointerleave', () => setHover(null));
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) select(hit(e)); down = null; });
}

// ---------- Inspector content: fictional mock data + live model ----------
const pct = v => `${Math.round(v * 100)}%`;
const station = id => model.floor.metrics().stations.find(s => s.id === id);
const clock = (t = model.time) => `${String((8 + Math.floor(t / 60)) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const manifestFor = i => MANIFESTS[(model.receivedLoads + i) % MANIFESTS.length];
const heldBy = needs => needs.find(n => !model[n]);
function truckInfo(i) {
  const t = model.trucks[i], v = VEHICLES[t.id], held = t.phase === 'unloading' && !model.power;
  const jam = model.blocked && ((t.phase === 'inbound' && t.elapsed === 2) || (t.phase === 'outbound' && t.elapsed === 9));
  const status = jam ? 'stuck on Harbor St · review spill' : held ? 'held at dock · no power' : { inbound: `to ${v.bay}`, unloading: `unloading at ${v.bay}`, outbound: 'back to supplier', offsite: 'at supplier' }[t.phase];
  const cargo = t.phase === 'inbound' ? 4 : t.phase === 'unloading' ? Math.max(0, 4 - Math.floor(t.elapsed)) : 0;
  return { eyebrow: v.kind, title: v.code, status, warn: held || jam, bar: [cargo, 4, 'crates on board'], prio: 1,
    rows: [['Route', `${SUPPLIER.replace(' (fictional)', '')} → Cycle Works`], ['Driver', v.driver], ['Next stop', t.phase === 'inbound' ? `${v.bay}, Harbor St` : 'supplier yard'], ['Manifest', manifestFor(i)[0]], ['Unloading needs', 'dock power'], ['Loads delivered', model.receivedLoads]],
    next: t.phase === 'inbound' ? { label: v.bay, at: [BAYS[i], BAY_Z] } : null, tag: `${v.code} · ${status}`, deps: ['power'] };
}
const objects = {
  tractor: () => { const v = VEHICLES.tractor, ok = model.positioning; return { eyebrow: v.kind, title: v.code, status: ok ? 'following field plan' : 'safe stop · no RTK correction', warn: !ok, bar: [model.fieldTime % P.fieldCircuit, P.fieldCircuit, 'of field pass (min)'], prio: 1,
    rows: [['Control', 'onboard, stored plan'], ['Task', v.task], ['RTK correction', ok ? 'locked' : 'lost: stops by policy'], ['Telemetry', model.online ? 'sending via cell' : `buffering (${model.buffered})`], ['Working minutes', model.fieldTime]], tag: `${v.code} · ${ok ? 'tilling' : 'safe stop · no RTK'}`, deps: ['positioning', 'internet'] }; },
  harvester: () => { const v = VEHICLES.harvester, ok = model.positioning; return { eyebrow: v.kind, title: v.code, status: ok ? 'harvesting' : 'safe stop · no RTK correction', warn: !ok, bar: [model.coop.cartFill, COOP.fillMinutes, 'grain cart filling (min)'], prio: 2,
    rows: [['Control', 'onboard, stored plan'], ['Grain cart', `${Math.round(model.coop.cartFill / COOP.fillMinutes * 100)}% full`], ['Loads waiting', model.coop.loadsReady], ['RTK correction', ok ? 'locked' : 'lost'], ['Yield', 'not modeled']], tag: `${v.code} · ${ok ? 'harvesting' : 'safe stop'}`, deps: ['positioning', 'internet'] }; },
  graintruck: () => { const t = model.coop.truck, label = { field: 'waiting at field', 'to-coop': 'hauling grain to co-op', dumping: model.power ? 'dumping at pit' : 'held at pit · no power', 'to-field': 'returning to field' }[t.phase];
    return { eyebrow: 'Farm truck · grain hopper', title: 'AG-T3', status: label, warn: t.phase === 'dumping' && !model.power, prio: 2, rows: [['Loads hauled', model.coop.hauled], ['Loads waiting at field', model.coop.loadsReady], ['Route', 'north field ⇄ co-op pit'], ['Dump needs', 'pit conveyor power']],
      next: t.phase === 'to-coop' ? { label: 'Co-op pit', at: grainRoute.at(-1) } : t.phase === 'to-field' ? { label: 'North field', at: grainRoute[0] } : null, tag: `AG-T3 · ${label}`, deps: ['power'] }; },
  field: () => ({ eyebrow: 'Farm · 2 machines', title: 'North field', status: model.positioning ? 'equipment working' : 'equipment in safe stop', warn: !model.positioning, rows: [['Machines', 'AG-07, AG-11'], ['Working minutes', model.fieldTime], ['Irrigation', model.water.pressure], ['Correction source', 'RTK base station']], deps: ['positioning', 'water'] }),
  rtk: () => ({ eyebrow: 'Farm · GNSS base station', title: 'RTK BASE-1', status: model.positioning ? 'broadcasting corrections' : 'correction signal lost', warn: !model.positioning, prio: 3, rows: [['Purpose', 'centimetre-level correction'], ['Link', 'local radio (violet arcs)'], ['If lost', 'accuracy falls; machines stop by policy'], ['Power', 'own battery in this model']], tag: `RTK BASE · ${model.positioning ? 'broadcasting' : 'LOST'}`, deps: ['positioning'] }),
  barn: () => ({ eyebrow: 'Farm · depot', title: 'Equipment depot', status: 'staging', rows: [['Silos', 2], ['Fuel and parts', 'not modeled']], deps: ['power'] }),
  coop: () => { const c = model.coop; return { eyebrow: 'Farm-linked processing', title: 'Kestrel Grain Co-op', status: !model.power ? 'mill and leg stopped · no power' : c.milling !== null ? 'milling a load' : 'waiting for grain', warn: !model.power, bar: [c.milling ?? 0, COOP.mill, 'min into current load'], prio: 1,
    rows: [['Loads hauled in', c.hauled], ['Waiting in bin', c.bin], ['Loads milled', c.milled], ['Bags on dock', c.milled * 40], ['Needs', 'power; RTK keeps harvest moving']], tag: `CO-OP · ${c.milled} LOADS MILLED${model.power ? '' : ' · NO POWER'}`, deps: ['power', 'positioning'] }; },
  'truck-a': () => truckInfo(0), 'truck-b': () => truckInfo(1),
  plant: () => { const m = model.plant.metrics(), sh = shiftInfo(model.time); return { eyebrow: 'Manufacturing · 4 departments', title: 'Larkspur Cycle Works', status: !model.power ? 'line stopped · no power' : `${STAGES[m.constraint].short} is the constraint`, warn: !model.power, bar: [Math.min(m.queues[m.constraint], 20), 20, `kits waiting at ${STAGES[m.constraint].short.toLowerCase()}`], prio: 1,
    rows: [['Shift', `${sh.name}${sh.changing ? ' · changing over' : ''}`], ['Kits released', m.released], ['Bikes finished', m.completed], ['Waiting at paint', m.queues[1]], ['Paint booths', m.machines[1]], ['Assembly stations', m.machines[3]], ['Paint utilization', pct(m.utilization[1])]], tag: `CYCLE WORKS · ${m.completed} BIKES`, deps: ['power', 'water'] }; },
  clinic: () => { const req = ADMIN_REQUESTS[model.adminDone % ADMIN_REQUESTS.length], ok = model.online; return { eyebrow: 'Family clinic · admin desk on a remote service', title: 'Kestrel Harbor Clinic', status: !ok ? `admin desk waiting · ${!model.power ? 'power' : 'internet'}` : model.adminProgress === null ? 'open' : 'processing admin request', warn: !ok, bar: [model.adminProgress ?? 0, P.admin, 'min into admin request'], prio: 1,
    rows: [['Current admin task', req], ['Admin queue', model.adminQueue], ['Completed today', model.adminDone], ['Water pressure', model.water.pressure], ['Patient data', 'none modeled']], tag: `CLINIC · ${ok ? 'OPEN' : 'ADMIN WAITING ON REMOTE'}`, deps: ['internet', 'power', 'water'] }; },
  ambulance: () => ({ eyebrow: 'Clinic · ambulance bay', title: 'MEDIC 4', status: 'on standby', rows: [['Purpose', 'visual context'], ['Dispatch', 'not modeled']] }),
  ops: () => { const s = station('approve'); return { eyebrow: 'Ops office · human in the loop', title: 'Approval console', status: !model.power ? 'console dark · no power' : s.working ? 'reviewing an approval' : 'no approvals waiting', warn: !model.power, bar: [s.queued, 10, 'approvals waiting'], prio: 2,
    rows: [['Approver', 'Shift lead (human)'], ['Rule', `every ${FLOOR.approveEvery}rd task needs sign-off`], ['Waiting', s.queued], ['Utilization', pct(s.utilization)], ['District clock', clock()]], tag: `HUMAN APPROVER · ${s.queued} WAITING`, deps: ['power'] }; },
  agents: () => { const m = model.floor.metrics(), r = m.stations.find(s => s.id === 'review'); return { eyebrow: 'Agent floor · AI agents work, people review', title: 'Agent ops floor', status: !model.power ? 'all agents held · no power' : !model.internet ? 'research + planning waiting on model API' : model.blocked ? 'backlog spilled into Harbor St' : r.queued > 6 ? 'review is the bottleneck' : 'flowing', warn: !model.online || r.queued > 6 || model.blocked, bar: [Math.min(r.queued, 40), 40, 'tasks waiting for review'], prio: 1,
    rows: [['Reviewers (people)', m.reviewers], ['Review time', '6 min per task, fixed'], ['Waiting for review', r.queued], ['Work in progress', m.wip], ['Finished', m.done], ['Throughput', `${m.throughputPerHour.toFixed(1)} / hr`], ['Avg completed cycle', `${Math.round(m.avgCycle)} min`], ['Review utilization', pct(r.utilization)], ['Intake rack', `${Math.min(r.queued, P.rack)}/${P.rack}`], ['Overflow pad', `${Math.max(0, Math.min(r.queued - P.rack, P.pad))}/${P.pad}`], ['Harbor St', model.blocked ? 'BLOCKED by spill' : 'clear']], tag: model.blocked ? 'AGENT FLOOR · BACKLOG IN THE STREET' : `AGENT FLOOR · WIP ${m.wip}`, deps: ['internet', 'power'] }; },
  cell: () => ({ eyebrow: 'Network · cell site', title: 'Cell tower LK-1', status: model.online ? 'connected' : `down · ${!model.power ? 'no power' : 'no internet backhaul'}`, warn: !model.online, prio: 2,
    rows: [['Reports generated', model.generated], ['Delivered', model.transmitted], ['Buffered on machines', model.buffered], ['Reconnect flush', `${P.flushPerMinute} / min`], ['Backhaul', 'fiber on the poles']], tag: `CELL · ${model.online ? 'CONNECTED' : 'DOWN'}`, deps: ['internet', 'power'] }),
  exchange: () => ({ eyebrow: 'Network · fiber exchange', title: 'Exchange hut', status: model.online ? 'linked to internet' : 'no upstream', warn: !model.online, rows: [['Serves', 'clinic, plant, ops, agents, cell site'], ['Upstream', 'internet backbone']], deps: ['internet', 'power'] }),
  cloud: () => ({ eyebrow: 'Remote service · abstraction', title: 'Model API', status: model.online ? 'reachable' : 'unreachable from district', warn: !model.online, rows: [['Used by', 'clinic desk, research + planning agents'], ['Location', 'not modeled']], deps: ['internet'] }),
  substation: () => ({ eyebrow: 'Utilities · electric', title: 'Substation', status: model.power ? 'feeders energized' : 'outage', warn: !model.power, prio: 3, rows: [['Feeders', '6 overhead, on joint-use poles'], ['Serves', 'every building and the pump'], ['Vehicles', 'self-powered'], ['Backup', 'not modeled']], tag: `SUBSTATION · ${model.power ? 'ON' : 'OUTAGE'}`, deps: ['power'] }),
  waterTower: () => ({ eyebrow: 'Utilities · water', title: 'Water tower', status: `${Math.round(model.water.level)}% full · pressure ${model.water.pressure}`, warn: model.water.pressure !== 'normal', bar: [Math.round(model.water.level), 100, 'tank level'], prio: 1,
    rows: [['Pump', model.power ? 'running' : 'stopped · no power'], ['Demand', '0.5% of tank / min'], ['Refill', '1.2% / min with power'], ['Ride-through', 'storage carries a power cut ~3 h'], ['Mains', 'buried along roads, hydrants every block']], tag: `WATER · ${Math.round(model.water.level)}%`, deps: ['power', 'water'] }),
  pumpHouse: () => ({ eyebrow: 'Utilities · water', title: 'Pump house', status: model.power ? 'pumping to tank' : 'stopped · no power', warn: !model.power, rows: [['Source', 'well'], ['Lifts to', 'water tower']], deps: ['power', 'water'] }),
  store: () => ({ eyebrow: 'Town · storefront', title: 'Larkspur Cycles', status: model.storeStock ? `${model.storeStock} bikes in stock` : 'waiting for stock', prio: 2, rows: [['Bikes received', model.plant.completed.length], ['Sold', model.sold], ['In stock', model.storeStock], ['Sells', 'one bike per 90 min']], tag: `LARKSPUR CYCLES · ${model.storeStock} IN STOCK`, deps: ['power'] }),
  fishhouse: () => { const f = model.fish, warm = f.temp > FISH.spoilAt; return { eyebrow: 'Fishing harbor · cold chain', title: 'Kestrel Seafood', status: warm ? `spoiling · ${f.temp.toFixed(1)} °C` : !model.power ? `cold room warming · ${f.temp.toFixed(1)} °C` : `cold room ${f.temp.toFixed(1)} °C`, warn: warm || !model.power, bar: [Math.min(f.temp, 8), 8, '°C in cold room (model threshold: 5 °C)'], prio: 1,
    rows: [['Boxes in cold storage', f.store], ['Landed since reset', f.landed], ['Aggregate boxes shipped', f.shipped], ['Spoiled', f.spoiled], ['Needs', 'power to hold cold-room temperature'], ['Contrast', 'water stores; fish spoil']], tag: `FISH HOUSE · ${f.store} BOXES · ${f.temp.toFixed(1)}°C`, deps: ['power'] }; },
  reefer: () => ({ eyebrow: 'Truck · refrigerated', title: 'REEFER-3', status: 'parked near the fish house · route not simulated', rows: [['Modeled shipment rule', `up to ${FISH.shipMax} aggregate boxes every hour`], ['Aggregate boxes shipped', model.fish.shipped]] }),
  spill: () => ({ eyebrow: 'Harbor St · cascade', title: 'Review backlog in the street', status: model.blocked ? 'trucks and traffic held' : 'street clear', warn: model.blocked, prio: 1, rows: [['Closes when', `rack (${P.rack}) and pad (${P.pad}) are both full`], ['Effect', 'supply trucks hold on Harbor St'], ['Amber blocks', 'tasks waiting for review, not goods'], ['Fix', 'add review capacity (try 3 reviewers)']], tag: 'HARBOR ST BLOCKED · REVIEW BACKLOG', deps: ['power'] }),
  ...Object.fromEntries([0, 1, 2].map(i => [`boat-${i + 1}`, () => { const b = model.fish.boats[i]; const label = { out: 'trawling', returning: 'heading in with catch', unloading: model.power ? 'unloading at the fish house' : 'waiting · no dock power', docked: 'tied up at berth', leaving: 'heading out' }[b.phase];
    return { eyebrow: 'Shrimp boat · outriggers', title: `KH SHRIMPER ${i + 1}`, status: label, warn: b.phase === 'unloading' && !model.power, prio: 2, rows: [['Trips since reset', b.trips], ['Illustrative catch per landing', `${FISH.catch} boxes`], ['Unloading needs', 'dock power']], tag: `SHRIMPER ${i + 1} · ${label}`, deps: ['power'] }; }])),
  autovan: () => { const v = VEHICLES.autovan, s = shuttleState(model.roadTime + model.remainder), nxt = SHUTTLE_STOPS[(s.stopIndex + 1) % SHUTTLE_STOPS.length], p = pathPoint(shuttleRoute, nxt.at);
    return { eyebrow: v.kind, title: v.code, status: s.atStop ? `at ${s.atStop}` : `to ${s.next}`, bar: [s.stopIndex + 1, SHUTTLE_STOPS.length, 'stops this lap'], prio: 1,
      rows: [['Route', SHUTTLE_STOPS.map(x => x.name).join(' · ')], ['Next stop', nxt.name], ['Control', 'onboard route following'], ['Speed', `${s.speed} km/h`], ['During internet loss', 'continues (design choice)']], next: { label: nxt.name, at: [p.x, p.z] }, tag: `${v.code} · ${s.atStop ? `at ${s.atStop}` : `to ${s.next}`}`, deps: ['internet'] }; },
};
const carInfo = c => ({ eyebrow: 'Car · ambient traffic', title: c.plate, status: 'driving', rows: [['Purpose', 'visual context'], ['Counts toward metrics', 'no']] });
function info(id) { if (!id) return null; if (objects[id]) return objects[id](); const c = traffic.find(x => x.id === id); return c ? carInfo(c) : null; }

// ---------- Selection, hover, follow, camera flights, x-ray ----------
function setOutline(id, dark) { roots.find(g => g.userData.id === id)?.traverse(o => { if (o.isLineSegments) o.material = dark ? outlineDark : outline; }); }
function setHover(id) { if (id === hovered) return; if (hovered && hovered !== selected) setOutline(hovered, false); hovered = id; if (id) setOutline(id, true); updateHoverTag(); }
function select(id, { follow = false } = {}) { const previous = selected; if (selected && selected !== hovered) setOutline(selected, false); selected = id && info(id) ? id : null; following = follow && !!selected && !!vehicleMeshes[selected]; if (selected) setOutline(selected, true); if (previous !== selected) { const o = info(selected); $('selection-status').textContent = selected ? `${o.title} selected. ${o.status}.` : previous ? 'Object selection cleared.' : ''; } ui(); draw(0); }
function worldOf(id) { if (id === 'field') return new THREE.Vector3(S.field.x, 0, S.field.z); const r = roots.find(g => g.userData.id === id); return r ? new THREE.Vector3(r.position.x, 0, r.position.z) : null; }
function flyTo(target, zoom, duration = 1.4) { flight = { from: controls.target.clone(), to: target.clone(), z0: camera.zoom, z1: zoom, t: 0, duration }; following = false; }
const DISTRICTS = { harbor: [new THREE.Vector3(28, 0, 56), 1.8], all: [new THREE.Vector3(2, 0, -1), matchMedia('(max-width: 680px)').matches ? .72 : .6], farm: [new THREE.Vector3(-30, 0, -20), 2], coop: [new THREE.Vector3(9, 0, -16), 2.1], plant: [new THREE.Vector3(9, 0, 16), 2], clinic: [new THREE.Vector3(-31, 0, 17), 2.1],
  agents: [new THREE.Vector3(56, 0, 15), 2.1], utilities: [new THREE.Vector3(40, 0, -18), 1.8], town: [new THREE.Vector3(14, 0, 37), 1.8] };
function focusDistrict(key) { const [target, zoom] = DISTRICTS[key]; document.querySelectorAll('[data-district]').forEach(b => { const current = b.dataset.district === key; b.classList.toggle('on', current); if (current) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current'); }); flyTo(target, zoom); }
function setXray(kind) { xray = kind; nets.setXray(kind); document.querySelectorAll('[data-xray]').forEach(b => b.classList.toggle('xray', b.dataset.xray === kind)); $('world').classList.toggle('xraying', !!kind); draw(0); }

function updateHoverTag() {
  const el = $('hover-card'); el.hidden = !hovered || hovered === selected; if (el.hidden) return;
  const o = info(hovered), head = document.createElement('b'), st = document.createElement('span'); head.textContent = o.title; st.textContent = o.status; st.className = o.warn ? 'warn' : '';
  el.replaceChildren(head, st, ...o.rows.slice(0, 3).map(([k, v]) => { const r = document.createElement('div'); r.className = 'hc-row'; const a = document.createElement('i'), b = document.createElement('em'); a.textContent = k; b.textContent = v; r.append(a, b); return r; }));
  el.style.left = `${Math.max(8, Math.min(pointer.x + 18, host.clientWidth - 320))}px`; el.style.top = `${Math.max(8, pointer.y - 34)}px`;
}
function updateInspector() {
  const card = $('inspector'); card.hidden = !selected; $('status-line').textContent = selected ? (info(selected).tag || info(selected).title).toLowerCase() : 'nothing selected';
  if (!selected) return; const o = info(selected);
  $('ins-eyebrow').textContent = o.eyebrow; $('ins-title').textContent = o.title; $('ins-status').textContent = o.status; $('ins-status').classList.toggle('warn', !!o.warn);
  $('ins-bar').hidden = !o.bar; if (o.bar) { $('ins-bar-label').textContent = `${Number.isInteger(o.bar[0]) ? o.bar[0] : o.bar[0].toFixed(1)}/${o.bar[1]} ${o.bar[2]}`; $('ins-bar-fill').style.width = `${Math.min(100, o.bar[0] / o.bar[1] * 100)}%`; }
  $('ins-rows').replaceChildren(...o.rows.map(([k, v]) => { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; row.append(dt, dd); return row; }));
  $('follow').hidden = !vehicleMeshes[selected] || /^(ambulance|clinic-car|staff-car)/.test(selected); $('follow').textContent = following ? 'Following' : 'Follow'; $('follow').classList.toggle('on', following);
}

// ---------- Callouts ----------
const at = (x, y, z) => () => new THREE.Vector3(x, y, z), onVehicle = id => () => vehicleMeshes[id].position;
const CALLOUTS = [['tractor', onVehicle('tractor'), 3.4], ['harvester', onVehicle('harvester'), 3.6], ['graintruck', onVehicle('graintruck'), 3.2], ['truck-a', onVehicle('truck-a'), 3.6], ['truck-b', onVehicle('truck-b'), 3.6], ['autovan', onVehicle('autovan'), 3.2],
  ['coop', at(S.coop.x - 2.3, 0, S.coop.z - 5), 16.5], ['plant', at(S.plant.x + 7, 0, S.plant.z), 7.5], ['clinic', at(S.clinic.x - 4, 0, S.clinic.z), 6], ['agents', at(S.agents.x - 5, 0, S.agents.z + 4), 6.5], ['ops', at(S.ops.x, 0, S.ops.z), 7.5],
  ['cell', at(S.cell.x, 0, S.cell.z), 16], ['rtk', at(S.rtk.x, 0, S.rtk.z), 4.6], ['waterTower', at(S.waterTower.x, 0, S.waterTower.z), 15.6], ['substation', at(S.substation.x, 0, S.substation.z), 7], ['store', at(S.store.x, 0, S.store.z), 4.6], ['spill', at(S.agents.x, 0, laneH(H.harbor, -1)), 2.2], ['fishhouse', at(25.5, 0, 48.9), 4.6], ['boat-1', () => trawlers[0].position, 3.4], ['boat-2', () => trawlers[1].position, 3.4], ['boat-3', () => trawlers[2].position, 3.4]];
for (const s of ['research', 'plan', 'execute', 'review']) CALLOUTS.push([`station-${s}`, at(S.agents.x + STATION_X[s], 0, S.agents.z - 3.2), 3]);
for (const d of DEPTS) CALLOUTS.push([`dept-${d.id}`, at(S.plant.x + d.x, 0, S.plant.z), 4.4]);
function stationTag(id) { const s = station(id), def = STATIONS.find(x => x.id === id), down = heldBy(def.needs); return { text: `${def.label.split(' ')[0]} · ${pct(s.utilization)}${s.queued ? ` · ${s.queued} waiting` : ''}${down ? ` · no ${down}` : ''}`, warn: !!down, hot: id === 'review' && s.queued > 6, prio: 3, deps: def.needs }; }
function deptTag(i) { const m = model.plant.metrics(); return { text: `${STAGES[i].short} · ${m.queues[i]} waiting${!model.power ? ' · no power' : ''}`, warn: !model.power, hot: i === m.constraint && m.queues[i] > 3, prio: 3, deps: ['power'] }; }
function makeCallouts() {
  const layer = $('callouts');
  for (const [id, anchor, lift] of CALLOUTS) { const el = document.createElement('button'); el.className = 'tag'; el.type = 'button'; el.addEventListener('click', () => select(id.startsWith('station-') ? 'agents' : id.startsWith('dept-') ? 'plant' : id)); layer.append(el); callouts.push({ id, anchor, lift, el }); }
  const next = document.createElement('div'); next.className = 'tag next'; next.id = 'next-tag'; layer.append(next);
}
const v3 = new THREE.Vector3();
function placeCallouts() {
  if (!callouts.length) return;
  const w = host.clientWidth, h = host.clientHeight, mode = $('label-mode').value, maxPrio = camera.zoom < .9 ? 1 : camera.zoom < 1.6 ? 2 : 3;
  const placed = [], cand = [];
  for (const c of callouts) {
    const mesh = vehicleMeshes[c.id]; if (mode === 'off' || (mesh && !mesh.visible) || (c.id === 'spill' && !model.blocked)) { c.el.hidden = true; continue; }
    const o = c.id.startsWith('station-') ? stationTag(c.id.slice(8)) : c.id.startsWith('dept-') ? deptTag(Number(c.id.slice(5))) : (() => { const i = info(c.id); return { ...i, text: i.tag || i.title }; })();
    const dep = !!xray && !!o.deps?.includes(xray);
    const parent = c.id.startsWith('station-') ? 'agents' : c.id.startsWith('dept-') ? 'plant' : c.id;
    const smartShow = c.id === selected || parent === selected || c.id === hovered || dep || o.warn || o.hot || ((o.prio ?? 3) === 1 && !mesh);
    if (mode === 'smart' ? !smartShow : (o.prio ?? 3) > maxPrio + (dep ? 1 : 0) && c.id !== selected) { c.el.hidden = true; continue; }
    v3.copy(c.anchor()); v3.y += c.lift; v3.project(camera);
    const x = (v3.x + 1) / 2 * w, y = (1 - v3.y) / 2 * h; c.el.hidden = x < 10 || x > w - 10 || y < 30 || y > h - 20; if (c.el.hidden) continue;
    const text = o.text.toUpperCase(); if (c.el.textContent !== text) c.el.textContent = text;
    c.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    c.el.classList.toggle('warn', !!o.warn); c.el.classList.toggle('hot', !!o.hot); c.el.classList.toggle('selected', c.id === selected);
    c.el.classList.toggle('dep', dep); c.el.classList.toggle('faded', !!xray && !dep);
    cand.push({ c, x, y, rank: (c.id === selected ? 0 : dep ? 1 : 2) * 10 + (o.prio ?? 3) - (o.warn ? .5 : 0) });
  }
  // Greedy de-clutter: most important tags claim space first; a tag that would overlap one already placed hides.
  cand.sort((a, b) => a.rank - b.rank);
  for (const k of cand) { const wpx = k.c.el.offsetWidth || 120, r = [k.x - wpx / 2 - 4, k.y - 40, k.x + wpx / 2 + 4, k.y - 16];
    if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) k.c.el.hidden = true; else placed.push(r); }
  const nt = $('next-tag'), nx = selected && info(selected).next;
  if (nx) { v3.set(nx.at[0], 1.5, nx.at[1]).project(camera); nt.hidden = false; nt.textContent = `NEXT · ${nx.label}`.toUpperCase(); nt.style.transform = `translate(${((v3.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v3.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`; } else nt.hidden = true;
}

// ---------- Agent tokens ----------
// v4: a task is drawn as an upright paper card (header band, text lines, a check box) turned toward the camera,
// so waiting work reads as paperwork, not crates of goods. Card colour still carries the state.
const tokens = new Map(); const tokenGeo = new THREE.BoxGeometry(.62, .8, .05), tokenEdges = new THREE.EdgesGeometry(tokenGeo);
const cardTex = (() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 84; const x = cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 84); x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 64, 14);
  x.fillStyle = '#6f6f6f'; for (const y of [26, 38, 50, 62]) x.fillRect(8, y, y === 62 ? 30 : 48, 4);
  x.strokeStyle = '#5a5a5a'; x.lineWidth = 3; x.strokeRect(44, 58, 12, 12);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
// Tasks waiting for review: white paper with a thick amber header and border, so they read as documents at phone size.
const queueTex = (() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 84; const x = cv.getContext('2d');
  x.fillStyle = '#e3a224'; x.fillRect(0, 0, 64, 84); x.fillStyle = '#fffdf7'; x.fillRect(5, 22, 54, 57);
  x.fillStyle = '#8a7a5a'; for (const y of [32, 44, 56]) x.fillRect(11, y, y === 56 ? 26 : 42, 4); x.strokeStyle = '#b07a14'; x.lineWidth = 3; x.strokeRect(41, 61, 11, 11);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const queueMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: queueTex });
const cardMats = new Map(); const cardMat = c => { if (c === QUEUE) return queueMat; if (!cardMats.has(c)) cardMats.set(c, new THREE.MeshLambertMaterial({ color: c, map: cardTex })); return cardMats.get(c); };
function tokenTarget(t, index) {
  const base = new THREE.Vector3(S.agents.x, 0, S.agents.z);
  if (t.stage === 'approve') return t.state === 'working' ? new THREE.Vector3(S.ops.x, 1.3, S.ops.z + .1) : new THREE.Vector3(S.ops.x - 2.5 + (index % 3) * .8, .45, S.ops.z + 2.5 + Math.floor(index / 3) * .8);
  if (t.stage === 'quarantine') return new THREE.Vector3(S.ops.x + 2.5 + (index % 3) * .8, t.state === 'working' ? 1.3 : .45, S.ops.z + 2.5 + Math.floor(index / 3) * .8); // held at the ops office for a person
  const sx = STATION_X[t.stage];
  if (t.state === 'working') { if (t.stage === 'review') { const [dx, dz] = [[sx, -3.2], [sx, -.5], [sx, 2.2]][index % 3]; return base.clone().add(new THREE.Vector3(dx - .2, 1.3, dz - .35)); }
    return base.clone().add(new THREE.Vector3(sx, 1.3, -3.2 + (t.stage === 'execute' && index % 2 ? 3.4 : 0))); }
  const col = index % 4, row = Math.floor(index / 4), z = 1.6 + row * .8;
  if (t.stage === 'review') { // intake rack (16, two shelves) → overflow pad (20) → the street
    if (index < P.rack) { const k = index % 8; return base.clone().add(new THREE.Vector3(6.35 + (k % 4) * .65, index < 8 ? .52 : 1.38, 1.35 + Math.floor(k / 4) * 2.3)); }
    if (index < P.rack + P.pad) { const k = index - P.rack; return new THREE.Vector3(S.agents.x + 1.5 - 3.6 + (k % 10) * .8, .45, S.agents.z + S.agents.d / 2 + .85 + Math.floor(k / 10) * .8); }
    const k = index - P.rack - P.pad; return new THREE.Vector3(S.agents.x + 6 - (k % 12) * .8, .45, laneH(H.harbor, -1) - .4 + Math.floor(k / 12) * .8); }
  return base.clone().add(new THREE.Vector3(sx - 1.2 + col * .8, .45, Math.min(z, 5.6)));
}
function syncTokens(dt) {
  const live = new Set(), counters = {};
  for (const t of model.floor.tasks) {
    live.add(t.id); const key = `${t.stage}-${t.state === 'working' ? 'w' : 'q'}`, i = counters[key] = (counters[key] ?? -1) + 1;
    let tok = tokens.get(t.id); if (!tok) { tok = new THREE.Mesh(tokenGeo, cardMat(C.white)); tok.rotation.y = Math.PI / 4; tok.add(new THREE.LineSegments(tokenEdges, outlineDark)); tok.position.set(S.agents.x - 10, .35, S.agents.z + 4); tokenGroup.add(tok); tokens.set(t.id, tok); }
    const st = STATIONS.find(s => s.id === t.stage), blocked = st && !st.needs.every(n => model[n]);
    tok.material = cardMat(blocked ? OFF : t.stage === 'review' ? (t.state === 'working' ? 0xf3cf86 : QUEUE) : t.stage === 'approve' ? C.blue : t.stage === 'quarantine' ? C.red : t.state === 'working' ? C.green : t.reworked ? 0xe9c9b8 : C.white);
    tok.position.lerp(tokenTarget(t, i), 1 - Math.exp(-dt * 6));
  }
  for (const [id, tok] of tokens) if (!live.has(id)) { tok.position.lerp(new THREE.Vector3(S.agents.x + 7.6, 2.2, S.agents.z - 3.2), 1 - Math.exp(-dt * 6)); tok.scale.multiplyScalar(Math.exp(-dt * 3)); if (tok.scale.x < .1) { tokenGroup.remove(tok); tokens.delete(id); } }
}

// ---------- People: clinic visitors (ambient, not modeled), shift workers, strollers ----------
const pr = rng(9), m4 = new THREE.Matrix4(), hide = new THREE.Matrix4().makeScale(0, 0, 0);
const strollers = Array.from({ length: 30 }, (_, i) => ({ x0: -66 + pr() * 132, z: [H.harbor + 4.4, H.market - 4.4, H.coast + 3.2, H.harbor - 4.4][i % 4], span: 6 + pr() * 12, speed: .05 + pr() * .05, phase: pr() * 6 }));
const PATIENT_PATHS = [[[S.clinicLot.x + 2, S.clinicLot.z + 4], [S.clinicLot.x + 2, H.harbor - 4.2], [S.clinicDoor.x, H.harbor - 4.2], [S.clinicDoor.x, S.clinicDoor.z - 1.5]], [[S.clinicDoor.x + 1, H.harbor - 3.6], [S.clinicDoor.x + .5, S.clinicDoor.z - 1.5]]];
const WORKER_PATHS = [[[S.staffLot.x - 6, S.staffLot.z], [S.staffLot.x - 6, H.harbor - 4.2], [S.plantGate.x + 1, H.harbor - 4.2], [S.plantGate.x + 1, S.plantGate.z - 1]], [[S.plantGate.x - 2, H.harbor - 3.6], [S.plantGate.x, S.plantGate.z - 1]]];
function placePeople() {
  let n = 0; const T = model.time + model.remainder, S1 = new THREE.Vector3(1.25, 1.25, 1.25), Q = new THREE.Quaternion(), P0 = new THREE.Vector3();
  const put = (x, z) => { m4.compose(P0.set(x, 0, z), Q, S1); for (const m of pedParts) m.setMatrixAt(n, m4); n++; }, skip = () => { for (const m of pedParts) m.setMatrixAt(n, hide); n++; };
  strollers.forEach(p => put(p.x0 + Math.sin(T * p.speed + p.phase) * p.span / 2, p.z));
  for (let j = 0; j < 12; j++) { // visitors: walk in, stay, walk out; staggered every 5 minutes; visual context only
    const cycle = ((T + j * 5) % 60) / 60, path = PATIENT_PATHS[j % 2];
    if (cycle < .15) { const q = pathPoint(path, cycle / .15); put(q.x, q.z); } else if (cycle > .55 && cycle < .7) { const q = pathPoint(path, 1 - (cycle - .55) / .15); put(q.x, q.z); } else skip();
  }
  const sh = shiftInfo(Math.floor(T)), N = 30;
  for (let k = 0; k < N; k++) {
    const path = WORKER_PATHS[k % 2], start = (k / N) * .55, prog = f => Math.max(0, Math.min(1, (f - start) / .45));
    if (sh.arriving !== null && sh.arriving > start && prog(sh.arriving) < 1) { const q = pathPoint(path, prog(sh.arriving)); put(q.x + (k % 3) * .3, q.z); }
    else if (sh.leaving !== null && sh.leaving > start && prog(sh.leaving) < 1) { const q = pathPoint(path, 1 - prog(sh.leaving)); put(q.x + (k % 3) * .3, q.z); }
    else skip();
  }
  while (n < peds.count) skip();
  for (const m of pedParts) m.instanceMatrix.needsUpdate = true;
}
function moveWalkers() { // out, pause, back, pause; legs swing while walking; a carried box shows on the way in
  for (const w of walkers) {
    const on = w.active(), f = on ? (((animT + w.phase) / w.period) % 1 + 1) % 1 : .96;
    const q = f < .42 ? f / .42 : f < .5 ? 1 : f < .92 ? 1 - (f - .5) / .42 : 0, moving = on && (f < .42 || (f >= .5 && f < .92));
    const a = pathPoint(w.pts, q); w.p.position.x = a.x; w.p.position.z = a.z;
    if (moving) w.p.rotation.y = a.angle + (f < .5 ? Math.PI : 0);
    w.p.userData.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(animT * 9 + i * Math.PI) * .5 : 0; });
    if (w.c) w.c.visible = on && f < .5;
  }
}

// ---------- HUD / page UI ----------
function ui() {
  $('clock').textContent = clock(); $('fig-clock').textContent = clock();
  $('play').textContent = running ? 'Pause' : 'Run'; $('play').setAttribute('aria-pressed', String(running));
  const m = model.floor.metrics(), pm = model.plant.metrics(), sh = shiftInfo(model.time);
  $('received').textContent = model.received; $('painted').textContent = pm.completed; $('admin-done').textContent = model.adminDone; $('buffered').textContent = model.buffered;
  $('wip').textContent = m.wip; $('throughput').textContent = m.throughputPerHour.toFixed(1); $('cycle').textContent = Math.round(m.avgCycle); $('review-q').textContent = m.stations.find(s => s.id === 'review').queued;
  const nextName = { Day: 'Swing', Swing: 'Night', Night: 'Day' }, prevName = { Day: 'Night', Swing: 'Day', Night: 'Swing' };
  $('shift').textContent = sh.changing ? (sh.arriving !== null ? `Shift change · ${nextName[sh.name]} arriving` : `Shift change · ${prevName[sh.name]} heading home`) : `${sh.name} shift · change in ${Math.floor(sh.minutesToChange / 60)}h ${String(sh.minutesToChange % 60).padStart(2, '0')}m`;
  for (const r of [1, 2, 3]) $(`rev-${r}`).classList.toggle('on', model.floor.reviewers === r);
  document.querySelectorAll('[data-rev]').forEach(b => b.classList.toggle('on', Number(b.dataset.rev) === model.floor.reviewers));
  document.querySelectorAll('[data-stations]').forEach(b => { const [stage, n] = b.dataset.stations.split(':').map(Number); b.classList.toggle('on', pm.machines[stage] === n); });
  document.querySelectorAll('[data-mirror]').forEach(e => { e.textContent = $(e.dataset.mirror).textContent; });
  const status = []; if (!model.internet) status.push('Internet down: research and planning agents and the clinic admin desk wait on the model API; machines buffer reports.'); if (!model.positioning) status.push('RTK correction lost: harvesting stops by policy; an already-dispatched grain load can finish, but the harvester generates no new loads.'); if (!model.modelApi) status.push('Model API down: research and planning agents and the clinic admin desk wait; execution and review keep working their queues.'); if (!model.reviewer) status.push('Reviewers away: finished agent work piles up waiting for review; the agents keep producing.'); if (!model.power) status.push(`Power out: dock, plant, co-op, agents and the cell site hold; the water tower carries demand (${Math.round(model.water.level)}%).`);
  $('scenario').textContent = status.length ? status.join(' ') : 'All services up. Watch where work waits.'; $('scenario').classList.toggle('warning', status.length > 0);
  const banner = []; if (!model.internet) banner.push('INTERNET DOWN'); if (!model.positioning) banner.push('RTK LOST'); if (!model.power) banner.push('POWER OUT'); if (!model.modelApi) banner.push('MODEL API DOWN'); if (!model.reviewer) banner.push('REVIEWERS AWAY');
  $('outage-banner').hidden = !banner.length; $('outage-banner').textContent = banner.join(' · ');
  for (const k of ['internet', 'positioning', 'power']) { $(k).checked = model[k]; $(`svc-${k}`).classList.toggle('off', !model[k]); $(`svc-${k}`).setAttribute('aria-pressed', String(model[k])); }
  $('svc-water').textContent = `Water ${Math.round(model.water.level)}%`; $('svc-water').classList.toggle('off', model.water.pressure !== 'normal'); $('svc-water').setAttribute('aria-label', `Water tower: ${model.water.pressure}, ${Math.round(model.water.level)}% full. Activate to inspect.`);
  $('event-log').replaceChildren(...model.events.slice(0, 5).map(e => { const div = document.createElement('div'); div.className = 'live-row'; const time = document.createElement('time'); time.textContent = clock(e.time); div.append(time, document.createTextNode(e.text)); return div; }));
  updateInspector(); updateHoverTag(); renderObservability();
}
function resize() { if (!renderer) return; const w = host.clientWidth, h = host.clientHeight, aspect = w / h, half = Math.max(30, 56 / aspect); camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half; camera.near = -200; camera.far = 600; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); draw(0); }

function draw(dt = 0) {
  if (!renderer) return;
  animT += dt;
  const smooth = Math.max(0, model.remainder), T = model.time + smooth;
  const fieldT = model.fieldTime + (model.positioning ? smooth : 0), roadT = model.roadTime + smooth;
  move('tractor', fieldPath.map(([x, z]) => [x, -30 + (z + 30) * .46]), (fieldT / P.fieldCircuit) % 1);
  move('harvester', fieldPath.map(([x, z]) => [x, -18.5 + (z + 30) * .4]), (fieldT / 180 + .45) % 1);
  move('autovan', shuttleRoute, shuttleState(roadT).frac);
  for (const c of traffic) { // Harbor St traffic stops where it is while the review spill blocks the street, then resumes
    const f = (roadT / c.period + c.phase) % 1;
    if (c.street === 'harbor' && model.blocked) { if (c.held === null) c.held = f; move(c.id, c.route, c.held); }
    else { if (c.held !== null) { c.phase = (c.phase + c.held - f + 1) % 1; c.held = null; } move(c.id, c.route, (roadT / c.period + c.phase) % 1); } }
  cones.forEach(k => { k.visible = model.blocked; });
  // Shrimp boats: berth ⇄ harbor mouth ⇄ their own fishing ground; trawl in slow loops while out.
  model.fish.boats.forEach((b, i) => {
    const g = trawlers[i], bx = 23 + i * 4.6, berth = [bx, 54.6], ground = [8 + i * 22, 76], k = Math.min(1, (b.elapsed + smooth) / (b.phase === 'out' ? FISH.trawl : b.phase === 'docked' ? FISH.docked : b.phase === 'unloading' ? FISH.unload : FISH.run));
    const route = [berth, [bx, 59], [36, 60.8], [36, 66.5], ground];
    if (b.phase === 'leaving' || b.phase === 'returning') { const [x, z, a] = boats.along(b.phase === 'leaving' ? route : [...route].reverse(), k); g.position.set(x, -.2, z); g.rotation.y = a; }
    else if (b.phase === 'out') { const ang = k * Math.PI * 4 + i; g.position.set(ground[0] + Math.cos(ang) * 5, -.2, ground[1] + Math.sin(ang) * 3); g.rotation.y = -ang; }
    else { g.position.set(berth[0], -.2, berth[1]); g.rotation.y = Math.PI; }
  });
  fishBoxes.forEach((f, k) => { f.visible = k < Math.min(12, model.fish.store); f.material = mat(model.fish.temp > FISH.spoilAt ? C.red : 0xdbe8ee); });
  model.trucks.forEach((t, i) => {
    const id = t.id; vehicleMeshes[id].visible = t.phase !== 'offsite';
    const held = model.blocked && ((t.phase === 'inbound' && t.elapsed === 2) || (t.phase === 'outbound' && t.elapsed === 9));
    const k = (t.elapsed + ((t.phase === 'unloading' && !model.power) || held ? 0 : smooth)) / P.transit;
    if (t.phase === 'inbound') { if (k < .72) move(id, truckIn(i), inboundFrac(i, k)); else if (k < .82) place(id, BAYS[i], LANE_IN, Math.PI / 2 + (k - .72) / .1 * Math.PI / 2); else place(id, BAYS[i], LANE_IN + (BAY_Z - LANE_IN) * (k - .82) / .18, Math.PI); }
    else if (t.phase === 'unloading') place(id, BAYS[i], BAY_Z, Math.PI);
    else if (t.phase === 'outbound') move(id, truckOut(i), Math.min(1, k));
  });
  const ct = model.coop.truck, gk = (ct.elapsed + smooth) / COOP.haul;
  if (ct.phase === 'field') place('graintruck', ...grainRoute[0], -Math.PI / 2); else if (ct.phase === 'dumping') place('graintruck', ...grainRoute.at(-1), -Math.PI / 2);
  else if (ct.phase === 'to-coop') move('graintruck', grainRoute, Math.min(1, gk)); else move('graintruck', [...grainRoute].reverse(), Math.min(1, gk));
  placePeople(); moveWalkers();
  boats.forEach((b, i) => { b.rotation.z = Math.sin(animT * .8 + i) * .04; }); sailBoats(T);
  const pm = model.plant.metrics();
  plantPools.forEach((pool, i) => pool.forEach((c, k) => { c.visible = k < pm.queues[i]; c.material = mat(!model.power ? OFF : i === pm.constraint && k >= 4 ? 0xf1dcc7 : C.white); }));
  paintBooth2.visible = pm.machines[1] > 1; assembly2.visible = pm.machines[3] > 1;
  rackBikes.forEach((b, k) => { b.visible = k < pm.completed % 9; }); storeBikes.forEach((b, k) => { b.visible = k < Math.min(5, model.storeStock); });
  dockCrates.forEach((c, k) => { c.visible = k < model.inventory + (model.trucks.some(t => t.phase === 'unloading') ? 2 : 0); });
  bagStack.forEach((b, k) => { b.visible = k < Math.min(12, model.coop.milled); });
  tankMark.position.y = 10 + 3.4 * model.water.level / 100; tankMark.material.color.setHex(model.water.pressure === 'normal' ? C.water : C.red);
  stationAgents.clinic.userData.screen.material = mat(model.online && model.modelApi ? 0x7fb2d9 : OFF);
  for (const s of STATIONS) { const a = s.id === 'approve' ? stationAgents.approve : stationAgents[s.id]; const ok = s.needs.every(n => model[n]), st = station(s.id); if (s.id === 'review') continue;
    a.userData.screen.material = mat(!ok ? OFF : st.working ? 0x7fb2d9 : 0xe4e9ed); if (a.userData.visor) a.userData.visor.material = mat(ok && st.working ? 0xb9a8ff : 0x59606a); }
  // Reviewers: the model only counts them and gives each task a fixed 6-minute review. The lean and reach are illustration.
  { const st = station('review'), ok = model.power && model.reviewer; [stationAgents.review, reviewer2, reviewer3].forEach((r, i) => { const busy = ok && st.working > i, u = r.userData;
    // checking: head and body bent over the sheet, left hand steadies the page, right hand reaches across it and ticks
    u.upper.rotation.x = busy ? .46 + .03 * Math.sin(animT * 2 + i) : 0; u.arms[0].rotation.x = busy ? -1.05 : 0; u.arms[0].rotation.z = busy ? -.18 : 0;
    u.arms[1].rotation.x = busy ? -1.3 + .1 * Math.sin(animT * 3 + i) : 0; u.arms[1].rotation.z = busy ? .22 * Math.sin(animT * 5 + i) : 0;
    u.glow.visible = ok; u.glow.material.opacity = busy ? .8 : .45; }); }
  for (const k of ['screen', 'visor']) stationAgents.execute2.userData[k].material = stationAgents.execute.userData[k].material;
  reviewer2.visible = model.floor.reviewers >= 2; reviewer3.visible = model.floor.reviewers >= 3;
  stationAgents.beacon.material = mat(model.online ? C.blue : C.red);
  nets.update(model, animT, { power: $('utilities').checked, water: $('utilities').checked, data: $('signals').checked, rtk: $('signals').checked });
  syncTokens(dt);
  if (spin) { // turntable orbit around the current target, eased, by an absolute amount of degrees
    spin.t += dt; const k = Math.min(1, spin.t / spin.duration), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, step = (e - spin.done) * spin.deg * Math.PI / 180; spin.done = e;
    const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), step); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); if (k >= 1) spin = null; }
  if (flight) { flight.t += dt; const k = Math.min(1, flight.t / flight.duration), e = k < .5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; const off = camera.position.clone().sub(controls.target); controls.target.lerpVectors(flight.from, flight.to, e); camera.position.copy(controls.target).add(off); camera.zoom = flight.z0 + (flight.z1 - flight.z0) * e; camera.updateProjectionMatrix(); if (k >= 1) flight = null; }
  else if (following && selected && vehicleMeshes[selected]) { const off = camera.position.clone().sub(controls.target); const p = vehicleMeshes[selected].position; controls.target.lerp(new THREE.Vector3(p.x, 0, p.z), 1 - Math.exp(-dt * 4)); camera.position.copy(controls.target).add(off); }
  const wp = selected && (vehicleMeshes[selected]?.position || worldOf(selected));
  focusRing.visible = !!wp; if (wp) { focusRing.position.x = wp.x; focusRing.position.z = wp.z; focusRing.scale.setScalar((vehicleMeshes[selected] ? 1 : 1.8) * (1 + .05 * Math.sin(animT * 4))); }
  const nx = selected && info(selected).next;
  routeLine.visible = !!(nx && wp); if (routeLine.visible) { routeLine.geometry.setFromPoints([new THREE.Vector3(wp.x, .2, wp.z), new THREE.Vector3(nx.at[0], .2, wp.z), new THREE.Vector3(nx.at[0], .2, nx.at[1])]); routeLine.computeLineDistances(); }
  xrayRings.forEach(r => { r.visible = false; });
  if (xray) { let n = 0; for (const id of Object.keys(objects)) { if (n >= xrayRings.length) break; const o = objects[id](); if (!o.deps?.includes(xray)) continue; const p = vehicleMeshes[id]?.position || worldOf(id); if (!p) continue; const r = xrayRings[n++]; r.visible = true; r.position.set(p.x, .2, p.z); r.scale.setScalar((vehicleMeshes[id] ? 1.1 : 2.2) * (1 + .12 * Math.sin(animT * 5 + n))); } }
  renderer.render(scene, camera); placeCallouts();
}

// ---------- Wiring ----------
for (const id of Object.keys(objects)) { const option = document.createElement('option'); option.value = id; option.textContent = objects[id]().title; $('object-select').append(option); }
$('object-select').addEventListener('change', e => select(e.target.value || null));
$('play').addEventListener('click', () => { running = !running; ui(); });
$('step').addEventListener('click', () => { running = false; model.advance(10); ui(); draw(0); });
$('reset').addEventListener('click', () => { model = new District(); for (const [, t] of tokens) tokenGroup.remove(t); tokens.clear(); ui(); draw(0); });
$('inspect-jump').addEventListener('click', () => { const target = $('object-select'); target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); target.focus({ preventScroll: true }); });
for (const key of ['internet', 'power', 'positioning']) { $(key).addEventListener('change', e => { model.setService(key, e.target.checked); ui(); draw(0); }); $(`svc-${key}`).addEventListener('click', () => { model.setService(key, !model[key]); ui(); draw(0); }); }
$('svc-water').addEventListener('click', () => select('waterTower'));
function restoreTracePreview() { setXray(traceSelection); }
document.querySelectorAll('.services [data-xray]').forEach(b => {
  b.addEventListener('pointerenter', () => setXray(b.dataset.xray));
  b.addEventListener('pointerleave', () => { if (document.activeElement !== b) restoreTracePreview(); });
  b.addEventListener('focus', () => setXray(b.dataset.xray));
  b.addEventListener('blur', restoreTracePreview);
});
$('trace-service').addEventListener('change', e => {
  traceSelection = e.target.value || null;
  setXray(traceSelection);
  const label = e.target.selectedOptions[0].textContent;
  $('trace-status').textContent = traceSelection ? `${label} links highlighted. Rings include operational, reporting and context links; inspect the outage response to see what stops. Availability is unchanged.` : 'Dependency trace cleared. Service availability is unchanged.';
});
for (const key of ['signals', 'utilities', 'label-mode']) $(key).addEventListener('change', () => draw(0));
for (const r of [1, 2, 3]) $(`rev-${r}`).addEventListener('click', () => { model.setReviewers(r); ui(); draw(0); });
document.querySelectorAll('[data-rev]').forEach(b => b.addEventListener('click', () => { model.setReviewers(Number(b.dataset.rev)); ui(); draw(0); }));
document.querySelectorAll('[data-stations]').forEach(b => b.addEventListener('click', () => { const [stage, n] = b.dataset.stations.split(':').map(Number); model.setStations(stage, n); ui(); draw(0); }));
$('close-inspector').addEventListener('click', () => select(null));
$('follow').addEventListener('click', () => { following = !following; flight = null; if (following) { camera.zoom = Math.max(camera.zoom, 2.6); camera.updateProjectionMatrix(); } ui(); });
document.querySelectorAll('[data-district]').forEach(b => b.addEventListener('click', () => focusDistrict(b.dataset.district)));
$('zoom-in').addEventListener('click', () => { camera.zoom = Math.min(6, camera.zoom * 1.25); camera.updateProjectionMatrix(); draw(0); });
$('zoom-out').addEventListener('click', () => { camera.zoom = Math.max(.5, camera.zoom / 1.25); camera.updateProjectionMatrix(); draw(0); });
 $('home-view').addEventListener('click', () => focusDistrict('all'));
$('compare').addEventListener('click', () => {
  const runShift = r => { const d = new District(); d.setReviewers(r); d.advance(480); return d.floor.metrics(); };
  const rows = [1, 2, 3].map(r => { const m = runShift(r); return `<tr><td>${r}</td><td>${m.done}</td><td>${m.wip}</td><td>${Math.round(m.avgCycle)} min</td><td>${pct(m.stations.find(s => s.id === 'review').utilization)}</td></tr>`; });
  $('compare-out').innerHTML = `<table><thead><tr><th>Reviewers</th><th>Finished</th><th>Still in system</th><th>Avg completed cycle</th><th>Review busy</th></tr></thead><tbody>${rows.join('')}</tbody></table><p>Same 8-hour shift, all services up, illustrative times. Cycle time includes finished tasks only.</p>`;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') select(null); });

const renderObservability = mountObservability({ getModel: () => model, clock, refresh: () => { ui(); draw(0); } });
try { makeScene(); makeCallouts(); } catch (error) { console.error(error); $('error').hidden = false; }
ui(); draw(0);
function bindScrollCue(frameSelector, rowSelector) {
  const frame = document.querySelector(frameSelector), row = frame.querySelector(rowSelector), cue = frame.querySelector('.scroll-cue');
  const update = () => { cue.hidden = row.scrollWidth <= row.clientWidth + 1 || row.scrollLeft + row.clientWidth >= row.scrollWidth - 2; };
  cue.addEventListener('click', () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = new Set([...row.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(), v = row.getBoundingClientRect(); return r.left >= v.left && r.right <= v.right; }));
    row.scrollBy({ left: Math.max(120, row.clientWidth * .72), behavior: reduced ? 'auto' : 'smooth' });
    setTimeout(() => {
      update();
      if (!cue.hidden) return;
      const next = [...row.querySelectorAll('button')].find(b => { const r = b.getBoundingClientRect(), v = row.getBoundingClientRect(); return !before.has(b) && r.left >= v.left && r.right <= v.right; });
      next?.focus({ preventScroll: true });
    }, reduced ? 0 : 400);
  });
  row.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(row);
  new MutationObserver(update).observe(row, { childList: true, subtree: true, characterData: true });
  update();
}
bindScrollCue('.tabs-frame', '.tabs'); bindScrollCue('.services-frame', '.services');

let last = performance.now(), lastTick = -1; const speedOf = () => Number($('speed').value);
function step(dt) { if (running) { model.advance(dt * speedOf()); if (model.time !== lastTick) { ui(); lastTick = model.time; } } else if (selected) updateInspector(); draw(dt); }
if (CAPTURE) window.__frame = dt => { tour?.update(dt); step(dt); };
else { function frame(now) { const dt = Math.max(0, Math.min((now - last) / 1000, .15)); last = now; if (!document.hidden) { tour?.update(dt); step(dt); } requestAnimationFrame(frame); } requestAnimationFrame(frame); }
document.addEventListener('visibilitychange', () => { last = performance.now(); });
const api = { get model() { return model; }, P, AGENTS: S.agents, select, hover: (id, x, y) => { pointer = { x, y }; setHover(id); }, flyTo, orbit: (deg, duration) => { spin = { deg, duration, t: 0, done: 0 }; }, DISTRICTS, setXray, setRunning: v => { running = v; ui(); }, setService: (k, v) => { model.setService(k, v); ui(); }, setReviewers: r => { model.setReviewers(r); ui(); }, setStations: (s, n) => { model.setStations(s, n); ui(); },
  setSpeed: v => { $('speed').value = String(v); }, follow: v => { following = v; ui(); }, zoomTo: z => { camera.zoom = z; camera.updateProjectionMatrix(); }, el: $, worldToScreen: (x, y, z) => { v3.set(x, y, z).project(camera); return [(v3.x + 1) / 2 * host.clientWidth, (1 - v3.y) / 2 * host.clientHeight]; }, vehicle: id => vehicleMeshes[id].position, host, S };
Object.defineProperties(api, { camera: { get: () => camera }, controls: { get: () => controls }, selected: { get: () => selected }, following: { get: () => following }, running: { get: () => running }, xray: { get: () => xray },
  layers: { get: () => ({ signals: nets.groups.data.visible, utilities: nets.groups.power.visible }) } });
window.__district = api;
const tour = params.has('tour') ? startTour(api) : null;
if (tour) window.__tourDuration = tour.duration;
