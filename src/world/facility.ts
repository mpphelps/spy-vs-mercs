// MISSION 1 — OBJECT 47 (Ural Mountains). Non-linear compound: multiple entrances (gate,
// culvert crawl, wall breach), keycard-gated areas, a utility tunnel bypass, and a vault.
import * as THREE from 'three';
import { subtractRects } from './level';
import type { Game } from '../game/game';
import type { SpawnDef } from '../game/ai';
import { tex } from '../core/textures';

type R = [number, number, number, number];

export interface MissionLayout {
  start: THREE.Vector3;
  startYaw: number;
  spawns: SpawnDef[];
  extraction: THREE.Vector3;
  reinforcementPoint: THREE.Vector3;
  navBounds: [number, number, number, number, number, number];
}

const PI = Math.PI;

export function buildFacility(g: Game): MissionLayout {
  const L = g.level;
  const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: string, o?: any) => L.box(x0, y0, z0, x1, y1, z1, m, o);

  // ============================================================== footprints
  const barracks: R = [-58, -30, -36, 18];
  const pump: R = [-58, 26, -48, 38];
  const comms: R = [36, -12, 56, 14];
  const secOff: R = [14, -47, 30, -33];
  const lab: R = [-32, -80, 10, -36];
  const booth: R = [5.5, 35.5, 8.5, 38.5];
  const buildings = [barracks, pump, comms, secOff, lab, booth];

  // ============================================================== ground
  const roadRects: R[] = [[-5, -36, 5, 40], [5, -31, 46, -25], [20, -56, 26, -31]];
  const compound: R = [-60, -80, 60, 40];
  for (const r of subtractRects(compound, [...buildings, ...roadRects])) B(r[0], -1, r[1], r[2], 0, r[3], 'snow');
  for (const rr of roadRects) for (const r of subtractRects(rr, buildings)) B(r[0], -1, r[1], r[2], 0, r[3], 'road');
  // approach valley (outside the south wall)
  const approach: R = [-66, 41, 80, 110];
  const approachRoad: R = [-5, 41, 5, 110];
  for (const r of subtractRects(approach, [approachRoad])) B(r[0], -1, r[1], r[2], 0, r[3], 'snow');
  B(approachRoad[0], -1, approachRoad[1], approachRoad[2], 0, approachRoad[3], 'road');
  B(-5, -1, 40, 5, 0, 41, 'road'); // under the gate
  B(-51, -1, 40, -49, 0, 41, 'snow'); // culvert floor through wall
  B(60, -1, 5, 61, 0, 10, 'snow'); // breach floor
  // east corridor outside the east wall
  B(61, -1, -16, 80, 0, 41, 'snow');

  // ============================================================== perimeter wall
  const WH = 6;
  L.wallX(40, 41, -61, 61, 0, WH, [{ at: 0, w: 8, h: WH }, { at: -50, w: 2, h: 0.72 }], 'concrete');
  L.wallX(-81, -80, -61, 61, 0, WH, [], 'concrete');
  L.wallZ(-61, -60, -80, 40, 0, WH, [], 'concrete');
  L.wallZ(60, 61, -80, 40, 0, WH, [{ at: 7.5, w: 5, h: 2.2, y: 0.95 }], 'concrete');
  // wall caps
  B(-61.2, WH, 39.8, 61.2, WH + 0.3, 41.2, 'concrete_dark');
  B(-61.2, WH, -81.2, 61.2, WH + 0.3, -79.8, 'concrete_dark');
  B(-61.2, WH, -80, -59.8, WH + 0.3, 40, 'concrete_dark');
  B(59.8, WH, -80, 61.2, WH + 0.3, 40, 'concrete_dark');
  // breach rubble (mantle up to the hole)
  B(61, 0, 4.5, 63.5, 0.4, 10.5, 'rock');
  B(57.5, 0, 5, 60, 0.5, 10, 'rock');
  rubble(g, 62, 0.6, 7.5, 6);
  rubble(g, 58.5, 0.5, 7.5, 5);
  // gate barrier (crouch under it) + gate posts
  B(-4, 1.25, 40.35, 4, 1.4, 40.6, 'hazard');
  B(-4.6, 0, 40, -4, 7, 41, 'concrete_dark');
  B(4, 0, 40, 4.6, 7, 41, 'concrete_dark');
  L.sign(-8, 4, 41.05, 's', 'ОБЪЕКТ 47', 'ЗАПРЕТНАЯ ЗОНА', 3.2);
  L.sign(9, 3, 41.05, 's', 'СТОЙ!', 'СТРЕЛЯЮТ БЕЗ ПРЕДУПРЕЖДЕНИЯ', 2.4);

  // ============================================================== culvert (prone crawl)
  B(-51.4, 0, 38, -51, 0.95, 49, 'concrete_dark');
  B(-49, 0, 38, -48.6, 0.95, 49, 'concrete_dark');
  B(-51.4, 0.72, 41, -48.6, 1.0, 49, 'concrete_dark');
  B(-54, 0, 48.6, -51.4, 2.4, 49.2, 'concrete');
  B(-48.6, 0, 48.6, -46, 2.4, 49.2, 'concrete');
  B(-51.4, 0.95, 48.6, -48.6, 2.4, 49.2, 'concrete');
  // ditch rocks leading to the culvert
  for (const [x, z, s] of [[-55, 55, 2.5], [-45, 57, 2], [-57, 62, 3], [-43, 64, 2.2], [-52, 70, 1.6]] as const) rockChunk(g, x, z, s);
  L.light(-50, 2.1, 49.6, { color: 0xff9944, intensity: 0.5, range: 6, group: 'gate', fixture: 'lamp', flicker: true });

  // ============================================================== cliffs & scenery
  cliffs(g);
  mountains(g);
  for (const [x, z, s] of [
    [-30, 60, 1], [-36, 78, 1.2], [-22, 92, 0.9], [-44, 96, 1.3], [24, 58, 1.1], [34, 84, 1], [48, 66, 1.3], [58, 92, 1.1], [18, 96, 0.8], [-58, 88, 1.2], [-12, 66, 0.8], [70, 50, 1], [72, 20, 1.1], [66, -5, 0.9], [44, 100, 1.2], [-62, 52, 1.0],
  ] as const) pine(g, x, z, s);
  for (const [x, z, s] of [[-16, 54, 2.2], [14, 62, 2.6], [-28, 74, 3], [30, 72, 2.4], [52, 56, 2], [-8, 84, 1.8], [10, 88, 2.5], [65, 30, 2.5], [70, 0, 2.2], [40, 52, 1.6], [-40, 52, 2]] as const) rockChunk(g, x, z, s);

  // checkpoint on the approach road
  sandbags(g, -7, 69, -4, 70);
  sandbags(g, 4, 69, 7, 70);
  truck(g, 11, 74, 'z');
  B(-9, 0, 71, -7.8, 1.2, 72.2, 'milcrate');
  L.light(-6, 4, 70.5, { color: 0xfff0d0, intensity: 1.4, range: 16, group: 'gate', cone: true, coneRadius: 4, fixture: 'flood' });
  B(-6.1, 0, 70.4, -5.9, 4, 70.6, 'steel');
  L.light(9, 4, 69, { color: 0xfff0d0, intensity: 1.1, range: 14, group: 'gate', cone: true, coneRadius: 3.6, fixture: 'flood' });
  B(8.9, 0, 68.9, 9.1, 4, 69.1, 'steel');

  // ============================================================== gate & guard tower
  L.light(-5.5, 5.5, 41.6, { color: 0xffc070, intensity: 1.3, range: 15, group: 'gate', cone: true, coneRadius: 4 });
  L.light(5.5, 5.5, 41.6, { color: 0xffc070, intensity: 1.3, range: 15, group: 'gate', cone: true, coneRadius: 4 });
  L.light(-5.5, 5.5, 39.4, { color: 0xffc070, intensity: 1.2, range: 14, group: 'gate', cone: true, coneRadius: 4 });
  // booth
  L.building({ name: 'Guard booth', x0: booth[0], z0: booth[1], x1: booth[2], z1: booth[3], h: 2.6, ext: 'metal', int: 'metal', floor: 'plate', roof: 'corrugated', gaps: [{ side: 'w', at: 37, w: 1.2, h: 2.2 }, { side: 's', at: 7, w: 2.2, h: 0.9, y: 1.1 }], t: 0.2 });
  B(7.6, 0, 36, 8.3, 0.9, 38, 'desk');
  L.light(7, 2.4, 37, { color: 0xfff2d0, intensity: 0.6, range: 5, group: 'gate', fixture: 'tube' });
  // tower
  tower(g, -14, 30, 5);
  sandbags(g, -8, 34, -4, 35);

  // ============================================================== courtyard props
  truck(g, 9, 18, 'z');
  truck(g, 26, -2, 'x');
  for (const [x, z, n] of [[-20, 8, 3], [-24, -14, 4], [16, -12, 3], [22, 30, 2], [-30, 26, 3], [32, -20, 2], [-6, -18, 2], [12, 4, 2], [44, -40, 3], [-40, -40, 3], [52, -30, 2]] as const) crateStack(g, x, z, n);
  for (const [x, z] of [[-20, 25], [20, 25], [-22, -6], [18, -6], [0, -30], [-32, -40], [33, -30], [38, -48], [10, -60], [50, -18]] as const) lightPole(g, x, z);
  // vehicle shed (open-sided, gives deep shadow)
  for (const [x, z] of [[-30, -30], [-14, -30], [-30, -20], [-14, -20]] as const) B(x - 0.2, 0, z - 0.2, x + 0.2, 4.2, z + 0.2, 'steel');
  B(-30.5, 4.2, -30.5, -13.5, 4.5, -19.5, 'corrugated');
  B(-30.5, 0, -30.5, -13.5, 4.2, -30.2, 'corrugated');
  truck(g, -22, -25, 'x');
  // fuel tanks
  for (const [x, z] of [[-34, 33], [-30, 34.5]] as const) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4, 12), L.decor('tank'));
    m.rotation.x = PI / 2; m.position.set(x, 1.4, z); m.castShadow = m.receiveShadow = true;
    L.group.add(m);
    B(x - 1.2, 0, z - 2, x + 1.2, 2.6, z + 2, 'tank', { visual: false, surface: 'metal' });
  }
  // radio tower + fence
  radioTower(g, 48, 26);
  // second tower NE
  tower(g, 30, -22, 5);

  // ============================================================== pump house + stairwell
  L.building({ name: 'Pump house', x0: pump[0], z0: pump[1], x1: pump[2], z1: pump[3], h: 3.5, ext: 'concrete_wall', int: 'concrete_dark', noFloor: true, roof: 'corrugated', gaps: [{ side: 'n', at: -50, w: 1.8, h: 2.4 }, { side: 's', at: -50, w: 2, h: 0.72 }] });
  const pumpHole: R = [-57.6, 27, -54, 33];
  for (const r of subtractRects([pump[0], pump[1], pump[2], pump[3]], [pumpHole])) B(r[0], -0.3, r[1], r[2], 0, r[3], 'concrete', { noBottom: true });
  shaft(g, pumpHole, -1, 0);
  railing(g, -54, 27, -54, 33);
  B(-52, 0, 29, -49, 1.6, 31, 'pipe');
  B(-51.5, 1.6, 29.5, -49.5, 2.2, 30.5, 'metal');
  B(-56, 2.6, 34.6, -48.5, 2.9, 34.9, 'pipe');
  B(-49.5, 0, 34, -48.5, 2.9, 35, 'pipe');
  L.light(-53, 3.3, 31, { color: 0xffe0a0, intensity: 0.7, range: 8, group: 'pump', fixture: 'tube', flicker: true });

  // ============================================================== utility tunnels (y = -4)
  L.building({ name: 'Utility tunnel', x0: -58, z0: -45, x1: -53, z1: 34, y0: -4, h: 3, ext: 'concrete_dark', int: 'concrete_dark', floor: 'concrete_dark', noCeil: true, roof: null, gaps: [{ side: 'n', at: -55.5, w: 4.2, h: 2.6 }] });
  for (const r of subtractRects([-57.6, -44.6, -53.4, 33.6], [pumpHole])) B(r[0], -1, r[1], r[2], -0.75, r[3], 'concrete_dark');
  L.stairs(pumpHole[0], pumpHole[1], pumpHole[2], pumpHole[3], -4, 0, 's', 'concrete');
  L.building({ name: 'Utility tunnel', x0: -58, z0: -50, x1: -32, z1: -45, y0: -4, h: 3, ext: 'concrete_dark', int: 'concrete_dark', floor: 'concrete_dark', roof: null, gaps: [{ side: 's', at: -55.5, w: 4.2, h: 2.6 }, { side: 'e', at: -47.5, w: 2.2, h: 2.4 }] });
  // pipes along the tunnel
  B(-53.8, -1.6, -44, -53.4, -1.2, 26, 'pipe');
  B(-57.6, -3.2, -40, -57.2, -2.8, 26, 'pipe');
  for (const z of [20, 6, -8, -22, -36]) L.light(-55.5, -1.2, z, { color: 0xffd890, intensity: 0.55, range: 7, group: 'tunnel', fixture: 'lamp', flicker: z === 6 || z === -22 });
  L.light(-44, -1.2, -47.5, { color: 0xffd890, intensity: 0.55, range: 7, group: 'tunnel', fixture: 'lamp' });
  B(-57.5, -4, 10, -56.3, -2.8, 12, 'milcrate');
  B(-36, -4, -49.5, -34.5, -3, -48, 'crate');

  // ============================================================== barracks
  L.building({ name: 'Barracks', x0: barracks[0], z0: barracks[1], x1: barracks[2], z1: barracks[3], h: 3.6 + 0.0, ext: 'concrete_wall', int: 'concrete_wall', floor: 'woodfloor', roof: 'corrugated', gaps: [{ side: 'e', at: 11, w: 1.8, h: 2.4 }, { side: 'e', at: -5, w: 1.8, h: 2.4 }, { side: 'w', at: 14, w: 1.6, h: 2.4 }] });
  L.wallX(3.85, 4.15, -57.6, -36.4, 0, 3.85, [{ at: -47, w: 1.8, h: 2.4 }], 'concrete_wall');
  L.wallX(-14.15, -13.85, -57.6, -36.4, 0, 3.85, [{ at: -52, w: 1.6, h: 2.4 }, { at: -41, w: 1.6, h: 2.4 }], 'concrete_wall');
  L.wallZ(-47.15, -46.85, -29.6, -14.15, 0, 3.85, [], 'concrete_wall');
  g.addDoor(-36.2, 11, 0, 1.8, 2.4, 'z');
  g.addDoor(-36.2, -5, 0, 1.8, 2.4, 'z');
  g.addDoor(-57.8, 14, 0, 1.6, 2.4, 'z');
  g.addDoor(-41, -14, 0, 1.6, 2.4, 'x', 'blue', 'Armory');
  L.sign(-35.95, 3, 3, 'e', 'КАЗАРМА', 'БАТАЛЬОН ЧЕРНОБОГ', 2);
  // mess hall
  for (const [x, z] of [[-52, 9], [-52, 14], [-44, 9], [-44, 14]] as const) {
    B(x - 1.6, 0.75, z - 0.6, x + 1.6, 0.85, z + 0.6, 'desk');
    B(x - 1.5, 0, z - 0.5, x - 1.3, 0.75, z + 0.5, 'steel', { collide: false });
    B(x + 1.3, 0, z - 0.5, x + 1.5, 0.75, z + 0.5, 'steel', { collide: false });
    B(x - 1.6, 0, z - 0.6, x + 1.6, 0.75, z + 0.6, 'steel', { visual: false });
    B(x - 1.6, 0.4, z - 1.1, x + 1.6, 0.5, z - 0.8, 'desk');
    B(x - 1.6, 0.4, z + 0.8, x + 1.6, 0.5, z + 1.1, 'desk');
  }
  B(-57.6, 0, 15.5, -55, 1.0, 17.6, 'metal');
  for (const z of [8, 14]) L.light(-48, 3.4, z, { color: 0xffe8c0, intensity: 0.75, range: 9, group: 'barracks', fixture: 'tube' });
  // bunks
  for (let i = 0; i < 5; i++) {
    const x = -56 + i * 3.6;
    bunk(g, x, -12.5);
    if (i < 4) bunk(g, x, 2.2);
  }
  for (const z of [-9, -1]) L.light(-47, 3.4, z, { color: 0xffe0b0, intensity: 0.6, range: 9, group: 'barracks', fixture: 'tube' });
  // officer quarters
  B(-57.4, 0, -29.4, -53, 0.85, -27.5, 'desk');
  B(-51.5, 0, -29.4, -48, 0.8, -28, 'desk');
  B(-57.5, 0, -22, -55.5, 0.6, -17, 'bed');
  B(-49.5, 0, -16, -47.5, 2.2, -14.5, 'metal');
  L.light(-52, 3.4, -22, { color: 0xffd8a0, intensity: 0.6, range: 7, group: 'barracks', fixture: 'lamp' });
  // armory
  for (const z of [-28.5, -24, -19.5]) B(-37.2, 0, z - 1.5, -36.5, 2.2, z + 1.5, 'metal');
  B(-45.6, 0, -29.4, -40, 0.9, -28.2, 'steel');
  L.light(-41.5, 3.4, -22, { color: 0xfff0d0, intensity: 0.65, range: 8, group: 'barracks', fixture: 'tube' });

  // ============================================================== comms building
  L.building({ name: 'Comms', x0: comms[0], z0: comms[1], x1: comms[2], z1: comms[3], h: 4.5, ext: 'metal', int: 'metal', floor: 'plate', roof: 'corrugated', gaps: [{ side: 'w', at: -6, w: 1.8, h: 2.4 }, { side: 'w', at: 8, w: 1.8, h: 2.4 }, { side: 'e', at: 8, w: 1.6, h: 2.4 }] });
  L.wallX(0.85, 1.15, 36.4, 55.6, 0, 4.75, [{ at: 46, w: 1.8, h: 2.4 }], 'metal');
  g.addDoor(36.2, -6, 0, 1.8, 2.4, 'z');
  g.addDoor(36.2, 8, 0, 1.8, 2.4, 'z');
  g.addDoor(55.8, 8, 0, 1.6, 2.4, 'z');
  g.addDoor(46, 1, 0, 1.8, 2.4, 'x');
  L.sign(35.75, 3.2, -1, 'w', 'СВЯЗЬ', 'УЗЕЛ СВЯЗИ №3', 2);
  // transmitter room
  for (let i = 0; i < 5; i++) B(42 + i * 2.6, 0, -11.6, 43.8 + i * 2.6, 2.4, -10.6, 'server');
  B(48, 0, -4, 52, 0.9, -2.5, 'metal');
  B(48.5, 0.9, -3.8, 51.5, 1.6, -3.5, 'screen');
  for (const x of [41, 50]) L.light(x, 4.3, -5, { color: 0xc8dcff, intensity: 0.7, range: 9, group: 'comms', fixture: 'tube' });
  // generator room
  B(44, 0, 6, 52, 2.2, 11, 'generator');
  B(52, 0, 9, 55.6, 1.2, 13.6, 'tank');
  L.sign(48, 2.8, 5.9, 'n', 'ОПАСНО', 'ВЫСОКОЕ НАПРЯЖЕНИЕ', 2);
  L.light(40, 4.3, 7.5, { color: 0xfff0c0, intensity: 0.7, range: 10, group: 'comms', fixture: 'tube' });

  // ============================================================== security office
  L.building({ name: 'Security', x0: secOff[0], z0: secOff[1], x1: secOff[2], z1: secOff[3], h: 3.6, ext: 'concrete_wall', int: 'labwall', floor: 'carpet', roof: 'concrete_dark', gaps: [{ side: 's', at: 22, w: 1.8, h: 2.4 }] });
  g.addDoor(22, -33.2, 0, 1.8, 2.4, 'x');
  for (let i = 0; i < 4; i++) B(15 + i * 2.6, 1.0, -46.6, 17.3 + i * 2.6, 2.6, -46.3, 'screen_cam');
  B(15, 0, -45.5, 26, 0.85, -44.2, 'desk');
  B(26.5, 0, -46.5, 29.5, 2, -45.5, 'metal');
  L.light(22, 3.4, -40, { color: 0xe0f0ff, intensity: 0.65, range: 9, group: 'security', fixture: 'tube' });

  // ============================================================== lab (ground floor)
  L.building({ name: 'Laboratory', x0: lab[0], z0: lab[1], x1: lab[2], z1: lab[3], h: 4.5, ext: 'concrete_wall', int: 'labwall', noFloor: true, ceil: 'white', roof: 'concrete_dark', gaps: [{ side: 's', at: -10, w: 2.4, h: 2.8 }, { side: 'e', at: -49, w: 1.8, h: 2.4 }] });
  const labStairs: R = [-31.6, -78, -28, -70];
  for (const r of subtractRects([lab[0], lab[1], lab[2], lab[3]], [labStairs])) B(r[0], -0.3, r[1], r[2], 0, r[3], 'tile', { noBottom: true });
  railing(g, -28, -78, -28, -70);
  B(-31.6, 0, -69.95, -28, 1.0, -69.85, 'steel', { collide: false });
  g.addDoor(-10, -36.2, 0, 2.4, 2.8, 'x', 'blue', 'Laboratory entrance');
  g.labEastDoor = g.addDoor(9.8, -49, 0, 1.8, 2.4, 'z', 'sealed', 'Emergency exit (opens during lockdown)');
  L.sign(-10, 3.6, -35.75, 's', 'ЛАБОРАТОРИЯ', 'НИИ «ВЕСНА»', 2.6);
  // partitions
  const IH = 4.75;
  L.wallX(-46.15, -45.85, -31.6, 9.6, 0, IH, [{ at: -24, w: 1.8, h: 2.4 }, { at: -10, w: 3.2, h: 3 }, { at: 3, w: 1.8, h: 2.4 }], 'labwall');
  L.wallZ(-16.15, -15.85, -45.85, -36.4, 0, IH, [], 'labwall');
  L.wallZ(-4.15, -3.85, -45.85, -36.4, 0, IH, [], 'labwall');
  L.wallX(-52.15, -51.85, -31.6, 9.6, 0, IH, [{ at: -22, w: 1.8, h: 2.4 }, { at: -5, w: 1.8, h: 2.4 }, { at: 6, w: 1.6, h: 2.4 }], 'labwall');
  L.wallZ(-12.15, -11.85, -65.85, -52.15, 0, IH, [], 'labwall');
  L.wallZ(1.85, 2.15, -65.85, -52.15, 0, IH, [], 'labwall');
  L.wallX(-66.15, -65.85, -31.6, 9.6, 0, IH, [{ at: -20, w: 1.8, h: 2.4 }, { at: 6, w: 1.6, h: 2.4 }], 'labwall');
  g.addDoor(-24, -46, 0, 1.8, 2.4, 'x');
  g.addDoor(3, -46, 0, 1.8, 2.4, 'x');
  g.addDoor(-22, -52, 0, 1.8, 2.4, 'x');
  g.addDoor(-5, -52, 0, 1.8, 2.4, 'x', null, 'Server room');
  g.addDoor(6, -52, 0, 1.6, 2.4, 'x');
  g.addDoor(-20, -66, 0, 1.8, 2.4, 'x');
  g.addDoor(6, -66, 0, 1.6, 2.4, 'x');
  // lobby
  B(-13, 0, -42, -7, 1.1, -41, 'desk');
  B(-15.6, 0, -45.6, -14, 1.0, -44, 'crate');
  L.light(-10, 4.3, -41, { color: 0xf0f4ff, intensity: 0.85, range: 10, group: 'lab', fixture: 'tube' });
  // break room
  B(-28, 0.75, -42, -22, 0.85, -40, 'desk');
  B(-28, 0, -42, -22, 0.75, -40, 'steel', { visual: false });
  B(-31.5, 0, -45.6, -29, 1.9, -44.8, 'metal');
  L.light(-24, 4.3, -41, { color: 0xfff0d8, intensity: 0.6, range: 9, group: 'lab', fixture: 'tube' });
  // medbay
  B(4, 0, -45.4, 9.4, 0.9, -44.4, 'white');
  B(-3.4, 0, -40, -1.4, 0.7, -37, 'white');
  L.light(3, 4.3, -41, { color: 0xf0ffff, intensity: 0.75, range: 9, group: 'lab', fixture: 'tube' });
  // corridor
  for (const x of [-26, -14, -2, 6]) L.light(x, 4.3, -49, { color: 0xf0f4ff, intensity: 0.7, range: 8, group: 'lab', fixture: 'tube' });
  L.light(-18, 4.2, -48.6, { color: 0xff2020, intensity: 1, range: 12, group: 'lab', fixture: 'none', breakable: false, stealth: 0 }).alarm = true;
  // Lab A: benches + specimen tanks
  for (const z of [-56, -61]) {
    B(-30, 0, z - 0.6, -22, 0.95, z + 0.6, 'white');
    B(-20, 0, z - 0.6, -14, 0.95, z + 0.6, 'white');
  }
  for (const x of [-30, -26]) glowTank(g, x, -64.5);
  for (const x of [-21, -17]) L.light(x, 4.3, -58.5, { color: 0xf4f8ff, intensity: 0.8, range: 10, group: 'lab', fixture: 'tube' });
  L.light(-28, 4.3, -58.5, { color: 0xf4f8ff, intensity: 0.8, range: 10, group: 'lab', fixture: 'tube' });
  // server room
  for (const z of [-55, -59, -63]) B(-11.5, 0, z - 0.5, -3, 2.3, z + 0.5, 'server');
  B(-1.5, 0, -64, 1.6, 0.9, -62.5, 'metal');
  B(-1.2, 0.9, -63.9, 1.3, 1.6, -63.7, 'screen');
  L.light(-5, 4.3, -59, { color: 0x88b8ff, intensity: 0.7, range: 10, group: 'lab', fixture: 'tube' });
  // director office
  B(3, 0, -62, 8, 0.85, -60.6, 'desk');
  B(8.6, 0, -65.6, 9.6, 2.2, -62, 'woodfloor');
  B(2.6, 0, -55, 4, 1.0, -53, 'carpet');
  L.light(6, 4.2, -58, { color: 0xffe8c0, intensity: 0.6, range: 7, group: 'lab', fixture: 'lamp' });
  // north hall
  for (const [x, z] of [[-10, -77], [-6, -78], [2, -76], [6, -78.5]] as const) B(x - 0.7, 0, z - 0.7, x + 0.7, 1.4, z + 0.7, 'milcrate');
  B(-22, 0, -79.6, -14, 2.6, -78.8, 'metal');
  for (const x of [-20, -4]) L.light(x, 4.3, -72, { color: 0xf0f0ff, intensity: 0.6, range: 9, group: 'lab', fixture: 'tube' });
  L.light(-30, 4.0, -74, { color: 0xffe0b0, intensity: 0.5, range: 7, group: 'lab', fixture: 'lamp' });

  // ============================================================== lab basement (y = -4)
  const BY = -4, BH = 3.5;
  L.building({ name: 'Basement', x0: -32, z0: -60, x1: -20, z1: -44, y0: BY, h: BH, ext: 'concrete_dark', int: 'concrete_dark', floor: 'plate', ceil: 'metal_dark', roof: null, gaps: [{ side: 'w', at: -47.5, w: 2.2, h: 2.4 }, { side: 'n', at: -24, w: 2.2, h: 2.4 }] });
  L.building({ name: 'Basement', x0: -32, z0: -79, x1: -20, z1: -60, y0: BY, h: BH, ext: 'concrete_dark', int: 'concrete_dark', floor: 'plate', noCeil: true, roof: null, gaps: [{ side: 's', at: -24, w: 2.2, h: 2.4 }, { side: 'e', at: -71, w: 2.4, h: 2.6 }] });
  for (const r of subtractRects([-31.6, -78.6, -20.4, -60.4], [labStairs])) B(r[0], BY + BH, r[1], r[2], BY + BH + 0.25, r[3], 'metal_dark');
  L.stairs(labStairs[0], labStairs[1], labStairs[2], labStairs[3], BY, 0, 's', 'plate');
  g.addDoor(-32.2, -47.5, BY, 2.2, 2.4, 'z', null, 'Maintenance');
  g.addDoor(-24, -60, BY, 2.2, 2.4, 'x');
  // maintenance clutter
  B(-31.5, BY, -58, -29, BY + 2, -54, 'generator');
  B(-23, BY, -50, -20.5, BY + 1.2, -45, 'crate');
  B(-31.5, BY + 2.6, -59.5, -20.5, BY + 3, -59.1, 'pipe');
  L.light(-26, BY + 3.3, -52, { color: 0xffd890, intensity: 0.6, range: 9, group: 'basement', fixture: 'tube', flicker: true });
  L.light(-24, BY + 3.3, -66, { color: 0xffe0c0, intensity: 0.6, range: 9, group: 'basement', fixture: 'tube' });
  L.light(-24, BY + 3.3, -75, { color: 0xffe0c0, intensity: 0.6, range: 9, group: 'basement', fixture: 'tube' });
  L.light(-21, BY + 3.2, -68, { color: 0xff2020, intensity: 1, range: 10, group: 'basement', fixture: 'none', breakable: false, stealth: 0 }).alarm = true;
  // vault
  L.building({ name: 'Vault', x0: -20, z0: -79, x1: 4, z1: -63, y0: BY, h: BH + 0.5, ext: 'concrete_dark', int: 'metal', floor: 'plate', ceil: 'metal_dark', roof: null, gaps: [{ side: 'w', at: -71, w: 2.4, h: 2.6 }] });
  g.addDoor(-20.2, -71, BY, 2.4, 2.6, 'z', 'red', 'Vault', 'vault');
  L.sign(-20.45, BY + 3.1, -73.8, 'w', 'ХРАНИЛИЩЕ', 'ДОПУСК ПЕРВОЙ КАТЕГОРИИ', 1.8);
  B(-9.5, BY, -72.5, -6.5, BY + 1.0, -69.5, 'metal');
  const coreGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.8, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  coreGlass.position.set(-8, BY + 1.9, -71);
  L.group.add(coreGlass);
  for (const x of [-17, -13, 0, 3]) B(x, BY, -78.6, x + 1.4, BY + 2.6, -77.4, 'server');
  L.light(-8, BY + 3.6, -71, { color: 0x80e0ff, intensity: 1.1, range: 12, group: 'vault', fixture: 'lamp', cone: true, coneRadius: 2.2 });
  L.light(-1, BY + 3.6, -67, { color: 0xc0e0ff, intensity: 0.5, range: 8, group: 'vault', fixture: 'tube' });
  L.light(-15, BY + 3.6, -67, { color: 0xc0e0ff, intensity: 0.5, range: 8, group: 'vault', fixture: 'tube' });

  // ============================================================== helipad
  B(26, 0, -76, 46, 0.3, -56, 'helipad', { ao: false });
  for (const [x, z] of [[26.3, -75.7], [45.7, -75.7], [26.3, -56.3], [45.7, -56.3]] as const) L.light(x, 0.5, z, { color: 0x30ff60, intensity: 0.3, range: 3, group: 'yard', fixture: 'lamp', stealth: 0.2 });
  B(48, 0, -64, 50, 2.5, -60, 'milcrate');
  B(20, 0, -76, 23, 1.4, -73, 'tank');

  // ============================================================== interactables & objectives
  // Comms sabotage
  g.addInteract(new THREE.Vector3(50, 1.1, -3.2), 'Sabotage transmitter', 4, () => g.sabotageComms());
  // Generator: kill power
  g.addInteract(new THREE.Vector3(43.6, 1.2, 8.5), 'Kill the power (generator)', 3, () => g.setPower(!g.powerOn), 1.8, 'spark');
  // Camera console
  g.addInteract(new THREE.Vector3(20, 1.0, -44.6), 'Disable security cameras', 3, () => g.disableCameras());
  // Data download
  g.addInteract(new THREE.Vector3(0, 1.2, -63), 'Download VESNA research data', 7, () => g.downloadData());

  // pickups
  const P = (k: any, x: number, y: number, z: number, data: any = {}, label = '') => g.addPickup(k, new THREE.Vector3(x, y, z), data, label);
  P('ammo', 4, 0, 71.5, { type: '9mm', n: 24 }, '9mm rounds');
  P('noisemaker', -8.5, 1.2, 71.6, { n: 2 }, 'Noisemakers');
  P('key', -55, 0.86, -28.4, { color: 'blue' }, 'BLUE keycard');
  P('intel', -50, 0.81, -28.7, {}, 'Chernobog contract files');
  P('weapon', -38, 0.9, -28.8, { id: 'ar74', ammo: 60 }, 'AR-74 rifle');
  P('weapon', -43, 0.9, -28.8, { id: 'ks12', ammo: 16 }, 'KS-12 shotgun');
  P('ammo', -44.6, 0.9, -28.8, { type: '545', n: 60 }, '5.45mm rounds');
  P('armor', -37, 0, -17, { n: 60 }, 'Body armor');
  P('grenade', -40, 0.9, -28.9, { n: 2 }, 'Frag grenades');
  P('medkit', -56, 1.0, 16.5, { n: 40 }, 'Medkit');
  P('medkit', -50.5, 0, 33, { n: 40 }, 'Medkit');
  P('noisemaker', -49, 0, 36.5, { n: 2 }, 'Noisemakers');
  P('ammo', -56.5, -2.8, 11, { type: '9mm', n: 36 }, '9mm rounds');
  P('weapon', 49, 0.9, -3.2, { id: 'vs9', ammo: 20 }, 'VS-9 marksman rifle');
  P('ammo', 52.5, 0.9, -3.2, { type: '939', n: 10 }, '9x39 rounds');
  P('armor', 53, 1.2, 12, { n: 50 }, 'Body armor');
  P('medkit', 28, 2.0, -46, { n: 40 }, 'Medkit');
  P('medkit', 5, 0.9, -44.9, { n: 50 }, 'Medkit');
  P('armor', 8, 0.9, -44.9, { n: 50 }, 'Body armor');
  P('key', 5.5, 0.86, -61.3, { color: 'red' }, 'RED keycard');
  P('ammo', -22, BY + 1.2, -47, { type: '9mm', n: 30 }, '9mm rounds');
  P('grenade', -21.5, BY + 1.2, -49, { n: 1 }, 'Frag grenade');
  P('prototype', -8, BY + 1.0, -71, {}, 'VESNA prototype');

  // security cameras
  g.addCamera(new THREE.Vector3(6, 4.6, 39.3), PI, 1.0);
  g.addCamera(new THREE.Vector3(-35.6, 3.3, -29.6), PI * 0.75, 0.8);
  g.addCamera(new THREE.Vector3(-15.5, 3.7, -36.8), PI * 0.82, 0.6);
  g.addCamera(new THREE.Vector3(-31.2, 3.7, -46.4), PI / 2, 0.45);
  g.addCamera(new THREE.Vector3(1.4, 3.7, -52.6), PI * 1.25, 0.55);
  g.addCamera(new THREE.Vector3(-20.8, BY + 3.0, -60.8), PI, 0.45);
  g.addCamera(new THREE.Vector3(29.6, 3.9, -47.4), PI, 0.9);

  // alarm panels
  g.addPanel(new THREE.Vector3(-35.85, 1.4, 2), new THREE.Vector3(-35, 0, 2), PI / 2);
  g.addPanel(new THREE.Vector3(5.35, 1.4, 37.5), new THREE.Vector3(4.6, 0, 37.5), -PI / 2);
  g.addPanel(new THREE.Vector3(35.85, 1.4, 2), new THREE.Vector3(35, 0, 2), -PI / 2);
  g.addPanel(new THREE.Vector3(29.45, 1.4, -40), new THREE.Vector3(28.6, 0, -40), -PI / 2);
  g.addPanel(new THREE.Vector3(-4, 1.4, -51.75), new THREE.Vector3(-4, 0, -50.9), 0);
  g.addPanel(new THREE.Vector3(-20.45, BY + 1.4, -66), new THREE.Vector3(-21.3, BY, -66), -PI / 2);

  // areas (for HUD location readout)
  const A = (name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => L.areas.push({ name, minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 });
  A('Vault', -20, -6, -79, 4, -0.5, -63);
  A('Lab basement', -32, -6, -79, -20, -0.5, -44);
  A('Utility tunnel', -58, -6, -50, -32, -0.9, 34);
  A('Server room', -12, -1, -66, 2, 5, -52);
  A("Director's office", 2, -1, -66, 10, 5, -52);
  A('Laboratory', -32, -1, -80, 10, 5, -36);
  A('Barracks - officer quarters', -58, -1, -30, -47, 4, -14);
  A('Barracks - armory', -47, -1, -30, -36, 4, -14);
  A('Barracks', -58, -1, -30, -36, 4, 18);
  A('Pump house', -58, -1, 26, -48, 4, 38);
  A('Comms building', 36, -1, -12, 56, 5, 14);
  A('Security office', 14, -1, -47, 30, 4, -33);
  A('Helipad', 20, -1, -80, 60, 10, -50);
  A('Courtyard', -60, -1, -80, 60, 20, 40);
  A('Culvert', -52, -1, 38, -48, 2, 50);
  A('East ravine', 61, -1, -20, 80, 20, 41);
  A('Approach valley', -70, -1, 41, 80, 30, 112);

  // ============================================================== spawns
  const S: SpawnDef[] = [
    // approach checkpoint
    { kind: 'merc', x: 1, z: 68, yaw: 0, squad: 'check', post: true, name: 'Checkpoint guard' },
    { kind: 'merc', x: -3, z: 73, squad: 'check', patrol: [[-3, 73], [-20, 80], [-3, 73], [12, 82]], name: 'Checkpoint guard' },
    { kind: 'merc', x: -30, z: 47, squad: 'wall', patrol: [[-40, 46], [-10, 47], [35, 46], [-10, 47]], minDiff: 1, name: 'Perimeter patrol' },
    { kind: 'merc', x: 68, z: 30, squad: 'east', patrol: [[68, 34], [70, -8], [68, 34]], minDiff: 1, name: 'Ravine patrol' },
    { kind: 'sniper', x: 70, z: -10, yaw: 0, squad: 'east', post: true, minDiff: 2, name: 'Sniper' },
    // gate
    { kind: 'merc', x: 7, z: 37, yaw: 0, squad: 'gate', post: true, name: 'Gate guard' },
    { kind: 'merc', x: -2.5, z: 37, yaw: 0, squad: 'gate', post: true, name: 'Gate guard' },
    { kind: 'merc', x: -14, z: 30, y: 5.3, yaw: 0, squad: 'gate', post: true, flashlight: true, name: 'Tower guard', maxDiff: 1 },
    { kind: 'sniper', x: -14, z: 30, y: 5.3, yaw: 0, squad: 'gate', post: true, minDiff: 2, name: 'Tower sniper' },
    { kind: 'merc', x: 30, z: -22, y: 5.3, yaw: PI * 0.9, squad: 'yard', post: true, minDiff: 1, name: 'Tower guard' },
    // courtyard
    { kind: 'merc', x: -18, z: 20, squad: 'yard', patrol: [[-18, 20], [18, 22], [18, -8], [-18, -8]], name: 'Yard patrol' },
    { kind: 'merc', x: 0, z: 8, squad: 'yard', patrol: [[0, 10], [0, -28], [10, -28], [0, 10]], name: 'Yard patrol' },
    { kind: 'merc', x: -33, z: 0, yaw: PI / 2, squad: 'barracks', post: true, name: 'Barracks sentry' },
    { kind: 'merc', x: 26, z: -18, squad: 'yard', patrol: [[26, -18], [32, 10], [26, -18], [12, -28]], minDiff: 1, name: 'Yard patrol' },
    { kind: 'heavy', x: -22, z: -23, yaw: 0, squad: 'yard', post: true, minDiff: 1, name: 'Shed guard' },
    { kind: 'merc', x: -59, z: 14, squad: 'alley', patrol: [[-59, 20], [-59, -28], [-50, 22]], minDiff: 2, name: 'Alley patrol' },
    { kind: 'merc', x: 32, z: -50, squad: 'heli', patrol: [[32, -50], [45, -72], [14, -72], [12, -52]], name: 'Helipad patrol' },
    { kind: 'merc', x: 20, z: -62, yaw: PI / 2, squad: 'heli', post: true, minDiff: 1, name: 'Helipad guard' },
    // barracks
    { kind: 'merc', x: -50, z: 11.5, yaw: PI / 2, squad: 'barracks', post: true, name: 'Merc (eating)' },
    { kind: 'merc', x: -43, z: 12, yaw: -PI / 2, squad: 'barracks', post: true, minDiff: 1, name: 'Merc (eating)' },
    { kind: 'merc', x: -54, z: -7, yaw: 0, squad: 'barracks', post: true, name: 'Merc' },
    { kind: 'merc', x: -40, z: -2, squad: 'barracks', patrol: [[-40, -2], [-54, -10], [-44, 10]], minDiff: 1, name: 'Merc' },
    { kind: 'officer', x: -52, z: -24, squad: 'barracks', patrol: [[-52, -24], [-50, -6], [-46, 10], [-50, -6]], key: 'blue', name: 'Officer Volkov' },
    // pump house / tunnel
    { kind: 'merc', x: -52, z: 34, yaw: PI, squad: 'pump', post: true, minDiff: 2, name: 'Merc' },
    { kind: 'merc', x: -55.5, y: -4, z: 18, squad: 'tunnel', patrol: [[-55.5, 18, -4], [-55.5, -40, -4], [-40, -47.5, -4], [-55.5, -40, -4]], minDiff: 1, flashlight: true, name: 'Tunnel patrol' },
    // comms
    { kind: 'merc', x: 44, z: -6, yaw: PI / 2, squad: 'comms', post: true, name: 'Radio operator' },
    { kind: 'merc', x: 40, z: 10, squad: 'comms', patrol: [[40, 10], [53, 4], [40, 4]], minDiff: 2, name: 'Merc' },
    // security
    { kind: 'merc', x: 21, z: -43, yaw: PI, squad: 'security', post: true, name: 'Security guard' },
    // lab
    { kind: 'merc', x: -10, z: -39, yaw: 0, squad: 'lab', post: true, name: 'Lab guard' },
    { kind: 'merc', x: -28, z: -49, squad: 'lab', patrol: [[-28, -49], [6, -49]], name: 'Lab patrol' },
    { kind: 'officer', x: -20, z: -72, squad: 'lab', patrol: [[-20, -72], [4, -72], [6, -60], [6, -49], [-20, -49], [-20, -58]], key: 'red', minDiff: 1, name: 'Security chief' },
    { kind: 'scientist', x: -26, z: -58, yaw: PI, squad: 'sci' },
    { kind: 'scientist', x: -18, z: -59, yaw: 0, squad: 'sci' },
    { kind: 'scientist', x: -24, z: -63, yaw: PI / 2, squad: 'sci', minDiff: 1 },
    { kind: 'scientist', x: -7, z: -57, yaw: -PI / 2, squad: 'sci' },
    { kind: 'merc', x: -9, z: -61, yaw: PI / 2, squad: 'lab', post: true, minDiff: 1, name: 'Server guard' },
    { kind: 'scientist', x: 5.5, z: -63, yaw: 0, squad: 'sci', name: 'Dr. Orlov' },
    { kind: 'merc', x: -10, z: -72, squad: 'lab', patrol: [[-10, -72], [6, -74], [-24, -74]], minDiff: 1, name: 'Merc' },
    { kind: 'scientist', x: 6, z: -40, yaw: PI, squad: 'sci', minDiff: 1 },
    // basement
    { kind: 'merc', x: -26, y: BY, z: -53, squad: 'basement', patrol: [[-26, -53, BY], [-24, -74, BY], [-26, -53, BY], [-40, -47.5, BY]], name: 'Basement patrol' },
    { kind: 'merc', x: -24, y: BY, z: -69, yaw: PI / 2, squad: 'basement', post: true, maxDiff: 0, name: 'Vault guard' },
    { kind: 'heavy', x: -24, y: BY, z: -69, yaw: PI / 2, squad: 'basement', post: true, minDiff: 1, name: 'Vault guard' },
    { kind: 'heavy', x: -12, y: BY, z: -66, yaw: PI, squad: 'basement', post: true, minDiff: 2, name: 'Vault guard' },
  ];

  return {
    start: new THREE.Vector3(0, 0, 104),
    startYaw: 0,
    spawns: S,
    extraction: new THREE.Vector3(36, 0.3, -66),
    reinforcementPoint: new THREE.Vector3(0, 0, 30),
    navBounds: [-62, -82, 82, 112, -6, 8],
  };
}

