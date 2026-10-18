export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** v0.5 boss attack vocabulary. The attack book lives in `sim/boss.ts`. */
export type BossAttackId = 'ciws' | 'salvo' | 'pulse' | 'lance';

/** `telegraph` → warning is up, `active` → it is hurting, `recover` → cooling. */
export type BossAttackPhase = 'idle' | 'telegraph' | 'active' | 'recover';

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

/**
 * v0.5 camera. `cockpit` is the original first-person avionics view; `chase`
 * pulls back behind the airframe so the player can watch their own aircraft
 * (and the manoeuvres) from outside.
 */
export type ViewMode = 'cockpit' | 'chase';

export const VIEW_ORDER: ViewMode[] = ['cockpit', 'chase'];

export const VIEW_LABEL: Record<ViewMode, { code: string; zh: string; en: string }> = {
  cockpit: { code: 'CPT', zh: '座舱视角', en: 'COCKPIT' },
  chase: { code: 'CHS', zh: '第三人称', en: 'CHASE' },
};

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'cockpit' || value === 'chase';
}

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

/** v0.4 airframe classes. The profile table lives in `sim/enemies.ts`. */
export type EnemyId =
  | 'scout'
  | 'interceptor'
  | 'heavy'
  | 'jammer'
  | 'drone'
  | 'ace'
  | 'commander';

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
  /** v0.4: seconds left in the current gun burst; 0 when not shooting. */
  gunBurst: number;
  /** v0.4: seconds until the next burst may start. */
  gunCooldown: number;
  /** v0.4: rounds that connected in the burst, for the radio taunt. */
  burstHits: number;
}

export interface MissileState {
  targetId: string;
  speed: number;
  life: number;
  maxLife: number;
  owner: Team;
  /** True once the missile has already played its close-pass whoosh. */
  whooshed: boolean;
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
  /** v0.4 airframe class; null for the player, the wingman and the boss. */
  enemyId: EnemyId | null;
  ai: AIState | null;
  missile: MissileState | null;
  weakpoint: WeakpointState | null;
  /**
   * v0.5: ballistic drift for entities the simulation does not fly — flares
   * currently. `null` means the entity holds its position.
   */
  drift: Vec3 | null;
  life: number;
  maxLife: number;
}

/**
 * v0.3 splits the old three-effect vocabulary into readable impact language:
 * `spark` and `debris` sell a gun hit, `shield` says "wrong target", `flak`
 * builds the battlefield behind the fight and `smoke` trails a wounded airframe.
 *
 * v0.5 adds the three effects the boss fight and the chase camera need: `beam`
 * for the spinal lance, `pulse` for the shield discharge, and `vapour` for the
 * wingtip condensation a hard manoeuvre pulls out of the air.
 */
export type EffectKind =
  | 'explosion'
  | 'shockwave'
  | 'tracer'
  | 'muzzle'
  | 'spark'
  | 'debris'
  | 'smoke'
  | 'shield'
  | 'flak'
  | 'flash'
  | 'beam'
  | 'pulse'
  | 'vapour';

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
  /** m/s for effects that travel — sparks, debris, smoke. */
  velocity: Vec3 | null;
  /** Gravity in m/s²; 0 for purely additive glows. */
  gravity: number;
  /** Radians per second of tumble, used by debris. */
  spin: number;
  /** Stable 0..1 jitter so a renderer can vary an effect without extra fields. */
  seed: number;
}

export interface ScenarioEnemy {
  callsign: string;
  variant?: 'standard' | 'ace';
  /** v0.4 airframe class. Falls back to a callsign lookup when omitted. */
  enemy?: EnemyId;
  distance: number;
  side: number;
  vertical: number;
}

/**
 * v0.4 reinforcement wave. The scenario's flat `enemies` list is wave one; each
 * entry here arrives once the previous fighting has burned down enough.
 */
