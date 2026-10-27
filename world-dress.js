// Static set dressing for the district: terrain, mountains, coast, town, trees, fences.
// Everything here is merged into a handful of meshes so hundreds of objects cost a few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITES as S, H, V } from './layout.js';

// Deterministic pseudo-random numbers so every load (and every recorded frame) looks identical.
export function rng(seed = 7) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

class Batch {
  constructor() { this.fills = new Map(); this.edges = []; }
  add(geo, x, y, z, color, { ry = 0, edges = true, sx = 1, sy = 1, sz = 1 } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
    const g = geo.clone().applyMatrix4(m); g.deleteAttribute('uv');
    if (!this.fills.has(color)) this.fills.set(color, []);
    this.fills.get(color).push(g);
    if (edges) this.edges.push(new THREE.EdgesGeometry(geo, 25).applyMatrix4(m));
  }
  build(parent, edgeMaterial, matFor) {
    for (const [color, list] of this.fills) parent.add(new THREE.Mesh(mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g)), matFor(color)));
    if (this.edges.length) parent.add(new THREE.LineSegments(mergeGeometries(this.edges), edgeMaterial));
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
const ICO = new THREE.IcosahedronGeometry(1, 0);
const TRUNK = new THREE.CylinderGeometry(.09, .12, 1, 5).translate(0, .5, 0);
const CONE = new THREE.ConeGeometry(1, 2.4, 6).translate(0, 1.2, 0);
const ROOF = (() => { // gable prism, width 1, depth 1, height .55
  const s = new THREE.Shape([new THREE.Vector2(-.5, 0), new THREE.Vector2(.5, 0), new THREE.Vector2(0, .55)]);
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -.5);
})();