// ================================================================= builders
function rubble(g: Game, x: number, y: number, z: number, n: number) {
  for (let i = 0; i < n; i++) {
    const s = 0.3 + Math.random() * 0.6;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), g.level.decor('concrete'));
    m.position.set(x + (Math.random() - 0.5) * 2, y + s * 0.3, z + (Math.random() - 0.5) * 4);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = m.receiveShadow = true;
    g.level.group.add(m);
  }
}

function rockChunk(g: Game, x: number, z: number, s: number) {
  const geo = new THREE.DodecahedronGeometry(s, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + Math.random() * 0.4;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mat = g.level.decor('rock');
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, s * 0.35, z);
  m.rotation.y = Math.random() * 6;
  m.castShadow = m.receiveShadow = true;
  g.level.group.add(m);
  const h = s * 0.7;
  g.level.box(x - h, 0, z - h, x + h, s * 0.35 + s * 0.55, z + h, 'rock', { visual: false });
}

function pine(g: Game, x: number, z: number, s: number) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 3 * s, 6), g.level.decor('bark'));
  trunk.position.set(x, 1.5 * s, z);
  trunk.castShadow = true;
  g.level.group.add(trunk);
  const pm = new THREE.MeshLambertMaterial({ map: tex('pine'), flatShading: true });
  for (let i = 0; i < 3; i++) {
    const r = (2.4 - i * 0.6) * s, h = (2.8 - i * 0.4) * s;
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), pm);
    c.position.set(x, (2 + i * 1.7) * s + h / 2 - 0.4, z);
    c.rotation.y = Math.random() * 3;
    c.castShadow = true;
    c.receiveShadow = true;
    g.level.group.add(c);
  }
  g.level.box(x - 0.3 * s, 0, z - 0.3 * s, x + 0.3 * s, 3 * s, z + 0.3 * s, 'bark', { visual: false, surface: 'wood' });
  // foliage blocks sight but not bullets entirely
  g.level.box(x - 1.6 * s, 2.2 * s, z - 1.6 * s, x + 1.6 * s, 6 * s, z + 1.6 * s, 'bark', { visual: false, noCollide: true, shootThrough: true } as any);
}

