// Engineered utility networks for the district.
// Power: overhead feeders on joint-use poles along road edges, with service drops to each building.
// Data: fiber lashed under the power conductors on the same poles; a cell tower and an RTK base talk by radio.
// Water: buried mains along the opposite road edge, hydrants, laterals; pressure comes from the elevated tank.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITES as S, H, V } from './layout.js';

const OFF = 3.6; // utilities sit just behind the curb
const POWER_Y = 5.4, FIBER_Y = 4.5;
// Feeder routes (polylines on the ground plane, x/z).
const FEEDERS = [
  [[S.substation.x - 4, S.substation.z], [V.plant + OFF, S.substation.z], [V.plant + OFF, H.market - OFF]],
  [[V.plant + OFF, H.market - OFF], [V.west + 4, H.market - OFF]],
  [[V.plant + OFF, H.market - OFF], [68, H.market - OFF]],
  [[V.plant + OFF, H.market - OFF], [V.plant + OFF, H.harbor - OFF], [V.west + 4, H.harbor - OFF]],
  [[V.plant + OFF, H.harbor - OFF], [68, H.harbor - OFF]],
  [[V.mill - OFF, H.market - OFF], [V.mill - OFF, H.farm + OFF], [V.west + 4, H.farm + OFF]],
];
// Service drops: [feeder point nearest the building is found automatically] → building attachment (x, y, z).
const DROPS = {
  clinic: [S.clinic.x + 3, 3.6, S.clinic.z - S.clinic.d / 2], plant: [S.plant.x, 4.2, S.plant.z - S.plant.d / 2], plant2: [S.plant.x + 9, 4.2, S.plant.z - S.plant.d / 2],
  coop: [S.coop.x - 6, 5, S.coop.z + 4], ops: [S.ops.x, 4.5, S.ops.z - 5], agents: [S.agents.x - 4, 3.8, S.agents.z - S.agents.d / 2],
  pump: [S.pumpHouse.x - 1.5, 2.4, S.pumpHouse.z], cell: [S.cell.x + 1, 2.5, S.cell.z + 1], exchange: [S.exchange.x, 2.6, S.exchange.z + 1.5],
  barn: [S.barn.x, 3, S.barn.z + 2], rtk: [S.rtk.x, 1.5, S.rtk.z + .8], store: [S.store.x, 3.4, S.store.z - 3], hall: [S.hall.x, 4, S.hall.z - 3],
};
const FIBER_DROPS = ['clinic', 'plant', 'ops', 'agents', 'cell', 'exchange', 'coop'];
const MAINS = [
  [[S.waterTower.x, S.waterTower.z], [V.plant - OFF, S.waterTower.z], [V.plant - OFF, H.market + OFF]],
  [[V.plant - OFF, H.market + OFF], [V.west + 4, H.market + OFF]], [[V.plant - OFF, H.market + OFF], [68, H.market + OFF]],
  [[V.plant - OFF, H.market + OFF], [V.plant - OFF, H.harbor + OFF], [V.west + 4, H.harbor + OFF]], [[V.plant - OFF, H.harbor + OFF], [68, H.harbor + OFF]],
  [[V.mill + OFF, H.market + OFF], [V.mill + OFF, H.farm + OFF + 2]],
];
const LATERALS = { clinic: [S.clinic.x - 4, S.clinic.z - S.clinic.d / 2], plant: [S.plant.x - 12, S.plant.z - S.plant.d / 2], ops: [S.ops.x - 3, S.ops.z - 5], agents: [S.agents.x - 6, S.agents.z - S.agents.d / 2],
  store: [S.store.x + 2, S.store.z - 3], coop: [S.coop.x - 6, S.coop.z], irrigation: [S.field.x + S.field.w / 2, S.field.z], hall: [S.hall.x + 2, S.hall.z - 3] };

function polyPoints(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const [a, b] = [poly[i], poly[i + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  out.push(poly.at(-1)); return out;
}
function sagSpan(a, b, y, sag = .45, n = 6) { const pts = []; for (let k = 0; k <= n; k++) { const t = k / n; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, y - sag * 4 * t * (1 - t), a[1] + (b[1] - a[1]) * t)); } return pts; }
function nearest(points, x, z) { let best = points[0], d = Infinity; for (const p of points) { const e = Math.hypot(p[0] - x, p[1] - z); if (e < d) { d = e; best = p; } } return best; }
function lineFrom(points, material) { const g = new THREE.BufferGeometry().setFromPoints(points); const l = new THREE.Line(g, material); if (material.isLineDashedMaterial) l.computeLineDistances(); return l; }
function pathOf(points) { // cumulative-length path for flow dots
  const segs = []; let total = 0;
  for (let i = 0; i < points.length - 1; i++) { const len = points[i].distanceTo(points[i + 1]); segs.push([points[i], points[i + 1], total, len]); total += len; }
  return { at(f, out) { const t = ((f % 1) + 1) % 1 * total; for (const [a, b, s, len] of segs) if (t <= s + len) return out.lerpVectors(a, b, len ? (t - s) / len : 0); return out.copy(points.at(-1)); }, total };
}