export function dressWorld(scene, { C, edgeMaterial, matFor, keepOut }) {
  const rand = rng(11), batch = new Batch(), lines = [];
  const free = (x, z, pad = 0) => !keepOut.some(([x0, z0, x1, z1]) => x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad);
  const tree = (x, z, s = 1, kind = 'round') => {
    batch.add(TRUNK, x, 0, z, C.edge, { sy: 1.6 * s, edges: false });
    if (kind === 'pine') batch.add(CONE, x, 1.1 * s, z, rand() > .5 ? 0xbfcdc6 : 0xb1c2bb, { sx: .9 * s, sy: s, sz: .9 * s });
    else batch.add(ICO, x, 2.3 * s, z, [0xd3ddd6, 0xc6d3cc, 0xdbe3de][Math.floor(rand() * 3)], { sx: 1.05 * s, sy: 1.05 * s, sz: 1.05 * s, ry: rand() * 3 });
    shadows.push([x + .4 * s, z + .3 * s, .9 * s]);
  };
  const palm = (x, z) => {
    batch.add(TRUNK, x, 0, z, C.edge, { sy: 3.4, edges: false });
    for (let i = 0; i < 5; i++) batch.add(BOX, x + Math.cos(i * 1.26) * .7, 3.3, z + Math.sin(i * 1.26) * .7, 0xc6d3cc, { sx: 1.5, sy: .06, sz: .35, ry: -i * 1.26 });
  };
  const shadows = [];

  // Tree clusters: north woodland, west edge, east edge and between buildings.
  const clusters = [[-64, -30, 8, 40, 'pine'], [-64, -6, 7, 30, 'round'], [-64, 18, 7, 26, 'round'], [-64, 38, 6, 16, 'pine'],
    [62, -34, 8, 30, 'pine'], [66, -16, 6, 22, 'round'], [56, -18, 4, 10, 'round'], [20, -6, 5, 14, 'round'], [-2, -34, 5, 10, 'pine'],
    [-36, -44.5, 30, 22, 'pine'], [20, -44.5, 40, 26, 'pine'], [44, 22, 3, 5, 'round'], [-20, 36, 4, 8, 'round'], [28, 36, 3, 6, 'round']];
  for (const [cx, cz, r, n, kind] of clusters) for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * (cz < -43 ? .1 : .8);
    if (x > -71 && x < 71 && z > -46 && z < 46 && free(x, z, 1.2)) tree(x, z, .7 + rand() * .55, kind);
  }
  // Street trees behind the sidewalks; lamps and palms on the coast promenade.
  for (let x = -68; x <= 68; x += 9) for (const z of [H.market - 4.8, H.market + 4.8, H.harbor - 4.8, H.harbor + 4.8]) if (free(x, z, .6) && rand() > .3) tree(x, z, .6);
  for (let x = -68; x <= 68; x += 9) { batch.add(TRUNK, x, 0, 41.2, C.edge, { sy: 4.2, sx: .5, sz: .5, edges: false }); batch.add(BOX, x + .35, 4.1, 41.2, C.white, { sx: .9, sy: .12, sz: .25 }); }
  for (let x = -66; x <= 66; x += 6) if (free(x + 2, 47.6)) palm(x + 2, 47.6);

  // Town between the south road and the coast road: gable houses with yards, plus a market hall.
  const houseXs = [-47, -41.5, -36, -30.5, -25, -19.5, -14, -3, 2, 21, 26, 56, 61.5, 67];
  houseXs.forEach((x, i) => {
    const z = 36.5 + (i % 2) * .8, ry = (i % 3 === 1) ? Math.PI / 2 : 0;
    if (!free(x, z)) return;
    batch.add(BOX, x, 0, z, [0xf7f9fa, 0xeef2f5, 0xf3f6f7, 0xe9eef2][i % 4], { sx: 3.4, sy: 2.1, sz: 3 });
    batch.add(ROOF, x, 2.1, z, [0xb9c5cf, 0xa7b5c1, 0xc8d1d8, 0x9aa9b6][(i * 3) % 4], { sx: 3.6, sy: 2.2, sz: 3.2, ry });
    batch.add(BOX, x + .9, 0, z - 1.51, 0xd6ddd6, { sx: .7, sy: 1.2, sz: .04, edges: false });
    lines.push([[x - 2.4, .05, z - 2.4], [x + 2.4, .05, z - 2.4], [x + 2.4, .05, z + 2.4], [x - 2.4, .05, z + 2.4], [x - 2.4, .05, z - 2.4]]);
  });
  batch.add(BOX, S.hall.x, 0, S.hall.z, C.white, { sx: 10, sy: 4.2, sz: 6 }); batch.add(ROOF, S.hall.x, 4.2, S.hall.z, 0xa7b5c1, { sx: 10.4, sy: 3, sz: 6.4, ry: 0 });
  for (let i = 0; i < 6; i++) batch.add(BOX, S.hall.x - 4 + i * 1.6, 1.2, S.hall.z - 3.02, 0xd8e2db, { sx: .9, sy: 1.6, sz: .04, edges: false });
  batch.add(BOX, S.clock.x, 0, S.clock.z, C.white, { sx: 2, sy: 9, sz: 2 }); batch.add(CONE, S.clock.x, 9, S.clock.z, 0xb9c5cf, { sx: 1.5, sy: .9, sz: 1.5 });
  for (const [dx, dz] of [[0, -1.01], [-1.01, 0]]) { const r = new THREE.Mesh(new THREE.RingGeometry(.45, .6, 24), matFor(0x2b302d)); r.position.set(S.clock.x + dx, 7.4, S.clock.z + dz); r.lookAt(S.clock.x + dx * 2, 7.4, S.clock.z + dz * 2); scene.add(r); }

  // Fences: dock yard and substation yard.
  const fence = pts => { lines.push(pts.map(([x, z]) => [x, .9, z])); for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2.5); for (let k = 0; k <= n; k++) batch.add(BOX, a[0] + (b[0] - a[0]) * k / n, 0, a[1] + (b[1] - a[1]) * k / n, C.edge, { sx: .1, sy: .9, sz: .1, edges: false }); } };
  fence([[S.substation.x - 7, S.substation.z - 6], [S.substation.x + 7, S.substation.z - 6], [S.substation.x + 7, S.substation.z + 6], [S.substation.x - 7, S.substation.z + 6], [S.substation.x - 7, S.substation.z - 6]]);

  batch.build(scene, edgeMaterial, matFor);

  // Soft contact shadows under trees: one merged disc layer.
  const discs = shadows.map(([x, z, r]) => new THREE.CircleGeometry(r, 10).rotateX(-Math.PI / 2).translate(x, .03, z));
  scene.add(new THREE.Mesh(mergeGeometries(discs), new THREE.MeshBasicMaterial({ color: 0xc9d3d6, transparent: true, opacity: .55, depthWrite: false })));
  for (const pts of lines) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p))), edgeMaterial));

  // Coast: open water, a marina with breakwaters, floating docks and slips; moored and moving boats.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(170, 40), new THREE.MeshBasicMaterial({ color: 0x9fc2d1 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -.3, 67); scene.add(water);
  for (let i = 0; i < 22; i++) { const z = 50 + i * 1.6, w = 4 + rand() * 9, x = -80 + rand() * 160; scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -.25, z), new THREE.Vector3(x + w, -.25, z)]), new THREE.LineBasicMaterial({ color: 0xc4d8df }))); }
  const M = { x0: 20, x1: 48, z0: 47.5, z1: 63, mouth: 36 }; // harbor basin; mouth on the south breakwater
  const marina = new Batch();
  marina.add(BOX, M.x0 - 1, -.6, (M.z0 + M.z1) / 2, 0xd9ddd8, { sx: 2, sy: 1.1, sz: M.z1 - M.z0 + 2 });            // west breakwater
  marina.add(BOX, M.x1 + 1, -.6, (M.z0 + M.z1) / 2, 0xd9ddd8, { sx: 2, sy: 1.1, sz: M.z1 - M.z0 + 2 });            // east breakwater
  marina.add(BOX, (M.x0 + M.mouth - 3) / 2, -.6, M.z1 + 1, 0xd9ddd8, { sx: M.mouth - 3 - M.x0 + 2, sy: 1.1, sz: 2 }); // south arms leave a mouth
  marina.add(BOX, (M.mouth + 3 + M.x1) / 2, -.6, M.z1 + 1, 0xd9ddd8, { sx: M.x1 - M.mouth - 3 + 2, sy: 1.1, sz: 2 });
  marina.build(scene, edgeMaterial, matFor);
  const boatGeo = { hull: new THREE.BoxGeometry(1.2, .5, 3.4), sail: new THREE.ConeGeometry(1, 3.4, 3) };
  const makeBoat = () => { const b = new THREE.Group(); for (const [geo, y, sz] of [[boatGeo.hull, .2, 1], [boatGeo.sail, 2.3, .15]]) { const m = new THREE.Mesh(geo, matFor(0xfbfcf9)); m.position.y = y; m.scale.z = sz; m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMaterial)); b.add(m); } scene.add(b); return b; };
  const along = (pts, f) => { const L = []; let T = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(l); T += l; } let t = f * T; for (let i = 0; i < L.length; i++) { if (t <= L[i]) { const k = t / L[i], a = pts[i], b = pts[i + 1]; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]))]; } t -= L[i]; } const e = pts.at(-1); return [e[0], e[1], 0]; };
  const sail = makeBoat(), sailRoute = [[-40, 58], [-10, 70], [10, 78], [-25, 82], [-50, 72], [-40, 58]];
  const boats = [sail];
  const sailBoats = time => { const [x, z, a] = along(sailRoute, ((time / 70) % 1 + 1) % 1); sail.position.set(x, -.25, z); sail.rotation.y = a; };
  boats.along = along;

  // Mountains: a ridged range behind the farm, shaded low-poly with rock and snow, ridge lines inked like the drawing.
  const hills = new THREE.PlaneGeometry(220, 56, 90, 26); hills.rotateX(-Math.PI / 2);
  const p = hills.attributes.position, colors = [];
  const ridge = (x, z) => { let h = 0, amp = 1, f = .028; for (let o = 0; o < 4; o++) { h += amp * (1 - Math.abs(Math.sin(x * f + o * 1.9 + Math.cos(z * f * .7 + o)))); amp *= .5; f *= 2.1; } return h; };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), back = Math.min(1, Math.max(0, (28 - z) / 50));
    const h = Math.max(0, ridge(x, z) * 17 * back ** 1.3 + (Math.sin(x * .05) + 1) * 3 * back - 1.5);
    p.setY(i, h);
  }
  const flat = hills.toNonIndexed(); flat.computeVertexNormals(); const fp = flat.attributes.position;
  for (let i = 0; i < fp.count; i += 3) { const y = (fp.getY(i) + fp.getY(i + 1) + fp.getY(i + 2)) / 3, c = new THREE.Color(y > 11.5 ? 0xffffff : y > 7 ? 0xc8ccc6 : y > 2.5 ? 0xb4bfae : 0xd3dccd); for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b); }
  flat.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); flat.translate(0, -.4, -76);
  scene.add(new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(flat, 28), new THREE.LineBasicMaterial({ color: 0x7f8d81, transparent: true, opacity: .55 })));
  return { boats, sailBoats };
}
