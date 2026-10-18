import { clamp } from './math';
import type {
  AIState,
  EnemyId,
  ManeuverId,
  MissionPhase,
  ScenarioEnemy,
  ScenarioWave,
  SimEntity,
} from './types';

/**
 * v0.4 enemy roster.
 *
 * v0.3 flew one airframe three times: two identical VESPER wingmen and one ace
 * that differed only in hp and cooldown. v0.4 gives the stage a cast — every
 * bandit now has a role, a silhouette, a weapon fit and a behaviour, and the
 * mission feeds them in waves instead of all at once.
 *
 * Everything here is pure data plus pure helpers so the HUD, the engine and the
 * unit tests all read the same table.
 */

export type EnemySilhouette = 'light' | 'standard' | 'heavy';

export interface EnemyGunFit {
  /** Metres at which the bandit stops shooting. */
  range: number;
  /** Cone half-angle in degrees — inside this the burst connects. */
  cone: number;
  /** Damage per second while the burst is on target. */
  dps: number;
  /** Seconds a burst lasts once it starts. */
  burst: number;
  /** Seconds between bursts. */
  interval: [number, number];
}

export interface EnemyMissileFit {
  /** Closest and furthest launch range in metres. */
  min: number;
  max: number;
  /** Cone half-angle in degrees at launch. */
  cone: number;
  /** Seconds between launches. */
  cooldown: [number, number];
  /** Missile cruise speed in m/s. */
  speed: number;
}

export interface EnemyProfile {
  id: EnemyId;
  /** Short code for compact HUD chips. */
  code: string;
  labelEn: string;
  labelZh: string;
  /** One line of threat-database copy. */
  role: string;
  /** Compact airframe silhouette family for the 3D layer. */
  silhouette: EnemySilhouette;
  /** Hostile accent colour, hex. Reads at a glance which bandit is which. */
  tint: number;
  hp: number;
  speed: number;
  radius: number;
  /** Kill score. */
  points: number;
  variant: 'standard' | 'ace';
  /**
   * Yaw authority in rad/s while engaging. Deliberately below the player's own
   * turn rate: this airframe's banked turn tops out near 20 deg/s at combat
   * speed (28 deg/s on a high-G turn), while v0.3's bandits turned at 47-66
   * deg/s. Against a three-ship formation that read as "agile"; against the
   * eight-plus of v0.4 it read as "impossible", because no amount of skill lets
   * a 20 deg/s airframe out-turn a 54 deg/s one. The bandits are now slower in
   * the turn than a pilot who flies the jet properly, and make up for it with
   * numbers, guns and missiles.
   */
  turnRate: number;
  /** Preferred engagement range in metres — the AI tries to hold this. */
  standoff: number;
  /** 0..1 chance per second of breaking off when the player has a lock. */
  evadeBias: number;
  missile: EnemyMissileFit | null;
  gun: EnemyGunFit | null;
  /** The bandit degrades the player's radar lock while it is alive and near. */
  jammer: boolean;
  /** True for named squadron leaders — extra HUD treatment. */
  command: boolean;
}

const MISSILE_STANDARD: EnemyMissileFit = {
  min: 650,
  max: 2900,
  cone: 24,
  cooldown: [6, 9],
  speed: 660,
};

