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

/** Fighter manoeuvres added in the v0.2 handling pass. */
export type ManeuverId =
  | 'highG'
  | 'airbrake'
  | 'cobra'
  | 'barrelRoll'
  | 'splitS'
  | 'immelmann'
  | 'kulbit';

/** `sustained` follows the stick while held, `scripted` plays a timed profile. */
export type ManeuverKind = 'sustained' | 'scripted';

/** Co-pilot style flight aids. All of them yield to direct pilot input. */
export type AssistId = 'attitude' | 'steering' | 'throttle' | 'terrain';

export type AssistSettings = Record<AssistId, boolean>;

export type TutorialStepId =
  | 'attitude'
  | 'throttle'
  | 'target'
  | 'lock'
  | 'fire'
  | 'maneuver'
  | 'defend';

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
  rollRate: number;
  pitchRate: number;
  speed: number;
  throttle: number;
  hp: number;
  maxHp: number;
  gLoad: number;
  afterburner: boolean;
  /** Airbrake / high-G flags feed the HUD and the audio layer. */
  airbrake: boolean;
  highG: boolean;
  /** True while the airframe is beyond the normal ±77° pitch envelope. */
  postStall: boolean;
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

export type WeaponWarningKind = 'missile' | 'damage' | 'boss' | 'system' | 'terrain';

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
  /** Signed yaw error to the target in degrees — the steering cue. */
  steering: number;
  /** Signed pitch error to the target in degrees. */
  elevation: number;
  /** True while the target steering aid is nudging the nose. */
  assisted: boolean;
}

export interface ManeuverStatus {
  id: ManeuverId;
  kind: ManeuverKind;
  labelEn: string;
  labelZh: string;
  /** Short label for compact deck chips. */
  shortZh: string;
  code: string;
  key: string;
  hint: string;
  active: boolean;
  available: boolean;
  /** Localised reason shown when a manoeuvre cannot be started. */
  blocked: string | null;
  /** 0..1 progress for scripted manoeuvres, 0 while idle. */
  progress: number;
}

export interface ManeuverSnapshot {
  active: ManeuverId | null;
  activeLabelEn: string | null;
  activeLabelZh: string | null;
  activeCode: string | null;
  progress: number;
  list: ManeuverStatus[];
}

export interface AssistStatus {
  id: AssistId;
  labelEn: string;
  labelZh: string;
  code: string;
  hint: string;
  enabled: boolean;
  /** Currently applying a correction. */
  engaged: boolean;
  /** 0..1 share of the axis budget the aid is using. */
  authority: number;
}

export interface AssistSnapshot {
  master: boolean;
  anyEnabled: boolean;
  engaged: AssistId[];
  list: AssistStatus[];
}

export interface TutorialStep {
  id: TutorialStepId;
  keys: string[];
  labelZh: string;
  labelEn: string;
  done: boolean;
}

export interface TutorialState {
  visible: boolean;
  dismissed: boolean;
  completed: number;
  total: number;
  steps: TutorialStep[];
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
    /** Display pitch in degrees, always inside ±90° for the ladder. */
    pitch: number;
    /** True raw pitch in degrees — goes past ±90° during vertical manoeuvres. */
    pitchRaw: number;
    roll: number;
    rollRate: number;
    gLoad: number;
    throttle: number;
    hp: number;
    maxHp: number;
    afterburner: boolean;
    airbrake: boolean;
    highG: boolean;
    postStall: boolean;
    inverted: boolean;
    stall: boolean;
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
  maneuver: ManeuverSnapshot;
  assist: AssistSnapshot;
  tutorial: TutorialState;
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
  | { type: 'maneuver-start'; id: ManeuverId }
  | { type: 'maneuver-end'; id: ManeuverId }
  | { type: 'maneuver-blocked'; id: ManeuverId; reason: string }
  | { type: 'assist-toggle'; enabled: boolean; id: AssistId | 'master' }
  | { type: 'assist-engaged'; id: AssistId }
  | { type: 'stall' }
  | { type: 'tutorial-complete' }
  | { type: 'tutorial-dismissed' }
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
  maneuver: ManeuverId | null;
  airbrake: boolean;
  assistEngaged: number;
}
