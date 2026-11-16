export interface Difficulty {
  id: 0 | 1 | 2;
  name: string;
  tagline: string;
  /** Enemy aim spread in degrees. */
  spread: number;
  /** Seconds between spotting and first shot. */
  reaction: number;
  /** Multiplier on visual detection speed / range. */
  perception: number;
  hearing: number;
  enemyHealth: number;
  enemyDamage: number;
  /** 0 = basic, 1 = cover + alarms + grenades, 2 = squads flank, suppress, check bodies, retreat. */
  tactics: 0 | 1 | 2;
  flashlights: boolean;
  /** Enemies only able to perceive when awareness passes this. */
  awarenessDecay: number;
  playerArmor: number;
  ammoMult: number;
  reinforcements: number;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: 0, name: 'OPERATIVE', tagline: 'Mercs are sloppy, slow and work alone.',
    spread: 5.0, reaction: 1.15, perception: 0.7, hearing: 0.8, enemyHealth: 0.8, enemyDamage: 0.42,
    tactics: 0, flashlights: false, awarenessDecay: 0.45, playerArmor: 50, ammoMult: 1.5, reinforcements: 0,
  },
  {
    id: 1, name: 'AGENT', tagline: 'Mercs use cover, raise alarms and throw grenades.',
    spread: 2.9, reaction: 0.7, perception: 1.0, hearing: 1.0, enemyHealth: 1.0, enemyDamage: 0.7,
    tactics: 1, flashlights: true, awarenessDecay: 0.3, playerArmor: 25, ammoMult: 1.0, reinforcements: 1,
  },
  {
    id: 2, name: 'GHOST', tagline: 'Professional killers. They flank, suppress, hunt and never forget.',
    spread: 1.7, reaction: 0.38, perception: 1.3, hearing: 1.3, enemyHealth: 1.15, enemyDamage: 1.15,
    tactics: 2, flashlights: true, awarenessDecay: 0.18, playerArmor: 0, ammoMult: 0.75, reinforcements: 2,
  },
];
