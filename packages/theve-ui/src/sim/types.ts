export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type MissionPhase =
  | 'idle'
  | 'boot'
  | 'dogfight'
  | 'boss-intro'
  | 'boss'
  | 'complete'
  | 'failed';

export type Team = 'player' | 'ally' | 'hostile';
export type EntityKind =
  | 'fighter'
  | 'wingman'
  | 'dreadnought'
  | 'weakpoint'
  | 'missile'
  | 'flare';
export type TargetKind = 'fighter' | 'wingman' | 'weakpoint';
export type WeaponId = 'aam' | 'gun';
export type WeakpointKey = 'shieldL' | 'shieldR' | 'core';

export interface ControlInput {
  pitch: number;
  roll: number;
  yaw: number;
}

export interface FlightState {
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  hp: number;
  maxHp: number;
  gLoad: number;
  afterburner: boolean;
}

export interface AIState {
  mode: 'engage' | 'evade' | 'formation' | 'drift';
  cooldown: number;
  evadeTimer: number;
  seed: number;
}

export interface MissileState {
  targetId: string;
  speed: number;
  life: number;
  maxLife: number;
  owner: Team;
}

export interface WeakpointState {
  key: WeakpointKey;
  parentId: string;
  label: string;
  targetable: boolean;
}

export interface SimEntity {
  id: string;
  kind: EntityKind;
  team: Team;
  callsign: string;
  label: string;
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
  variant: 'standard' | 'ace' | 'dreadnought';
  ai: AIState | null;
  missile: MissileState | null;
  weakpoint: WeakpointState | null;
  life: number;
  maxLife: number;
}

export type EffectKind = 'explosion' | 'shockwave' | 'tracer' | 'muzzle';
export type EffectColor = 'cyan' | 'amber' | 'red' | 'white' | 'green';

export interface SimEffect {
  id: string;
  kind: EffectKind;
  position: Vec3;
  to: Vec3 | null;
  scale: number;
  color: EffectColor;
  life: number;
  maxLife: number;
}

export interface ScenarioEnemy {
  callsign: string;
  variant?: 'standard' | 'ace';
  distance: number;
  side: number;
  vertical: number;
}

export interface Scenario {
  id: string;
  operation: string;
  titleEn: string;
  titleZh: string;
  callsign: string;
  wingmanCallsign: string;
  awacsCallsign: string;
  start: { speed: number; altitude: number; heading: number };
  enemies: ScenarioEnemy[];
  requiredKills: number;
  bossTriggerAt: number;
  boss: {
    id: string;
    callsign: string;
    nameEn: string;
    nameZh: string;
    spawnDistance: number;
    spawnSide: number;
    spawnAlt: number;
  };
}

export type WeaponWarningKind = 'missile' | 'damage' | 'boss' | 'system';

export interface WarningState {
  id: string;
  kind: WeaponWarningKind;
  severity: 'caution' | 'warning' | 'critical';
  message: string;
  detail: string;
  direction: number;
  expiresAt: number;
}

export type CommsRole = 'awacs' | 'wingman' | 'command' | 'system' | 'enemy';

export interface CommsMessage {
  id: string;
  at: number;
  from: string;
  role: CommsRole;
  text: string;
}

export interface HudTarget {
  id: string;
  callsign: string;
  label: string;
  kind: TargetKind;
  team: Team;
  variant: 'standard' | 'ace' | 'dreadnought';
  distance: number;
  hp: number;
  maxHp: number;
  angle: number;
  selected: boolean;
  locked: boolean;
  lockProgress: number;
  lockable: boolean;
  screen: { x: number; y: number; scale: number; onScreen: boolean };
}

export interface RadarContact {
  id: string;
  x: number;
  y: number;
  team: Team;
  kind: TargetKind;
  selected: boolean;
}

export interface BossWeakpointHud {
  key: WeakpointKey;
  label: string;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  targetable: boolean;
}

export interface BossHud {
  id: string;
  callsign: string;
  nameEn: string;
  nameZh: string;
  hp: number;
  maxHp: number;
  stage: 1 | 2 | 3;
  weakpoints: BossWeakpointHud[];
}

export interface WingmanHud {
  id: string;
  callsign: string;
  state: string;
  hp: number;
  maxHp: number;
  kills: number;
  distance: number;
}

export interface MissionStats {
  kills: number;
  shotsFired: number;
  shotsHit: number;
  missilesFired: number;
  missilesHit: number;
  damageTaken: number;
  elapsed: number;
  score: number;
  rank: 'S' | 'A' | 'B' | 'C' | null;
}

export interface LockState {
  targetId: string | null;
  callsign: string | null;
  progress: number;
  state: 'none' | 'searching' | 'locked';
  distance: number;
  inCone: boolean;
}

export interface CockpitSnapshot {
  phase: MissionPhase;
  paused: boolean;
  elapsed: number;
  operation: string;
  titleEn: string;
  titleZh: string;
  flight: {
    speed: number;
    knots: number;
    mach: number;
    altitude: number;
    verticalSpeed: number;
    heading: number;
    pitch: number;
    roll: number;
    gLoad: number;
    throttle: number;
    hp: number;
    maxHp: number;
    afterburner: boolean;
  };
  weapons: {
    selected: WeaponId;
    missiles: number;
    maxMissiles: number;
    gunAmmo: number;
    gunMax: number;
    flares: number;
    maxFlares: number;
    gunFiring: boolean;
  };
  lock: LockState;
  targets: HudTarget[];
  radar: RadarContact[];
  warnings: WarningState[];
  comms: CommsMessage[];
  wingman: WingmanHud | null;
  boss: BossHud | null;
  mission: {
    kills: number;
    requiredKills: number;
    objective: string;
    objectiveZh: string;
    hint: string;
    score: number;
    stats: MissionStats;
  };
}

export type SimEvent =
  | { type: 'boot' }
  | { type: 'launch' }
  | { type: 'lock-acquired'; targetId: string }
  | { type: 'lock-lost' }
  | { type: 'missile-fire'; team: Team; id: string }
  | { type: 'gun-fire'; team: Team }
  | { type: 'hit'; targetId: string; damage: number; mine: boolean }
  | { type: 'explosion'; position: Vec3; scale: number }
  | { type: 'flare' }
  | { type: 'warning'; warning: WarningState }
  | { type: 'damage'; amount: number }
  | { type: 'radio'; message: CommsMessage }
  | { type: 'boss-intro' }
  | { type: 'boss-shield-down'; key: WeakpointKey }
  | { type: 'boss-destroyed' }
  | { type: 'afterburner' }
  | { type: 'resupply' }
  | { type: 'mission-complete' }
  | { type: 'mission-failed' };

export type SimListener = (event: SimEvent) => void;

export interface Projection {
  x: number;
  y: number;
  scale: number;
  onScreen: boolean;
}

export interface AudioTelemetry {
  phase: MissionPhase;
  paused: boolean;
  throttle: number;
  speed: number;
  altitude: number;
  gLoad: number;
  hpRatio: number;
  lockState: LockState['state'];
  missileWarning: boolean;
  bossActive: boolean;
  elapsed: number;
}