export function buildNetworks(scene, { mat: sharedMat, ink, colors: C, movers }) {
  const own = new Map(), mat = c => { if (!own.has(c)) own.set(c, new THREE.MeshBasicMaterial({ color: c, transparent: true })); return own.get(c); }; // private, so x-ray fading never touches buildings
  const groups = { power: new THREE.Group(), data: new THREE.Group(), water: new THREE.Group(), rtk: new THREE.Group() };
  Object.values(groups).forEach(g => scene.add(g));
  const flows = []; // { kind, path, dots[], speed, active() }
  const wireMat = { power: new THREE.LineBasicMaterial({ color: 0x3d4440, transparent: true, opacity: .85 }), data: new THREE.LineBasicMaterial({ color: C.blue, transparent: true, opacity: .8 }),
    water: new THREE.LineDashedMaterial({ color: C.water, dashSize: .9, gapSize: .45, transparent: true, opacity: .9 }), rtk: new THREE.LineDashedMaterial({ color: C.violet, dashSize: .6, gapSize: .5, transparent: true, opacity: .75 }),
    radio: new THREE.LineDashedMaterial({ color: C.blue, dashSize: .6, gapSize: .5, transparent: true, opacity: .7 }) };
  const dotGeo = new THREE.SphereGeometry(.2, 8, 6);
  const addFlow = (kind, group, points, n, speed, color) => { const path = pathOf(points), dots = []; for (let i = 0; i < n; i++) { const d = new THREE.Mesh(dotGeo, mat(color)); group.add(d); dots.push(d); } const f = { kind, path, dots, speed, phase: (flows.length * .37) % 1 }; flows.push(f); return f; };

  // ---- Power and fiber on joint-use poles ----
  const poleGeos = [], polePoints = [];
  const POLE = new THREE.CylinderGeometry(.08, .11, POWER_Y + .2, 6).translate(0, (POWER_Y + .2) / 2, 0), ARM = new THREE.BoxGeometry(1.5, .1, .12);
  FEEDERS.forEach(feeder => {
    const pts = polyPoints(feeder, 8);
    pts.forEach(([x, z], i) => {
      if (!polePoints.some(p => Math.hypot(p[0] - x, p[1] - z) < 1)) { polePoints.push([x, z]); poleGeos.push(POLE.clone().translate(x, 0, z));
        const dx = (pts[i + 1] || pts[i - 1])[0] - x, dz = (pts[i + 1] || pts[i - 1])[1] - z, ang = Math.atan2(dx, dz);
        poleGeos.push(ARM.clone().rotateY(ang + Math.PI / 2).translate(x, POWER_Y, z)); }
    });
    const conductor = [], fiber = [];
    for (let i = 0; i < pts.length - 1; i++) { conductor.push(...sagSpan(pts[i], pts[i + 1], POWER_Y)); fiber.push(...sagSpan(pts[i], pts[i + 1], FIBER_Y, .3)); }
    groups.power.add(lineFrom(conductor, wireMat.power)); groups.data.add(lineFrom(fiber, wireMat.data));
    addFlow('power', groups.power, conductor, Math.max(2, Math.round(pathOf(conductor).total / 14)), 9, C.amber);
  });
  scene.add(new THREE.Mesh(mergeGeometries(poleGeos.map(g => g.index ? g.toNonIndexed() : g)), sharedMat(0x6e6a60)));
  const drop = (id, y, material, kind, color) => { const [x, yy, z] = DROPS[id], p = nearest(polePoints, x, z), pts = sagSpan([p[0], p[1]], [x, z], y, .5, 8); pts.at(-1).y = yy; const g = kind === 'data' ? groups.data : groups.power; g.add(lineFrom(pts, material)); addFlow(kind, g, pts, 1, 4, color); };
  for (const id of Object.keys(DROPS)) drop(id, POWER_Y, wireMat.power, 'power', C.amber);
  for (const id of FIBER_DROPS) drop(id, FIBER_Y, wireMat.data, 'data', C.blue);

  // ---- Water: buried mains (dashed on the ground), hydrants, laterals ----
  const hydrants = [], HYD = new THREE.CylinderGeometry(.22, .26, .8, 8).translate(0, .4, 0);
  MAINS.forEach(main => {
    const pts = polyPoints(main, 2).map(([x, z]) => new THREE.Vector3(x, .07, z));
    groups.water.add(lineFrom(pts, wireMat.water)); addFlow('water', groups.water, pts, Math.max(2, Math.round(pathOf(pts).total / 18)), 4.5, C.water);
    polyPoints(main, 14).slice(1).forEach(([x, z]) => hydrants.push(HYD.clone().translate(x + .6, 0, z + .6)));
  });
  groups.water.add(new THREE.Mesh(mergeGeometries(hydrants), new THREE.MeshLambertMaterial({ color: 0x4f9a93, transparent: true })));
  for (const [, [x, z]] of Object.entries(LATERALS)) {
    let best = null, bd = Infinity; for (const main of MAINS) for (const p of polyPoints(main, 1)) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = p; } }
    const pts = [new THREE.Vector3(best[0], .07, best[1]), new THREE.Vector3(x, .07, best[1]), new THREE.Vector3(x, .07, z)];
    groups.water.add(lineFrom(pts, wireMat.water)); addFlow('water', groups.water, pts, 1, 2.5, C.water);
  }
  // Supply riser from the pump house up to the tank.
  const riser = [new THREE.Vector3(S.pumpHouse.x, .5, S.pumpHouse.z), new THREE.Vector3(S.waterTower.x + 1, .5, S.pumpHouse.z), new THREE.Vector3(S.waterTower.x + 1, 10, S.waterTower.z)];
  groups.water.add(lineFrom(riser, new THREE.LineBasicMaterial({ color: C.water }))); const pumpFlow = addFlow('pump', groups.water, riser, 2, 3, C.water);

  // ---- Radio: cell tower to vehicles, RTK base to field machines, exchange to the internet ----
  const arcs = [];
  const arc = (kind, group, from, to, color, lift = 5) => { const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 17 }, () => new THREE.Vector3())), kind === 'rtk' ? wireMat.rtk : wireMat.radio); group.add(line); const dot = new THREE.Mesh(dotGeo, mat(color)); group.add(dot); arcs.push({ kind, line, dot, from, to, lift }); };
  const cellTop = () => new THREE.Vector3(S.cell.x, 14.5, S.cell.z), rtkTop = () => new THREE.Vector3(S.rtk.x, 3.6, S.rtk.z);
  for (const id of ['tractor', 'harvester', 'autovan', 'graintruck']) arc('data', groups.data, cellTop, movers(id, 2.8), C.blue, 6);
  for (const id of ['tractor', 'harvester']) arc('rtk', groups.rtk, rtkTop, movers(id, 2.6), C.violet, 3);
  arc('data', groups.data, () => new THREE.Vector3(S.exchange.x, 3, S.exchange.z), () => new THREE.Vector3(S.cloud.x, S.cloud.y - 1.5, S.cloud.z), C.blue, 2);
  arc('data', groups.data, cellTop, () => new THREE.Vector3(S.exchange.x, 3, S.exchange.z), C.blue, 4);
  // Human approval: the agent floor asks the ops office (information link, drawn as an ink arc).
  arc('approval', groups.data, () => new THREE.Vector3(S.agents.x - 5, 3, S.agents.z), () => new THREE.Vector3(S.ops.x, 3, S.ops.z), ink, 4);

  const tmp = new THREE.Vector3();
  return {
    groups,
    update(model, t, layers) {
      const on = { power: model.power, data: model.online, water: model.water.level > 0, pump: model.power, rtk: model.positioning, approval: model.power };
      for (const f of flows) { const live = on[f.kind]; f.dots.forEach((d, i) => { d.visible = live; if (live) f.path.at(f.phase + t * f.speed / f.path.total + i / f.dots.length, d.position); }); }
      wireMat.power.color.setHex(model.power ? 0x3d4440 : C.red); wireMat.power.opacity = model.power ? .85 : .5;
      wireMat.data.color.setHex(model.online ? C.blue : C.red); wireMat.radio.color.setHex(model.online ? C.blue : C.red); wireMat.radio.opacity = model.online ? .7 : .25;
      wireMat.water.color.setHex(model.water.pressure === 'normal' ? C.water : C.red); wireMat.rtk.color.setHex(model.positioning ? C.violet : C.red); wireMat.rtk.opacity = model.positioning ? .75 : .2;
      for (const a of arcs) {
        const p = a.from(), q = a.to(), pts = a.line.geometry.attributes.position, live = a.kind === 'rtk' ? model.positioning : a.kind === 'approval' ? model.power : model.online;
        for (let k = 0; k <= 16; k++) { const s = k / 16; tmp.lerpVectors(p, q, s); tmp.y += Math.sin(Math.PI * s) * a.lift; pts.setXYZ(k, tmp.x, tmp.y, tmp.z); }
        pts.needsUpdate = true; a.line.computeLineDistances(); a.line.geometry.computeBoundingSphere();
        a.dot.visible = live; if (live) { const s = (t * .6 + arcs.indexOf(a) * .17) % 1; a.dot.position.lerpVectors(p, q, s); a.dot.position.y += Math.sin(Math.PI * s) * a.lift; }
      }
      pumpFlow.dots.forEach(d => { d.visible = model.power; });
      for (const [k, g] of Object.entries(groups)) g.visible = layers[k] !== false;
    },
    setXray(kind) { // fade every network except the one being inspected
      const map = { power: 'power', internet: 'data', positioning: 'rtk', water: 'water' };
      for (const [k, g] of Object.entries(groups)) g.traverse(o => { if (o.material) { o.material.transparent = true; if (o.userData.baseOpacity === undefined) o.userData.baseOpacity = o.material.opacity; o.material.opacity = !kind || map[kind] === k ? o.userData.baseOpacity : .06; } });
    },
  };
}
