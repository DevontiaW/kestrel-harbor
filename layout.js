// Kestrel Harbor site plan. One unit ≈ 4 m. North is -z. Roads carry two lanes (right-hand traffic).
export const ROAD = { width: 6, lane: 1.5, curb: 3 };
export const H = { farm: -40, market: 4, harbor: 28, coast: 44 };   // east-west road centerlines (z)
export const V = { west: -52, mill: -8, plant: 30, east: 50 };       // north-south road centerlines (x)
export const EDGE = { x0: -72, x1: 72, z0: -46, z1: 47 };

export const SITES = {
  field: { x: -31, z: -19, w: 32, d: 22 },
  barn: { x: -42, z: -33.5 }, rtk: { x: -22, z: -34 },
  coop: { x: 9, z: -20 }, cell: { x: 23, z: -34 },
  substation: { x: 40, z: -31 }, waterTower: { x: 40, z: -15 }, pumpHouse: { x: 44.5, z: -8 },
  cloud: { x: 63, z: -26, y: 15 }, exchange: { x: 62, z: -9 },
  clinic: { x: -30, z: 15.5, w: 22, d: 12 }, clinicLot: { x: -45.5, z: 15 }, clinicDoor: { x: -27, z: 23 },
  plant: { x: 11, z: 14.5, w: 28, d: 13 }, plantGate: { x: 23, z: 21.5 },
  ops: { x: 40, z: 13 }, staffLot: { x: 40, z: 22 },
  agents: { x: 62.5, z: 16, w: 17, d: 13 },
  store: { x: 11, z: 36 }, hall: { x: 40, z: 36.5 }, clock: { x: 47, z: 35 },
};
// Plant departments, west to east (x offsets inside the plant), and the two receiving bays on its north face.
export const DEPTS = [{ id: 0, x: -10.5, name: 'CUT & WELD' }, { id: 1, x: -3.5, name: 'PAINT' }, { id: 2, x: 3.5, name: 'WHEELS' }, { id: 3, x: 10.5, name: 'ASSEMBLY' }];
export const BAYS = [SITES.plant.x - 9.5, SITES.plant.x - 4]; // on the plant's south face, off Harbor St
export const AGENT_X = { research: -6, plan: -3, execute: 0, review: 4.2 }; // review desks form a column clear of the intake rack

// Lane helpers: a point on the lane for a given direction of travel.
export const laneH = (zc, dir) => zc + (dir > 0 ? ROAD.lane : -ROAD.lane);   // +x travels on the +z side
export const laneV = (xc, dir) => xc + (dir > 0 ? -ROAD.lane : ROAD.lane);   // +z travels on the -x side

// Clockwise block loop on inner lanes (never meets counter-flow traffic).
export function blockLoop(x0, x1, z0, z1) {
  const a = laneV(x0, -1), b = laneV(x1, 1), c = laneH(z0, 1), d = laneH(z1, -1);
  return [[a, c], [b, c], [b, d], [a, d], [a, c]];
}
// Counter-clockwise loop on outer lanes around a larger rectangle (used by the shuttle).
export function outerLoop(x0, x1, z0, z1) {
  const a = laneV(x0, 1), b = laneV(x1, -1), c = laneH(z0, -1), d = laneH(z1, 1);
  return [[a, c], [a, d], [b, d], [b, c], [a, c]];
}
