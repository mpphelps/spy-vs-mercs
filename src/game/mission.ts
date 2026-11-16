// Mission definitions, objectives per difficulty, and briefing text.

export type ObjState = 'pending' | 'done' | 'failed';

export interface ObjectiveDef {
  id: string;
  text: string;
  minDiff: number;
  maxDiff?: number;
  /** constraints are satisfied unless failed */
  constraint?: boolean;
}

export interface MissionDef {
  id: string;
  codename: string;
  title: string;
  location: string;
  available: boolean;
  briefing: string[];
  objectives: ObjectiveDef[];
  parTimes: [number, number, number];
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'object47',
    codename: 'OPERATION KOLYBEL',
    title: 'Object 47',
    location: 'Ural Mountains, Russia  ·  58°N 59°E  ·  02:40 local',
    available: true,
    briefing: [
      'CONTROL: Forty hours ago a Chernobog Group convoy delivered something into Object 47, a Cold War weapons lab that was officially mothballed in 1991. It is not mothballed.',
      'The Chernobog Group are ex-Spetsnaz mercenaries for hire. They have spent the last two years torching villages in places you have never heard of, and now they are babysitting a scientist named Orlov and his little project: VESNA.',
      'VESNA is an autonomous targeting core. Bolt it into a drone and the drone decides on its own who dies. Chernobog intend to auction it to the highest bidder in nine days.',
      'You will infiltrate the compound, take the prototype from the underground vault and get out. A helicopter is on standby. The moment you have the core, it comes for you.',
      'Recon shows three ways in: the main gate, an old drainage culvert on the west side, and a collapsed section of the east wall. The guards are professionals and they shoot first. Use the dark. Use the snow. Do not get sloppy.',
      'The scientists are civilians. Most of them are there because their families are. Try to remember that.',
    ],
    objectives: [
      { id: 'comms', text: 'Sabotage the communications array (prevents reinforcements)', minDiff: 1 },
      { id: 'data', text: 'Download VESNA research data from the lab servers', minDiff: 1 },
      { id: 'intel', text: "Recover the Chernobog contract from the barracks officer's quarters", minDiff: 2 },
      { id: 'prototype', text: 'Steal the VESNA prototype from the underground vault', minDiff: 0 },
      { id: 'extract', text: 'Reach the extraction helicopter at the helipad', minDiff: 0 },
      { id: 'civ2', text: 'Do not kill more than two scientists', minDiff: 1, maxDiff: 1, constraint: true },
      { id: 'civ0', text: 'Do not kill any scientists', minDiff: 2, constraint: true },
      { id: 'alarm', text: 'Trigger no more than one base alarm (before the lockdown)', minDiff: 2, constraint: true },
    ],
    parTimes: [600, 780, 960],
  },
  {
    id: 'railyard', codename: 'OPERATION SNEGIR', title: 'Kolybel Rail Yard', location: 'Classified', available: false,
    briefing: ['[DATA EXPUNGED]'], objectives: [], parTimes: [0, 0, 0],
  },
  {
    id: 'dam', codename: 'OPERATION ZHURAVL', title: 'Belaya Dam', location: 'Classified', available: false,
    briefing: ['[DATA EXPUNGED]'], objectives: [], parTimes: [0, 0, 0],
  },
];

export interface Objective extends ObjectiveDef { state: ObjState }

export class MissionState {
  objectives: Objective[];
  constructor(public def: MissionDef, diff: number) {
    this.objectives = def.objectives.filter((o) => diff >= o.minDiff && (o.maxDiff === undefined || diff <= o.maxDiff)).map((o) => ({ ...o, state: 'pending' as ObjState }));
  }
  get(id: string) { return this.objectives.find((o) => o.id === id); }
  has(id: string) { return !!this.get(id); }
  complete(id: string) {
    const o = this.get(id);
    if (!o || o.state !== 'pending') return false;
    o.state = 'done';
    return true;
  }
  fail(id: string) {
    const o = this.get(id);
    if (!o || o.state !== 'pending') return false;
    o.state = 'failed';
    return true;
  }
  /** Tasks (non-constraint) still pending, excluding extraction. */
  pendingTasks() { return this.objectives.filter((o) => !o.constraint && o.state === 'pending' && o.id !== 'extract'); }
  anyFailed() { return this.objectives.some((o) => o.state === 'failed'); }
}