export interface ScenarioWave {
  id: string;
  /** Display code, e.g. "WAVE 2". */
  code: string;
  labelEn: string;
  labelZh: string;
  /** Arrives once kills reach this count… */
  atKills: number;
  /** …or this many seconds have passed, whichever comes first. */
  atTime: number;
  /** Max hostiles in the air, this wave's own aircraft included. */
  concurrent?: number;
  /** Overrides the generated AWACS call. */
  alertZh?: string;
  units: ScenarioEnemy[];
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
  /** v0.4: later waves, in arrival order. */
  reinforcements?: ScenarioWave[];
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

export type CommsRole = 'awacs' | 'wingman' | 'command' | 'system' | 'enemy' | 'auto';

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
  /** v0.4 airframe class, so the HUD can print a threat-database code. */
  enemyId: EnemyId | null;
  distance: number;
  hp: number;
  maxHp: number;
  angle: number;
  selected: boolean;
  locked: boolean;
  lockProgress: number;
  lockable: boolean;
  /** True for the bandit the autopilot would go for next. */
  priority: number;
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

/**
 * v0.5: the dreadnought's attack telegraph. The HUD reads this to print the
 * incoming attack, its countdown and — the part that makes the fight a fight —
 * the counter the player is supposed to fly.
 */
export interface BossAttackHud {
  id: BossAttackId;
  code: string;
  labelEn: string;
  labelZh: string;
  counterEn: string;
  counterZh: string;
  /** Three-letter code of the manoeuvre that beats it, when one does. */
  counterCode: string | null;
  phase: BossAttackPhase;
  /** 0..1 through the telegraph, then through the active window. */
  progress: number;
  /** Seconds until the telegraph resolves, or until the effect ends. */
  remaining: number;
  severity: 'caution' | 'warning' | 'critical';
  /** How many times this attack has been used this sortie. */
  uses: number;
}

export interface BossHud {
  id: string;
  callsign: string;
  nameEn: string;
  nameZh: string;
  hp: number;
  maxHp: number;
  stage: 1 | 2 | 3;
  /** Localised stage readout, e.g. "护盾完整". */
  stageLabel: string;
  stageCode: string;
  /** Range from the player to the dreadnought's centre, in metres. */
  distance: number;
  /** True while the player is inside the hull's lethal envelope. */
  tooClose: boolean;
  /** v0.5 attack telegraph, or null between attacks. */
  attack: BossAttackHud | null;
  /** Seconds until the next attack is chosen; null while one is running. */
  nextIn: number | null;
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
  /** v0.4: an enemy jammer is degrading the fire-control solution. */
  jammed: boolean;
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

/** Transient "you connected" marker. `age` is seconds since the hit landed. */
export interface HitMarker {
  id: number;
  age: number;
  /** Seconds the marker should stay up, so the HUD can fade it correctly. */
  duration: number;
  damage: number;
  /** The hit destroyed the target. */
  kill: boolean;
  /** Weakpoint damage gets the heavier bracket. */
  kind: TargetKind;
}

/** Damage the player took, with the bearing it arrived from. */
export interface IncomingHit {
  id: number;
  age: number;
  duration: number;
  amount: number;
  /** Degrees clockwise from the nose: 0 ahead, 90 right, 180 behind. */
  bearing: number;
  severity: 'caution' | 'warning' | 'critical';
}

/** One line of the kill ticker. */
export interface KillFeedEntry {
  id: number;
  age: number;
  duration: number;
  callsign: string;
  label: string;
  points: number;
  ace: boolean;
  weakpoint: boolean;
}

/**
 * Everything the HUD needs to make a hit feel like a hit. Produced by the
 * simulation so the DOM layer stays a pure function of the snapshot.
 */
export interface CombatFeedback {
  hit: HitMarker | null;
  incoming: IncomingHit[];
  kills: KillFeedEntry[];
  /** 0..1 smoothed battle intensity, shared with the score and the visual grade. */
  intensity: number;
  /** 0..1 proximity of the nearest hostile — drives the music and the ambience. */
  threat: number;
  /** Rolling count of player hits in the last two seconds, for the combo readout. */
  combo: number;
}

/* ------------------------------------------------------------------ */
/* v0.4 — the stage, the waves and the auto-pilot                      */
/* ------------------------------------------------------------------ */

/** One line of the enemy-threat readout. */
export interface RosterEntry {
  enemyId: EnemyId;
  code: string;
  labelZh: string;
  labelEn: string;
  /** Allocated to the mission, whether or not it is airborne yet. */
  total: number;
  /** Still flying. */
  alive: number;
  /** Already shot down. */
  down: number;
}

export interface WaveHud {
  /** "WAVE 2 / 4" — the initial wave counts as one. */
  index: number;
  total: number;
  code: string;
  labelEn: string;
  labelZh: string;
  /** Seconds until the next wave is released, or null when none are left. */
  nextIn: number | null;
  /** True right after a wave arrives, for the HUD flash. */
  inbound: boolean;
  /** Airborne hostiles. */
  hostiles: number;
  roster: RosterEntry[];
}

export type AutoPilotMode =
  | 'standby'
  | 'transit'
  | 'engage'
  | 'defend'
  | 'showcase'
  | 'recover'
  | 'complete';

export interface AutoPilotHud {
  engaged: boolean;
  mode: AutoPilotMode;
  /** Three-letter code for the compact rail. */
  code: string;
  labelEn: string;
  labelZh: string;
  /** The move it is flying right now, if any. */
  callout: string;
  /** 0..1 progress through the active scripted manoeuvre. */
  progress: number;
  /** How many distinct manoeuvres it has shown the audience. */
  demonstrated: number;
  total: number;
  /** Total style plays flown this sortie. */
  plays: number;
  /** 0..1 self-assessed condition — hull, ammo and threat rolled together. */
  condition: number;
  /** The bandit it is currently working on. */
  targetCallsign: string | null;
  /** Seconds until it climbs back in after being shot down. */
  retryIn: number | null;
  /** Ordered list of the moves it has already shown. */
  shown: ManeuverId[];
}

export interface CockpitSnapshot {
  phase: MissionPhase;
  paused: boolean;
  elapsed: number;
  operation: string;
  titleEn: string;
  titleZh: string;
  /** v0.5: which camera the player is riding in. */
  view: ViewMode;
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
  combat: CombatFeedback;
  /** v0.4: the wave the mission is on, plus the enemy roster tally. */
  wave: WaveHud;
  /** v0.4: the auto-pilot's own readout. */
  auto: AutoPilotHud;
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
  | {
      type: 'hit';
      targetId: string;
      damage: number;
      mine: boolean;
      /** Which weapon connected — the audio layer voices them differently. */
      weapon: 'gun' | 'missile';
      kind: TargetKind;
      /** The shot destroyed the target. */
      kill: boolean;
    }
  | { type: 'shield-deflect'; key: WeakpointKey }
  | { type: 'kill'; targetId: string; callsign: string; label: string; points: number; ace: boolean }
  | { type: 'flyby'; team: Team; distance: number }
  | { type: 'explosion'; position: Vec3; scale: number; distance: number }
  | { type: 'flare' }
  | { type: 'warning'; warning: WarningState }
  | { type: 'damage'; amount: number; bearing: number }
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
  | { type: 'mission-failed' }
  /* --- v0.4 --- */
  | { type: 'wave-inbound'; code: string; labelZh: string; units: number }
  | { type: 'enemy-gun'; id: string }
  | { type: 'jammer-active'; engaged: boolean }
  | { type: 'auto-engage'; enabled: boolean }
  | { type: 'auto-play'; maneuver: ManeuverId; playId: string; demonstration: boolean }
  | { type: 'auto-retry' }
  | { type: 'auto-complete' }
  /* --- v0.5 --- */
  | { type: 'boss-attack'; id: BossAttackId; phase: BossAttackPhase }
  | { type: 'boss-lance-fire'; origin: Vec3; axis: Vec3 }
  | { type: 'hull-impact'; part: string; damage: number }
  | { type: 'view-change'; mode: ViewMode };

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
  /** 0..1 progress of the current lock — the tone rises with it. */
  lockProgress: number;
  missileWarning: boolean;
  bossActive: boolean;
  elapsed: number;
  maneuver: ManeuverId | null;
  airbrake: boolean;
  assistEngaged: number;
  /** 0..1 proximity and threat of the nearest hostile. */
  threat: number;
  /** 0..1 smoothed battle intensity — drives the score's section choice. */
  intensity: number;
  /** Rolling player hits in the last two seconds. */
  combo: number;
}