function cliffs(g: Game) {
  const L = g.level;
  const seg = (x0: number, z0: number, x1: number, z1: number, along: 'x' | 'z', hmin: number, hmax: number) => {
    const len = along === 'x' ? x1 - x0 : z1 - z0;
    const n = Math.ceil(len / 7);
    for (let i = 0; i < n; i++) {
      const h = hmin + Math.random() * (hmax - hmin);
      const a = i * (len / n), b = (i + 1) * (len / n);
      const jag = Math.random() * 3;
      if (along === 'x') L.box(x0 + a, -1, z0 - (z0 < 0 ? jag : 0), x0 + b, h, z1 + (z0 > 0 ? jag : 0), 'rock', { ao: false });
      else L.box(x0 - (x0 < 0 ? jag : 0), -1, z0 + a, x1 + (x0 > 0 ? jag : 0), h, z0 + b, 'rock', { ao: false });
    }
  };
  seg(-82, 41, -66, 112, 'z', 12, 22);
  seg(-82, 110, 96, 126, 'x', 12, 20);
  seg(80, -30, 96, 112, 'z', 12, 22);
  seg(61, -32, 80, -16, 'x', 10, 16);
  // behind the compound (backdrop over the walls)
  seg(-90, -100, 96, -82, 'x', 18, 30);
  seg(-90, -82, -62, 41, 'z', 16, 26);
  for (const [x, z, s] of [[-64, 60, 4], [-63, 80, 5], [-60, 100, 4], [20, 107, 5], [-20, 107, 4], [60, 108, 5], [78, 70, 4], [78, 30, 5], [75, -12, 4]] as const) rockChunk(g, x, z, s);
}