export const ENEMIES: Record<EnemyId, EnemyProfile> = {
  scout: {
    id: 'scout',
    code: 'SCT',
    labelEn: 'VESPER SCOUT',
    labelZh: '维斯珀 侦察机',
    role: '轻装高速，没有导弹：靠一次次掠袭消耗你的能量',
    silhouette: 'light',
    tint: 0xff5a4a,
    hp: 62,
    speed: 236,
    radius: 8,
    points: 90,
    variant: 'standard',
    turnRate: 0.44,
    standoff: 1500,
    evadeBias: 0.5,
    missile: null,
    gun: { range: 1250, cone: 7, dps: 9, burst: 0.7, interval: [5.5, 8.5] },
    jammer: false,
    command: false,
  },
  interceptor: {
    id: 'interceptor',
    code: 'INT',
    labelEn: 'VESPER INTERCEPTOR',
    labelZh: '维斯珀 截击机',
    role: '编队主力：中距导弹与短点射机炮，稳扎稳打',
    silhouette: 'standard',
    tint: 0xff4d5a,
    hp: 100,
    speed: 205,
    radius: 9,
    points: 120,
    variant: 'standard',
    turnRate: 0.3,
    standoff: 2100,
    evadeBias: 0.3,
    missile: { ...MISSILE_STANDARD },
    gun: { range: 1350, cone: 6.5, dps: 7, burst: 0.65, interval: [6.5, 9.5] },
    jammer: false,
    command: false,
  },
  heavy: {
    id: 'heavy',
    code: 'HVY',
    labelEn: 'VESPER HEAVY',
    labelZh: '维斯珀 重装攻击机',
    role: '装甲厚、转得慢，但机炮压制很痛：别在它机头前停留',
    silhouette: 'heavy',
    tint: 0xff8a3d,
    hp: 190,
    speed: 176,
    radius: 12,
    points: 210,
    variant: 'standard',
    turnRate: 0.2,
    standoff: 1700,
    evadeBias: 0.12,
    missile: { ...MISSILE_STANDARD, max: 2400, cooldown: [9, 13] },
    gun: { range: 1650, cone: 9, dps: 13, burst: 1.1, interval: [5.2, 8] },
    jammer: false,
    command: false,
  },
  jammer: {
    id: 'jammer',
    code: 'JAM',
    labelEn: 'VESPER JAMMER',
    labelZh: '维斯珀 电子战机',
    role: '干扰吊舱压制火控：只要它活着，锁定速度减半',
    silhouette: 'standard',
    tint: 0xc07bff,
    hp: 92,
    speed: 196,
    radius: 9,
    points: 180,
    variant: 'standard',
    turnRate: 0.24,
    standoff: 3000,
    evadeBias: 0.42,
    missile: null,
    gun: null,
    jammer: true,
    command: false,
  },
  drone: {
    id: 'drone',
    code: 'DRN',
    labelEn: 'LEVIATHAN DRONE',
    labelZh: '利维坦 无人机',
    role: '巨兽释放的消耗品：数量多、个体弱，但会把你缠在原地',
    silhouette: 'light',
    tint: 0xff4fa0,
    hp: 58,
    speed: 232,
    radius: 8,
    points: 70,
    variant: 'standard',
    turnRate: 0.52,
    standoff: 900,
    evadeBias: 0.18,
    missile: { ...MISSILE_STANDARD, min: 420, max: 1900, cone: 30, cooldown: [11, 16], speed: 620 },
    gun: { range: 1000, cone: 8, dps: 5, burst: 0.55, interval: [9, 14] },
    jammer: false,
    command: false,
  },
  ace: {
    id: 'ace',
    code: 'ACE',
    labelEn: 'VESPER ACE',
    labelZh: '维斯珀 王牌',
    role: '编队里最难缠的一架：转向快、出手早、咬住就不松口',
    silhouette: 'standard',
    tint: 0xff7546,
    hp: 155,
    speed: 220,
    radius: 9,
    points: 320,
    variant: 'ace',
    turnRate: 0.38,
    standoff: 1900,
    evadeBias: 0.55,
    missile: { ...MISSILE_STANDARD, cooldown: [4.2, 6.4] },
    gun: { range: 1500, cone: 6, dps: 10, burst: 0.8, interval: [5, 7.5] },
    jammer: false,
    command: false,
  },
  commander: {
    id: 'commander',
    code: 'CMD',
    labelEn: 'VESPER COMMANDER',
    labelZh: '维斯珀 指挥机',
    role: '编队长机：全程有僚机掩护，击落它等于拆掉整支编队的大脑',
    silhouette: 'heavy',
    tint: 0xffd166,
    hp: 240,
    speed: 214,
    radius: 11,
    points: 520,
    variant: 'ace',
    turnRate: 0.34,
    standoff: 2400,
    evadeBias: 0.62,
    missile: { ...MISSILE_STANDARD, max: 3200, cone: 26, cooldown: [3.4, 5] },
    gun: { range: 1600, cone: 6, dps: 13, burst: 0.9, interval: [4.2, 6.4] },
    jammer: false,
    command: true,
  },
};

export const ENEMY_ORDER: EnemyId[] = [
  'scout',
  'interceptor',
  'heavy',
  'jammer',
  'drone',
  'ace',
  'commander',
];