function mountains(g: Game) {
  const rockM = new THREE.MeshLambertMaterial({ color: 0x4a4e58, flatShading: true });
  const snowM = new THREE.MeshLambertMaterial({ color: 0xc8d2e0, flatShading: true });
  const peaks: [number, number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const d = 230 + Math.random() * 120;
    peaks.push([Math.cos(a) * d, Math.sin(a) * d + 10, 60 + Math.random() * 80, 50 + Math.random() * 40]);
  }
  for (const [x, z, h, r] of peaks) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), rockM);
    c.position.set(x, h / 2 - 5, z);
    c.rotation.y = Math.random() * 3;
    g.level.group.add(c);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.38, h * 0.38, 7), snowM);
    cap.position.set(x, h - 5 - h * 0.19 + 0.5, z);
    cap.rotation.y = c.rotation.y;
    g.level.group.add(cap);
  }
  // moon
  const moon = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
  moon.position.set(-200, 160, 140);
  g.level.group.add(moon);
  // stars
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * 0.45 * Math.PI;
    pos[i * 3] = Math.cos(th) * Math.cos(ph) * 450;
    pos[i * 3 + 1] = Math.sin(ph) * 450 + 20;
    pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 450;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false }));
  g.level.group.add(stars);
}

function sandbags(g: Game, x0: number, z0: number, x1: number, z1: number) {
  g.level.box(x0, 0, z0, x1, 1.1, z1, 'sandbag');
}