export function isEnemyId(value: unknown): value is EnemyId {
  return typeof value === 'string' && value in ENEMIES;
}

export function enemyProfile(id: EnemyId | null | undefined): EnemyProfile | null {
  if (!id) return null;
  return ENEMIES[id] ?? null;
}

/**
 * Named bandits. The `callsign` in a scenario is matched here first so the
 * mission file can stay terse, and an explicit `enemy` field always wins.
 */
const CALLSIGN_PROFILES: Record<string, EnemyId> = {
  'VESPER 1': 'interceptor',
  'VESPER 2': 'scout',
  'VESPER 3': 'interceptor',
  'VESPER 4': 'heavy',
  'VESPER 5': 'jammer',
  'VESPER 6': 'interceptor',
  'VESPER 7': 'scout',
  'VESPER ACE': 'ace',
  'VESPER LEAD': 'commander',
  'VESPER COMMANDER': 'commander',
  'VESPER DRONE': 'drone',
};

export function resolveEnemyId(enemy: ScenarioEnemy): EnemyId {
  if (enemy.enemy) return enemy.enemy;
  const byCallsign = CALLSIGN_PROFILES[enemy.callsign.toUpperCase()];
  if (byCallsign) return byCallsign;
  // The v0.3 shorthand `variant: 'ace'` still means "this one is a named ace".
  if (enemy.variant === 'ace') return 'ace';
  return 'interceptor';
}

/** Fresh AI block. Every spawn site goes through here so no field is forgotten. */
export function createAIState(overrides: Partial<AIState> = {}): AIState {
  return {
    mode: 'engage',
    cooldown: 6,
    evadeTimer: 0,
    seed: 0,
    gunBurst: 0,
    gunCooldown: 3,
    burstHits: 0,
    ...overrides,
  };
}

/**
 * Which waves are legal to bring in right now. The engine calls this once per
 * frame; splitting it out keeps the reinforcement schedule unit-testable.
 */
export interface WaveGate {
  kills: number;
  elapsed: number;
  /** Hostiles still alive. */
  hostiles: number;
  /** Hostiles in the scenario that have not spawned yet. */
  pending: number;
  phase: MissionPhase;
}

export function waveReady(wave: ScenarioWave, gate: WaveGate): boolean {
  if (gate.phase !== 'dogfight' && gate.phase !== 'boss') return false;
  if (gate.kills < wave.atKills && gate.elapsed < wave.atTime) return false;
  const cap = wave.concurrent;
  if (cap !== undefined && gate.hostiles >= cap) return false;
  return true;
}

/** Total bandits the mission can put in the air, initial wave included. */
export function countRoster(
  initial: readonly ScenarioEnemy[],
  waves: readonly ScenarioWave[],
): number {
  return initial.length + waves.reduce((total, wave) => total + wave.units.length, 0);
}

/** Highest score available in the dogfight, used by the debrief. */
export function rosterPoints(units: readonly ScenarioEnemy[]): number {
  return units.reduce((total, unit) => total + ENEMIES[resolveEnemyId(unit)].points, 0);
}

/* ------------------------------------------------------------------ */
/* wave choreography — comms lines the director shouts on spawn         */
/* ------------------------------------------------------------------ */

export interface WaveCallout {
  from: 'awacs' | 'wingman';
  role: 'awacs' | 'wingman';
  text: string;
}

const WAVE_PREAMBLE: Record<EnemyId, string> = {
  scout: '高速侦察机，别跟它比直线',
  interceptor: '标准截击机编队',
  heavy: '重装攻击机 — 避开它的机炮轴线',
  jammer: '电子干扰机！先打掉它，不然锁不上',
  drone: '无人机群，近了会很难缠',
  ace: '王牌机出现 — 队长，小心',
  commander: '指挥机进场！这是编队的大脑',
};