function crateStack(g: Game, x: number, z: number, n: number) {
  const L = g.level;
  L.crate(x, z, 1.3, 0, 'crate');
  if (n > 1) L.crate(x + 1.35, z + 0.1, 1.3, 0, 'milcrate');
  if (n > 2) L.crate(x + 0.6, z, 1.2, 1.3, 'crate');
  if (n > 3) L.crate(x, z + 1.4, 1.3, 0, 'milcrate');
}

function lightPole(g: Game, x: number, z: number) {
  g.level.box(x - 0.12, 0, z - 0.12, x + 0.12, 7, z + 0.12, 'steel');
  g.level.box(x - 0.08, 6.9, z - 0.08, x + 0.9, 7.05, z + 0.08, 'steel', { collide: false });
  g.level.light(x + 0.9, 6.75, z, { color: 0xffb46a, intensity: 1.5, range: 17, group: 'yard', cone: true, coneRadius: 5.5 });
}

function truck(g: Game, x: number, z: number, along: 'x' | 'z') {
  const L = g.level;
  const T = (ax0: number, ay0: number, az0: number, ax1: number, ay1: number, az1: number, m: string) => {
    // local coords: length along +a (truck front at +), width w
    if (along === 'z') L.box(x + az0, ay0, z + ax0, x + az1, ay1, z + ax1, m);
    else L.box(x + ax0, ay0, z + az0, x + ax1, ay1, z + az1, m);
  };
  T(-3.5, 0.6, -1.2, 1.2, 1.4, 1.2, 'truck');      // bed
  T(-3.5, 1.4, -1.2, 1.2, 3.2, 1.2, 'tarp');       // canvas
  T(1.3, 0.6, -1.15, 3.4, 2.6, 1.15, 'truck');     // cab
  T(3.4, 0.6, -1.1, 3.6, 1.4, 1.1, 'black');       // grille
  T(-3.4, 0, -1.25, 3.3, 0.6, 1.25, 'black');      // wheels/chassis
}

function tower(g: Game, x: number, z: number, h: number) {
  const L = g.level;
  for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]] as const) L.box(x + dx - 0.15, 0, z + dz - 0.15, x + dx + 0.15, h, z + dz + 0.15, 'steel');
  L.box(x - 2.2, h, z - 2.2, x + 2.2, h + 0.3, z + 2.2, 'plate');
  for (const [a, b, c, d] of [[-2.2, -2.2, 2.2, -2.0], [-2.2, 2.0, 2.2, 2.2], [-2.2, -2.0, -2.0, 2.0], [2.0, -2.0, 2.2, 2.0]] as const) L.box(x + a, h + 0.3, z + b, x + c, h + 1.3, z + d, 'metal');
  for (const [dx, dz] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]] as const) L.box(x + dx - 0.08, h + 1.3, z + dz - 0.08, x + dx + 0.08, h + 3, z + dz + 0.08, 'steel', { collide: false });
  L.box(x - 2.5, h + 3, z - 2.5, x + 2.5, h + 3.3, z + 2.5, 'corrugated');
  L.light(x, h + 2.7, z + 1.5, { color: 0xfff4e0, intensity: 1.6, range: 22, group: 'gate', cone: true, coneRadius: 6, fixture: 'flood' });
  L.indoor.push({ minX: x - 2.5, minY: h, minZ: z - 2.5, maxX: x + 2.5, maxY: h + 3.3, maxZ: z + 2.5, name: 'Tower' });
}