/** Readable enemy composition, e.g. "2x 截击机 + 1x 王牌". */
export function describeWave(units: readonly ScenarioEnemy[]): string {
  const tally = new Map<EnemyId, number>();
  for (const unit of units) {
    const id = resolveEnemyId(unit);
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  return Array.from(tally.entries())
    .map(([id, count]) => `${count}×${ENEMIES[id].labelZh.replace(/^维斯珀 |^利维坦 /, '')}`)
    .join(' + ');
}

export function waveBriefing(wave: ScenarioWave, units: readonly ScenarioEnemy[]): string {
  const base = wave.alertZh ?? `增援进入战区：${describeWave(units)}。`;
  const threat = units
    .map((unit) => ENEMIES[resolveEnemyId(unit)])
    .find((profile) => profile.jammer || profile.command || profile.id === 'heavy');
  return threat ? `${base} 注意：${WAVE_PREAMBLE[threat.id]}。` : base;
}

/* ------------------------------------------------------------------ */
/* autopilot support                                                   */
/* ------------------------------------------------------------------ */

/**
 * Threat weighting for target selection. High-value and high-annoyance bandits
 * (jammers, commanders, the ace) are worth breaking off for.
 */
export function enemyPriority(entity: SimEntity): number {
  // The weakpoint check has to come first: a shield node carries no airframe
  // profile, so asking for one returns null and the node would be valued as an
  // ordinary bandit — which is exactly how the dreadnought used to be ignored.
  if (entity.kind === 'weakpoint') return 3.4;
  const profile = enemyProfile(entity.enemyId);
  if (!profile) return 1;
  if (profile.jammer) return 2.6;
  if (profile.command) return 2.4;
  if (entity.variant === 'ace') return 2.1;
  if (profile.id === 'heavy') return 1.5;
  if (profile.id === 'drone') return 0.8;
  return 1;
}

/**
 * The manoeuvres worth showing off, in the order a demo pilot would build up to
 * them: easy reversals first, supermanoeuvres last.
 */
export const SHOWCASE_ORDER: ManeuverId[] = [
  'highG',
  'barrelRoll',
  'splitS',
  'immelmann',
  'airbrake',
  'cobra',
  'kulbit',
];

export interface ShowcasePlay {
  id: string;
  maneuver: ManeuverId;
  labelEn: string;
  labelZh: string;
  /** Radio line the autopilot transmits as it ignites the move. */
  callout: string;
  /** Skip the aircraft into the shot? Purely a HUD/3D hint. */
  camera: 'chase' | 'wing' | 'nose';
}

export const SHOWCASE_PLAYS: Record<ManeuverId, ShowcasePlay> = {
  highG: {
    id: 'knife',
    maneuver: 'highG',
    labelEn: 'KNIFE TURN',
    labelZh: '刀锋转弯',
    callout: '咬住他 — 高G转弯。',
    camera: 'chase',
  },
  airbrake: {
    id: 'bait',
    maneuver: 'airbrake',
    labelEn: 'OVERSPEED BAIT',
    labelZh: '减速诱敌',
    callout: '放减速板，让他冲到前面去。',
    camera: 'chase',
  },
  cobra: {
    id: 'cobra',
    maneuver: 'cobra',
    labelEn: 'COBRA BREAK',
    labelZh: '眼镜蛇摆脱',
    callout: '看好了 — 眼镜蛇机动。',
    camera: 'wing',
  },
  barrelRoll: {
    id: 'spiral',
    maneuver: 'barrelRoll',
    labelEn: 'SPIRAL EVADE',
    labelZh: '螺旋摆脱',
    callout: '桶滚脱离。',
    camera: 'wing',
  },
  splitS: {
    id: 'drop',
    maneuver: 'splitS',
    labelEn: 'VERTICAL DROP',
    labelZh: '垂直下压',
    callout: '破S — 用高度换速度。',
    camera: 'nose',
  },
  immelmann: {
    id: 'rise',
    maneuver: 'immelmann',
    labelEn: 'RISING REVERSAL',
    labelZh: '上升反转',
    callout: '殷麦曼翻转，从上面回来。',
    camera: 'nose',
  },
  kulbit: {
    id: 'kulbit',
    maneuver: 'kulbit',
    labelEn: 'KULBIT REVERSAL',
    labelZh: '库尔比特反转',
    callout: '都退后 — 库尔比特。',
    camera: 'wing',
  },
};

/** 0..1 style meter, purely cosmetic: how showy the last few seconds were. */
export function styleRating(plays: number, demonstrated: number, total: number): number {
  if (total <= 0) return 0;
  const coverage = demonstrated / total;
  const volume = clamp(plays / 14, 0, 1);
  return clamp(coverage * 0.7 + volume * 0.3, 0, 1);
}