function radioTower(g: Game, x: number, z: number) {
  const L = g.level;
  const H = 28;
  for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) L.box(x + dx - 0.12, 0, z + dz - 0.12, x + dx + 0.12, H, z + dz + 0.12, 'red');
  for (let y = 3; y < H; y += 3.5) {
    L.box(x - 1.6, y, z - 1.6, x + 1.6, y + 0.12, z - 1.4, 'red', { collide: false });
    L.box(x - 1.6, y, z + 1.4, x + 1.6, y + 0.12, z + 1.6, 'red', { collide: false });
    L.box(x - 1.6, y, z - 1.4, x - 1.4, y + 0.12, z + 1.4, 'red', { collide: false });
    L.box(x + 1.4, y, z - 1.4, x + 1.6, y + 0.12, z + 1.4, 'red', { collide: false });
  }
  L.box(x - 0.4, H, z - 0.4, x + 0.4, H + 4, z + 0.4, 'steel', { collide: false });
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.3, 0.5, 12), L.decor('white'));
  dish.rotation.z = PI / 2;
  dish.position.set(x + 1.8, H - 4, z);
  L.group.add(dish);
  L.light(x, H + 4.2, z, { color: 0xff2020, intensity: 0.8, range: 6, group: 'comms', fixture: 'lamp', breakable: false, stealth: 0 }).flicker = true;
  // equipment shed & fence
  L.box(x - 3, 0, z - 6, x + 3, 2.4, z - 4, 'metal');
  for (const [a, b, c, d] of [[-5, -3.5, 5, -3.4], [-5, 5, 5, 5.1], [-5, -3.4, -4.9, 5], [4.9, -3.4, 5, 5]] as const) L.box(x + a, 0, z + b, x + c, 2.2, z + d, 'steel', { seeThrough: true, shootThrough: true, visual: false });
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0x8090a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const fence = (w: number, px: number, pz: number, rot: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.2), fenceMat); m.position.set(px, 1.1, pz); m.rotation.y = rot; L.group.add(m); };
  fence(10, x, z - 3.45, 0); fence(10, x, z + 5.05, 0); fence(8.4, x - 4.95, z + 0.8, PI / 2); fence(8.4, x + 4.95, z + 0.8, PI / 2);
}

function shaft(g: Game, r: R, y0: number, y1: number) {
  const L = g.level;
  L.box(r[0] - 0.1, y0, r[1] - 0.1, r[2] + 0.1, y1, r[1], 'concrete_dark', { collide: false });
  L.box(r[0] - 0.1, y0, r[3], r[2] + 0.1, y1, r[3] + 0.1, 'concrete_dark', { collide: false });
  L.box(r[0] - 0.1, y0, r[1], r[0], y1, r[3], 'concrete_dark', { collide: false });
  L.box(r[2], y0, r[1], r[2] + 0.1, y1, r[3], 'concrete_dark', { collide: false });
}

function railing(g: Game, x0: number, z0: number, x1: number, z1: number) {
  const L = g.level;
  const minx = Math.min(x0, x1) - 0.05, maxx = Math.max(x0, x1) + 0.05, minz = Math.min(z0, z1) - 0.05, maxz = Math.max(z0, z1) + 0.05;
  L.box(minx, 0.95, minz, maxx, 1.05, maxz, 'hazard', { collide: false });
  L.box(minx, 0, minz, maxx, 1.05, maxz, 'steel', { visual: false });
  const n = Math.ceil(Math.max(maxx - minx, maxz - minz) / 1.5);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = minx + (maxx - minx) * t, pz = minz + (maxz - minz) * t;
    L.box(px - 0.03, 0, pz - 0.03, px + 0.03, 0.95, pz + 0.03, 'steel', { collide: false });
  }
}

function bunk(g: Game, x: number, z: number) {
  const L = g.level;
  L.box(x - 1, 0, z - 0.5, x + 1, 0.5, z + 0.5, 'bed');
  L.box(x - 1, 1.4, z - 0.5, x + 1, 1.6, z + 0.5, 'bed');
  for (const dx of [-1, 0.94]) L.box(x + dx, 0, z - 0.5, x + dx + 0.06, 1.8, z + 0.5, 'steel', { collide: false });
}

function glowTank(g: Game, x: number, z: number) {
  const L = g.level;
  L.box(x - 0.8, 0, z - 0.8, x + 0.8, 0.4, z + 0.8, 'steel');
  L.box(x - 0.8, 2.6, z - 0.8, x + 0.8, 2.9, z + 0.8, 'steel');
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2.2, 14), new THREE.MeshLambertMaterial({ color: 0x40ffb0, emissive: 0x10a060, emissiveIntensity: 0.9, transparent: true, opacity: 0.55 }));
  glass.position.set(x, 1.5, z);
  L.group.add(glass);
  L.box(x - 0.65, 0.4, z - 0.65, x + 0.65, 2.6, z + 0.65, 'glass', { visual: false });
  L.light(x, 1.6, z + 1.0, { color: 0x50ffb0, intensity: 0.45, range: 5, group: 'lab', fixture: 'none', breakable: false, stealth: 0.6 });
}
