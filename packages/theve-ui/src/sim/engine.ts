import {
  add,
  angleBetween,
  approach,
  bearingDegrees,
  clamp,
  damp,
  distance,
  formatClock,
  forwardFromAngles,
  headingFromYaw,
  lerp,
  normalize,
  RAD,
  randomRange,
  rightFromYaw,
  scale,
  sub,
  vec3,
  wrapRadians,
  yawFromHeading,
  yawPitchFromDirection,
} from './math';
import { sunsetSpearScenario } from './scenario';
import {
  buildManeuverStatus,
  checkManeuverAvailability,
  MANEUVERS,
  type ManeuverDefinition,
} from './maneuvers';
import {
  buildAssistStatus,
  DEFAULT_ASSISTS,
  normalizeAssists,
  solveAssists,
  type AssistSolution,
} from './assists';
import { buildTutorialState, createTutorialFlags, type TutorialFlags } from './tutorial';
import {
  createAIState,
  enemyPriority,
  enemyProfile,
  ENEMIES,
  resolveEnemyId,
  SHOWCASE_ORDER,
  waveBriefing,
  waveReady,
  type EnemyProfile,
} from './enemies';
import {
  BOSS_ANCHOR,
  BOSS_ATTACKS,
  BOSS_HULL_RADIUS,
  BOSS_LANCE_MUZZLE,
  BOSS_STAGE_LABEL,
  BOSS_TURRETS,
  BOSS_VISUAL_IDLE,
  BOSS_VLS,
  bossAnchor,
  bossHitTest,
  bossHullPushOut,
  bossSegmentHit,
  lanceHits,
  lanceOffset,
  lanceRadius,
  type BossAttackDefinition,
  type BossAttackId,
  type BossAttackPhase,
  type BossPose,
  type BossVisualState,
} from './boss';
import {
  autoPilotCondition,
  autoPilotShown,
  AUTO_MODE_LABEL,
  createAutoPilotMemory,
  resetAutoPilotMemory,
  solveAutoPilot,
  type AutoPilotContact,
  type AutoPilotHazard,
  type AutoPilotMemory,
  type AutoPilotThreat,
  type AutoPilotWorld,
} from './autopilot';
import type {
  AssistId,
  AssistSettings,
  AudioTelemetry,
  AutoPilotHud,
  BossAttackHud,
  BossHud,
  CockpitSnapshot,
  CombatFeedback,
  CommsMessage,
  CommsRole,
  ControlInput,
  EffectColor,
  EffectKind,
  EnemyId,
  FlightState,
  HitMarker,
  HudTarget,
  IncomingHit,
  KillFeedEntry,
  LockState,
  ManeuverId,
  ManeuverSnapshot,
  MissionPhase,
  MissionStats,
  Projection,
  RadarContact,
  RosterEntry,
  Scenario,
  ScenarioWave,
  SimEffect,
  SimEntity,
  SimEvent,
  SimListener,
  TutorialStepId,
  Vec3,
  ViewMode,
  WarningState,
  WaveHud,
  WeakpointKey,
  WeaponId,
  WingmanHud,
} from './types';
import { isViewMode, VIEW_LABEL } from './types';

const MISSILE_MAX = 10;
const GUN_MAX = 900;
const FLARE_MAX = 6;
/** v0.5: cartridges per press, their burn time, and the decoy radius. */
const FLARE_SALVO = 4;
const FLARE_LIFE = 3.4;
const FLARE_FALL = 16;
const FLARE_SEDUCE_RANGE = 130;
const LOCK_CONE_DEG = 12;
const LOCK_RANGE = 3600;
const LOCK_TIME = 0.9;
/**
 * v0.4 gun envelope. v0.3's 5.5° / 1750 m was tuned against a three-ship
 * formation where every bandit came at you head-on. Against the eight-plus of
 * v0.4, with escorts crossing the nose and a dreadnought's shield nodes to
 * strafe, it left gunnery as a lottery rather than a skill. A slightly wider
 * envelope keeps the gun a weapon you have to point, while making pointing it
 * actually pay.
 */
const GUN_CONE_DEG = 7.5;
const GUN_RANGE = 2000;
const PLAYER_MAX_HP = 100;
const RADAR_RANGE = 9000;

/* --- v0.2 handling constants ---------------------------------------- */
/** Cruise speed at idle / military power / full afterburner. */
const SPEED_IDLE = 118;
const SPEED_SPAN = 168;
const SPEED_AB_BONUS = 38;
const SPEED_MAX = 330;
const SPEED_FLOOR = 150;
/** How much climbing bleeds and diving builds energy. */
const GRAVITY_BIAS = 46;
/** Roll inertia: angular acceleration, damping and the resulting rate cap. */
const ROLL_ACCEL = 13.4;
const ROLL_DAMP = 6.2;
const ROLL_RATE_MAX = 3.7;
/** Pitch is rate-commanded with a first-order lag so the nose has weight. */
const PITCH_RATE_MAX = 1.06;
const PITCH_LAG = 8.2;
const PITCH_LIMIT = 1.35;
/** Induced drag from pulling and rolling. */
const PITCH_DRAG = 30;
const ROLL_DRAG = 4;
/** How quickly pilot input builds versus how quickly it relaxes. */
const INPUT_ATTACK = 9.5;
const INPUT_RELEASE = 6.2;
const GROUND_FLOOR = 140;
const CEILING = 14000;
const TUTORIAL_AUTO_HIDE = 30;
const TUTORIAL_LINGER = 6;
const BOSS_WEAKPOINT_HP: Record<WeakpointKey, number> = {
  shieldL: 120,
  shieldR: 120,
  core: 360,
};
const BOSS_WEAKPOINT_LABEL: Record<WeakpointKey, string> = {
  shieldL: 'SHIELD NODE A',
  shieldR: 'SHIELD NODE B',
  core: 'REACTOR CORE',
};
/**
 * v0.5 hit volumes. v0.4 tested a gun shot against a pure cone and a missile
 * against a flat 62 m sphere, so a 26 m shield node on a drifting dreadnought
 * was a lottery and a fighter's wingspan was imaginary. Every weapon now fuses
 * against the target's real radius, and the boss carries a compound collider.
 */
const GUN_RADIUS_PAD = 1;
const MISSILE_FUSE_BASE = 34;
const MISSILE_FUSE_PAD = 14;
/** How much room the player gets before the dreadnought's hull is solid. */
const HULL_GRACE = 12;
/** Longest single-frame shove out of the hull, in metres. */
const HULL_PUSH_MAX = 30;

/* --- v0.3 impact feedback ------------------------------------------- */
/** How long the HUD keeps a hit marker up. */
const HIT_MARKER_TIME = 0.42;
/** Kill ticker lines linger long enough to be read after the explosion. */
const KILL_FEED_TIME = 4.2;
/** Damage wedges point at the shooter for roughly two seconds. */
const INCOMING_TIME = 2.1;
/** Sliding window used for the combo counter. */
const COMBO_WINDOW = 2;
/** Hard ceiling on live effects; the oldest low-value ones are dropped first. */
const EFFECT_BUDGET = 190;
/** Effects that may be recycled early when the budget is full, cheapest first. */
const EFFECT_PRIORITY: Record<EffectKind, number> = {
  vapour: 0,
  spark: 0,
  smoke: 1,
  tracer: 2,
  debris: 3,
  muzzle: 4,
  flak: 5,
  flash: 6,
  explosion: 7,
  pulse: 7,
  shield: 8,
  beam: 8,
  shockwave: 9,
};
/** Ambient battlefield flak cadence per phase, in seconds. */
const AMBIENCE_INTERVAL: Partial<Record<MissionPhase, [number, number]>> = {
  dogfight: [2.6, 4.8],
  boss: [1.5, 3.1],
};

/**
 * v0.4: hull patched at the mid-mission resupply. The bandit count tripled and
 * they carry guns now, so the second half of the sortie needs the concession.
 */
const RESUPPLY_REPAIR = 38;

/** v0.4: the wingman gets a different line for every airframe class. */const KILL_LINES: Record<EnemyId, string[]> = {
  scout: ['侦察机清掉了，他跑得再快也没你快。', '那个轻家伙散了，雷达干净一点。'],
  interceptor: ['VESPER 被击落，干得漂亮。', '确认击落，雷达上少了一个光点。'],
  heavy: ['重装机解体了！那身装甲也没扛住。', '好，机炮压制解除了 — 刚才那阵弹雨真够呛。'],
  jammer: ['干扰机掉了！火控恢复正常，趁现在。', '电子战机被击落，锁定速度回来了。'],
  drone: ['无人机清了一架，还剩不少。', '打掉一个，它们实在太多。'],
  ace: ['王牌掉了！这就是 CIRRUS 的答案。', 'VESPER ACE 被击落，敌编队正在崩溃。'],
  commander: ['指挥机被击落！他们的编队散了 — 就是现在！', '长机掉了，剩下的在乱飞。'],
};

interface FlakStrike {
  at: number;
  offset: Vec3;
}

/**
 * v0.5: the first time the dreadnought uses an attack, AWACS explains it. The
 * HUD telegraph carries the counter on every use; this is the in-fiction beat
 * that teaches the mechanic once.
 */
const BOSS_ATTACK_CALLOUT: Record<BossAttackId, string> = {
  ciws: 'LEVIATHAN 近防炮开始拦截 — 不要正对舰体直线进入，做侧向掠袭。',
  salvo: '垂直发射井开启！四发齐射 — 放热焰弹，别硬吃。',
  pulse: '护盾电容过载 — 它在蓄能！离开一千米内，快！',
  lance: '主炮炮口开启，这是照射武器！横向脱离炮轴，不要留在它的准线上。',
};

/** And the wingman heckles it every time after that. */
const BOSS_ATTACK_WINGMAN: Record<BossAttackId, string> = {
  ciws: '弹幕太密了，队长 — 换条进航线！',
  salvo: '又来一轮齐射，热焰弹！',
  pulse: '它又在充能，拉开距离！',
  lance: '主炮在转 — 离开那条线！',
};

/** A scheduled background burst that decorates the sky but never damages. */
interface AmbientStrike {
  at: number;
  position: Vec3;
  scale: number;
}

interface GunTarget {
  entity: SimEntity;
  point: Vec3;
}

function emptyStats(): MissionStats {
  return {
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    missilesFired: 0,
    missilesHit: 0,
    damageTaken: 0,
    elapsed: 0,
    score: 0,
    rank: null,
  };
}

/** Stall floor of the running scripted manoeuvre, if any. */
function scriptedFloor(scripted: { id: ManeuverId } | null): number | null {
  if (!scripted) return null;
  return MANEUVERS[scripted.id].profile?.speedFloor ?? null;
}

export class CockpitEngine {
  readonly scenario: Scenario;

  phase: MissionPhase = 'idle';
  paused = false;
  elapsed = 0;

  flight: FlightState = {
    position: vec3(0, 6800, 0),
    yaw: 0,
    pitch: 0,
    roll: 0,
    rollRate: 0,
    pitchRate: 0,
    speed: 255,
    throttle: 0.7,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    gLoad: 1,
    afterburner: false,
    airbrake: false,
    highG: false,
    postStall: false,
  };

  weapons = {
    selected: 'aam' as WeaponId,
    missiles: MISSILE_MAX,
    maxMissiles: MISSILE_MAX,
    gunAmmo: GUN_MAX,
    gunMax: GUN_MAX,
    flares: FLARE_MAX,
    maxFlares: FLARE_MAX,
  };

  entities: SimEntity[] = [];
  effects: SimEffect[] = [];

  private listeners = new Set<SimListener>();
  private projections = new Map<string, Projection>();

  private input: ControlInput = { pitch: 0, roll: 0, yaw: 0 };
  private inputTarget: ControlInput = { pitch: 0, roll: 0, yaw: 0 };
  private throttleAxis = 0;
  /** Throttle the pilot last asked for — the flight aids never go below it. */
  private pilotThrottle = 0.7;
  private throttleIdle = 0;

  /* --- v0.2 manoeuvres & flight aids --------------------------------- */
  private sustained: ManeuverId | null = null;
  private scripted: {
    id: ManeuverId;
    time: number;
    entryPitch: number;
    entryRoll: number;
  } | null = null;
  private scriptedG = 1;
  private velocityDir: Vec3 | null = null;
  private travelDir: Vec3 = vec3(0, 0, -1);
  private assistSettings: AssistSettings = { ...DEFAULT_ASSISTS };
  private assistMaster = true;
  private assistSolution: AssistSolution | null = null;
  private assistAnnounced = new Set<AssistId>();
  private stallAnnounced = false;
  private tutorialFlags: TutorialFlags = createTutorialFlags();
  private tutorialDismissed = false;
  private tutorialTimer = 0;
  private tutorialDoneAt: number | null = null;
  private attitudeSeen = { pitch: false, roll: false };

  private selectedId: string | null = null;
  private lockProgress = 0;
  private lockInCone = false;
  private lockWasLocked = false;
  private lockDistance = 0;
  private lockSteering = 0;
  private lockElevation = 0;

  private gunHeld = false;
  private gunBurst = 0;
  private gunAccumulator = 0;
  private gunFiring = false;
  private fireCooldown = 0;
  private flareCooldown = 0;

  private wingmanId: string | null = null;
  private bossId: string | null = null;
  private bossDefeated = false;
  private bossIntroTimer = 0;
  private completionTimer = 0;
  private bootTimer = 0;
  private flakTimer = 0;
  private flak: FlakStrike | null = null;
  private droneTimer = 0;

  /* --- v0.5 boss director -------------------------------------------- */
  /** The attack currently running, or null between attacks. */
  private bossAttackId: BossAttackId | null = null;
  private bossAttackPhase: BossAttackPhase = 'idle';
  /** Seconds left in the current phase. */
  private bossAttackTimer = 0;
  /** Seconds until the director may pick a new attack. */
  private bossAttackCooldown = 0;
  /** Per-attack cooldowns and use counts, so nothing chains. */
  private bossAttackReady = new Map<BossAttackId, number>();
  private bossAttackUses = new Map<BossAttackId, number>();
  /** Direction the spinal lance locked onto when it finished charging. */
  private lanceAxis: Vec3 | null = null;
  /** Seconds the player has spent inside the shield umbrella. */
  private loiter = 0;
  /** 0..1 radial shockwave readout for the renderer. */
  private pulseGlow = 0;
  /** Turret heat, drives the CIWS muzzle flashes and the tracer density. */
  private turretHeat = 0;
  private salvoFired = 0;
  /** Announced-every-attack-once flags, for the AWACS callouts. */
  private bossSeenAttacks = new Set<BossAttackId>();
  private hullScrapeCooldown = 0;

  /**
   * v0.5 view mode. It lives on the engine rather than in React state because
   * the three.js layer reads it every frame, and it has to survive the pause
   * menu, a restart and a page reload.
   */
  private view: ViewMode = 'cockpit';
  /**
   * Camera shake the simulation asks for directly (beam fire, hull strikes).
   * The renderer drains it through `drainShake`.
   */
  private pendingShake = 0;

  private kills = 0;
  private score = 0;
  private stats: MissionStats = emptyStats();
  private comms: CommsMessage[] = [];
  private warnings: WarningState[] = [];
  private idCounter = 0;

  /* --- v0.3 impact feedback ------------------------------------------ */
  private hitMarker: HitMarker | null = null;
  private incoming: IncomingHit[] = [];
  private killFeed: KillFeedEntry[] = [];
  private comboHits: number[] = [];
  private feedbackId = 0;
  private intensity = 0;
  private threat = 0;
  private ambience: AmbientStrike[] = [];
  private ambienceTimer = 0;

  /* --- v0.4 waves & auto-pilot --------------------------------------- */
  /** How many reinforcement waves have already been released. */
  private waveIndex = 0;
  /** Short timer that lights up the "wave inbound" HUD flash. */
  private waveInboundTimer = 0;
  /** Airframe classes allocated to this sortie, for the roster readout. */
  private roster = new Map<EnemyId, number>();
  /** Bandits already shot down, per airframe class. */
  private rosterDown = new Map<EnemyId, number>();
  private jammerEngaged = false;
  private autoPilot = false;
  private autoMemory: AutoPilotMemory = createAutoPilotMemory();
  private autoRetryTimer: number | null = null;
  /** Latest command solved by the performer, replayed by the public actions. */
  private autoGun = false;

  constructor(scenario: Scenario = sunsetSpearScenario) {
    this.scenario = scenario;
    this.reset();
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  reset(): void {
    this.phase = 'idle';
    this.paused = false;
    this.elapsed = 0;
    this.flight = {
      position: vec3(0, this.scenario.start.altitude, 0),
      yaw: yawFromHeading(this.scenario.start.heading),
      pitch: 0,
      roll: 0,
      rollRate: 0,
      pitchRate: 0,
      speed: this.scenario.start.speed,
      throttle: 0.7,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      gLoad: 1,
      afterburner: false,
      airbrake: false,
      highG: false,
      postStall: false,
    };
    this.weapons = {
      selected: 'aam',
      missiles: MISSILE_MAX,
      maxMissiles: MISSILE_MAX,
      gunAmmo: GUN_MAX,
      gunMax: GUN_MAX,
      flares: FLARE_MAX,
      maxFlares: FLARE_MAX,
    };
    this.input = { pitch: 0, roll: 0, yaw: 0 };
    this.inputTarget = { pitch: 0, roll: 0, yaw: 0 };
    this.throttleAxis = 0;
    this.pilotThrottle = 0.7;
    this.throttleIdle = 0;
    this.sustained = null;
    this.scripted = null;
    this.scriptedG = 1;
    this.velocityDir = null;
    this.travelDir = vec3(0, 0, -1);
    this.assistSolution = null;
    this.assistAnnounced.clear();
    this.stallAnnounced = false;
    this.tutorialFlags = createTutorialFlags();
    this.tutorialDismissed = false;
    this.tutorialTimer = 0;
    this.tutorialDoneAt = null;
    this.attitudeSeen = { pitch: false, roll: false };
    this.entities = [];
    this.effects = [];
    this.projections.clear();
    this.selectedId = null;
    this.lockProgress = 0;
    this.lockInCone = false;
    this.lockWasLocked = false;
    this.lockDistance = 0;
    this.lockSteering = 0;
    this.lockElevation = 0;
    this.gunHeld = false;
    this.gunBurst = 0;
    this.gunAccumulator = 0;
    this.gunFiring = false;
    this.fireCooldown = 0;
    this.flareCooldown = 0;
    this.wingmanId = null;
    this.bossId = null;
    this.bossDefeated = false;
    this.bossIntroTimer = 0;
    this.completionTimer = 0;
    this.bootTimer = 0;
    this.flakTimer = 0;
    this.flak = null;
    this.droneTimer = 0;
    this.bossAttackId = null;
    this.bossAttackPhase = 'idle';
    this.bossAttackTimer = 0;
    this.bossAttackCooldown = 0;
    this.bossAttackReady.clear();
    this.bossAttackUses.clear();
    this.bossSeenAttacks.clear();
    this.lanceAxis = null;
    this.loiter = 0;
    this.pulseGlow = 0;
    this.turretHeat = 0;
    this.salvoFired = 0;
    this.hullScrapeCooldown = 0;
    this.kills = 0;
    this.score = 0;
    this.stats = emptyStats();
    this.comms = [];
    this.warnings = [];
    this.idCounter = 0;
    this.hitMarker = null;
    this.incoming = [];
    this.killFeed = [];
    this.comboHits = [];
    this.feedbackId = 0;
    this.intensity = 0;
    this.threat = 0;
    this.ambience = [];
    this.ambienceTimer = 1.6;

    /* v0.4 — the stage and the performer. The demo reel deliberately survives
       a restart: "clear the game automatically" should not re-learn its own
       routine every time it is shot down. */
    this.waveIndex = 0;
    this.waveInboundTimer = 0;
    this.jammerEngaged = false;
    this.autoRetryTimer = null;
    this.autoGun = false;
    this.roster = new Map();
    this.rosterDown = new Map();
    for (const unit of this.allHostileUnits()) {
      const id = resolveEnemyId(unit);
      this.roster.set(id, (this.roster.get(id) ?? 0) + 1);
    }
    resetAutoPilotMemory(this.autoMemory);
  }

  /** Every bandit the scenario can put in the air, initial wave included. */
  private allHostileUnits() {
    const waves = this.scenario.reinforcements ?? [];
    return [...this.scenario.enemies, ...waves.flatMap((wave) => wave.units)];
  }

  getReinforcements(): readonly ScenarioWave[] {
    return this.scenario.reinforcements ?? [];
  }

  launch(): void {
    this.reset();
    this.phase = 'boot';
    this.bootTimer = 2.8;
    this.say(this.scenario.awacsCallsign, 'awacs', 'LUMEN 1，数据链同步完成。空域已清空，随时可以出发。');
    this.say(this.scenario.wingmanCallsign, 'wingman', 'LUMEN 2 编队就位。队长，落日空域的风很干净。');
    this.emit({ type: 'boot' });
  }

  skipBoot(): void {
    if (this.phase === 'boot') this.beginCombat();
  }

  restart(): void {
    this.launch();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  on(listener: SimListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SimEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /* ------------------------------------------------------------------ */
  /* public actions                                                      */
  /* ------------------------------------------------------------------ */

  setInput(partial: Partial<ControlInput>): void {
    // The performer owns the stick while it is flying; a stray keypress must
    // not fight it. `AUTO ACE` itself is switched from a separate action.
    if (this.autoPilot) return;
    this.applyInput(partial);
  }

  setThrottle(value: number): void {
    if (this.autoPilot) return;
    this.applyThrottle(value);
  }

  adjustThrottle(delta: number): void {
    if (this.autoPilot) return;
    this.applyThrottle(this.flight.throttle + delta);
  }

  setThrottleAxis(axis: number): void {
    if (this.autoPilot) return;
    this.throttleAxis = clamp(axis, -1, 1);
    if (this.throttleAxis !== 0) {
      this.throttleIdle = 0;
      this.completeTutorial('throttle');
    }
  }

  /* ------------------------------------------------------------------ */
  /* v0.2 manoeuvres & flight aids                                       */
  /* ------------------------------------------------------------------ */

  setAssists(settings: Partial<AssistSettings>): void {
    this.assistSettings = normalizeAssists({ ...this.assistSettings, ...settings });
  }

  setAssist(id: AssistId, enabled: boolean): void {
    if (this.assistSettings[id] === enabled) return;
    this.assistSettings = { ...this.assistSettings, [id]: enabled };
    this.emit({ type: 'assist-toggle', id, enabled: enabled && this.assistMaster });
    if (!enabled) this.assistAnnounced.delete(id);
  }

  toggleAssists(): boolean {
    this.setAssistMaster(!this.assistMaster, true);
    return this.assistMaster;
  }

  setAssistMaster(enabled: boolean, announce = false): void {
    if (this.assistMaster === enabled) return;
    this.assistMaster = enabled;
    this.emit({ type: 'assist-toggle', id: 'master', enabled });
    if (enabled) this.assistAnnounced.clear();
    if (announce) {
      this.warn(
        'system',
        'caution',
        enabled ? 'ASSIST ON' : 'ASSIST OFF',
        enabled ? '辅助驾驶已接通 · Y 切换' : '辅助驾驶已断开 · 全手动',
        1.6,
      );
    }
  }

  getAssistMaster(): boolean {
    return this.assistMaster;
  }

  /** Engages a held manoeuvre (sustained) or ignites a timed profile. */
  startManeuver(id: ManeuverId): boolean {
    const definition = MANEUVERS[id];
    if (!definition) return false;
    if (!this.canUseWeapons()) return false;
    if (definition.kind === 'sustained') {
      if (this.sustained === id) return true;
      const gate = checkManeuverAvailability(id, {
        speed: this.flight.speed,
        altitude: this.flight.position.y,
        activeManeuver: this.activeManeuver(),
      });
      if (!gate.available) {
        this.blockManeuver(id, gate.blocked);
        return false;
      }
      this.sustained = id;
    } else {
      if (this.scripted) return false;
      const gate = checkManeuverAvailability(id, {
        speed: this.flight.speed,
        altitude: this.flight.position.y,
        activeManeuver: this.activeManeuver(),
      });
      if (!gate.available) {
        this.blockManeuver(id, gate.blocked);
        return false;
      }
      this.scripted = {
        id,
        time: 0,
        entryPitch: this.flight.pitch,
        entryRoll: this.flight.roll,
      };
      this.scriptedG = 1;
      this.velocityDir = forwardFromAngles(this.flight.yaw, this.flight.pitch);
      this.breakMissileLock(definition.decoyChance);
    }
    this.completeTutorial('maneuver');
    this.emit({ type: 'maneuver-start', id });
    return true;
  }

  endManeuver(id: ManeuverId): void {
    if (this.sustained !== id) return;
    this.sustained = null;
    this.emit({ type: 'maneuver-end', id });
  }

  isManeuverActive(id: ManeuverId): boolean {
    return this.activeManeuver() === id;
  }

  cancelManeuvers(): void {
    if (this.sustained) {
      const id = this.sustained;
      this.sustained = null;
      this.emit({ type: 'maneuver-end', id });
    }
    if (this.scripted) this.finishScripted();
  }

  dismissTutorial(): void {
    if (this.tutorialDismissed) return;
    this.tutorialDismissed = true;
    this.emit({ type: 'tutorial-dismissed' });
  }

  restartTutorial(): void {
    this.tutorialDismissed = false;
    this.tutorialTimer = 0;
    this.tutorialDoneAt = null;
  }

  /* ------------------------------------------------------------------ */
  /* v0.4 AUTO ACE — one switch, the whole sortie                        */
  /* ------------------------------------------------------------------ */

  isAutoPilot(): boolean {
    return this.autoPilot;
  }

  toggleAutoPilot(): boolean {
    this.setAutoPilot(!this.autoPilot);
    return this.autoPilot;
  }

  /**
   * Hand the aircraft to the performer. Engaging it is deliberately enough to
   * finish the game: from the briefing it launches, from the boot sequence it
   * waits out the self-test, and if it is ever shot down it climbs back in and
   * flies the sortie again. Disengaging hands the stick straight back.
   */
  setAutoPilot(enabled: boolean): void {
    if (this.autoPilot === enabled) return;
    this.autoPilot = enabled;
    this.autoRetryTimer = null;
    if (enabled) {
      resetAutoPilotMemory(this.autoMemory, false);
      this.autoMemory.mode = 'standby';
      if (this.phase === 'idle') this.launch();
      this.warn(
        'system',
        'caution',
        'AUTO ACE ENGAGED',
        '全自动皇牌模式接通 — 飞控接管，观赏机动展示',
        3.4,
      );
      this.say(this.scenario.callsign, 'auto', 'AUTO ACE 接通。队长，把杆交给我，看一场表演。');
    } else {
      this.autoGun = false;
      this.gunHeld = false;
      this.cancelManeuvers();
      this.warn('system', 'caution', 'MANUAL CONTROL', '全自动模式断开 — 操纵权已交还', 2.4);
      this.say(this.scenario.callsign, 'auto', '收到，操纵权交还。');
    }
    this.emit({ type: 'auto-engage', enabled });
  }

  getAutoPilotMemory(): Readonly<AutoPilotMemory> {
    return this.autoMemory;
  }

  /** Build the performer's view of the world. Called once per simulation tick. */
  private buildAutoPilotWorld(dt: number): AutoPilotWorld {
    const flight = this.flight;
    const forward = forwardFromAngles(flight.yaw, flight.pitch);

    const contacts: AutoPilotContact[] = [];
    for (const entity of this.entities) {
      if (!this.isLockable(entity)) continue;
      const toTarget = sub(entity.position, flight.position);
      const range = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
      const angles = yawPitchFromDirection(toTarget);
      contacts.push({
        id: entity.id,
        callsign: entity.label || entity.callsign,
        kind: entity.kind === 'weakpoint' ? 'weakpoint' : 'fighter',
        enemyId: entity.enemyId,
        position: entity.position,
        distance: range,
        angle: angleBetween(forward, normalize(toTarget)) * RAD,
        yawError: wrapRadians(angles.yaw - flight.yaw),
        pitchError: angles.pitch - flight.pitch,
        hp: entity.hp,
        maxHp: entity.maxHp,
        lockable: true,
        priority: enemyPriority(entity),
        selected: entity.id === this.selectedId,
      });
    }

    const threats: AutoPilotThreat[] = [];
    const right = rightFromYaw(flight.yaw);
    for (const entity of this.entities) {
      if (!entity.alive || entity.kind !== 'missile') continue;
      if (entity.team !== 'hostile' || entity.missile?.targetId !== 'player') continue;
      const toMissile = sub(entity.position, flight.position);
      const range = Math.sqrt(toMissile.x ** 2 + toMissile.y ** 2 + toMissile.z ** 2);
      // Signed bearing in the same convention as the control axes: positive
      // means the missile sits off the LEFT wing, so `aimAt` can be handed the
      // bearing directly to break away from it.
      const along = toMissile.x * forward.x + toMissile.y * forward.y + toMissile.z * forward.z;
      const lateral = toMissile.x * right.x + toMissile.y * right.y + toMissile.z * right.z;
      const bearing = Math.atan2(-lateral, along) * RAD;
      const closing = Math.max(
        1,
        (entity.missile?.speed ?? 660) + flight.speed * Math.cos(bearing / RAD),
      );
      threats.push({
        id: entity.id,
        distance: range,
        bearing,
        impactIn: range / closing,
      });
    }

    return {
      dt,
      elapsed: this.elapsed,
      phase: this.phase,
      paused: this.paused,
      position: flight.position,
      yaw: flight.yaw,
      pitch: flight.pitch,
      roll: flight.roll,
      rollRate: flight.rollRate,
      speed: flight.speed,
      altitude: flight.position.y,
      gLoad: flight.gLoad,
      hp: flight.hp,
      maxHp: flight.maxHp,
      throttle: flight.throttle,
      activeManeuver: this.activeManeuver(),
      activeProgress: this.scripted
        ? clamp(this.scripted.time / MANEUVERS[this.scripted.id].duration, 0, 1)
        : 0,
      contacts,
      threats,
      hazard: this.bossHazard(),
      selectedId: this.selectedId,
      lock: {
        state: this.getLockState().state,
        progress: this.lockProgress,
        targetId: this.selectedId,
        distance: this.lockDistance,
      },
      weapons: {
        selected: this.weapons.selected,
        missiles: this.weapons.missiles,
        gunAmmo: this.weapons.gunAmmo,
        flares: this.weapons.flares,
      },
      jammed: this.jammerEngaged,
      pendingHostiles: (this.scenario.reinforcements ?? []).length - this.waveIndex,
      coreExposed: this.getWeakpoints().some(
        (weakpoint) => weakpoint.weakpoint?.key === 'core' && weakpoint.weakpoint.targetable,
      ),
    };
  }

  /** Run the performer and apply its commands through the normal controls. */
  private updateAutoPilot(dt: number): void {
    if (!this.autoPilot) return;

    // Being shot down is not the end of "clear the game automatically".
    if (this.phase === 'failed') {
      if (this.autoRetryTimer === null) {
        this.autoRetryTimer = 3.2;
        this.emit({ type: 'auto-retry' });
      }
      this.autoRetryTimer -= dt;
      if (this.autoRetryTimer <= 0) {
        this.autoRetryTimer = null;
        this.launch();
      }
      return;
    }
    if (this.phase === 'complete') {
      if (this.autoGun) {
        this.autoGun = false;
        this.gunHeld = false;
      }
      return;
    }
    if (this.phase === 'idle') {
      this.launch();
      return;
    }

    const world = this.buildAutoPilotWorld(dt);
    const command = solveAutoPilot(world, this.autoMemory);

    // Drain the performer's announcements into the radio and the event bus.
    const playEvent = this.autoMemory.playEvent;
    if (playEvent) {
      this.autoMemory.playEvent = null;
      this.emit({
        type: 'auto-play',
        maneuver: playEvent.maneuver,
        playId: playEvent.playId,
        demonstration: playEvent.demonstration,
      });
      this.completeTutorial('maneuver');
    }
    const announce = this.autoMemory.announce;
    if (announce) {
      this.autoMemory.announce = null;
      this.addComms(this.scenario.callsign, 'auto', announce);
    }

    /* The stick. Written into the same target the keyboard writes into, so the
       input shaping, the flight aids and the whole v0.2 handling model apply
       exactly as they do to a human hand. */
    this.applyInput({ pitch: command.pitch, roll: command.roll, yaw: command.yaw });
    this.applyThrottle(command.throttle);

    if (command.selectTarget && command.selectTarget !== this.selectedId) {
      this.selectTarget(command.selectTarget);
    }
    if (command.selectWeapon && command.selectWeapon !== this.weapons.selected) {
      this.selectWeapon(command.selectWeapon);
    }
    if (command.startManeuver) this.startManeuver(command.startManeuver);
    if (command.endManeuver) this.endManeuver(command.endManeuver);
    if (command.flare) this.flare();
    if (command.fireMissile) this.fireMissile();

    if (command.gun !== this.autoGun) {
      this.autoGun = command.gun;
      if (command.gun) this.startGun();
      else this.stopGun();
    }
  }

  /** Internal input path used by the performer — bypasses the manual lockout. */
  private applyInput(partial: Partial<ControlInput>): void {
    this.inputTarget = {
      pitch: clamp(partial.pitch ?? this.inputTarget.pitch, -1, 1),
      roll: clamp(partial.roll ?? this.inputTarget.roll, -1, 1),
      yaw: clamp(partial.yaw ?? this.inputTarget.yaw, -1, 1),
    };
    if (Math.abs(this.inputTarget.pitch) >= 0.3) this.attitudeSeen.pitch = true;
    if (Math.abs(this.inputTarget.roll) >= 0.3) this.attitudeSeen.roll = true;
    if (this.attitudeSeen.pitch && this.attitudeSeen.roll) this.completeTutorial('attitude');
  }

  private applyThrottle(value: number): void {
    const next = clamp(value, 0, 1);
    this.pilotThrottle = next;
    this.flight.throttle = next;
    this.throttleAxis = 0;
    this.throttleIdle = 0;
    this.completeTutorial('throttle');
  }

  /** Instantly retargets every hostile missile onto the flares. */
  private breakMissileLock(chance: number): void {
    if (chance <= 0) return;
    let broken = 0;
    for (const entity of this.entities) {
      if (entity.kind !== 'missile' || !entity.alive || !entity.missile) continue;
      if (entity.missile.targetId !== 'player') continue;
      if (Math.random() >= chance) continue;
      entity.missile.life = Math.min(entity.missile.life, 0.22);
      broken += 1;
    }
    if (broken > 0) {
      this.warn('missile', 'caution', 'MISSILE DEFEATED', '机动摆脱 — 导弹失去跟踪', 1.6);
      this.emit({ type: 'flare' });
    }
  }

  private blockManeuver(id: ManeuverId, reason: string | null): void {
    const label = MANEUVERS[id]?.labelZh ?? '机动';
    this.warn('system', 'caution', 'MANOEUVRE BLOCKED', `${label} — ${reason ?? '条件不足'}`, 1.4);
    this.emit({ type: 'maneuver-blocked', id, reason: reason ?? '' });
  }

  private activeManeuver(): ManeuverId | null {
    return this.scripted?.id ?? this.sustained;
  }

  private completeTutorial(id: TutorialStepId): void {
    if (this.tutorialFlags[id]) return;
    this.tutorialFlags[id] = true;
    const state = buildTutorialState(this.tutorialFlags, this.tutorialDismissed, true);
    if (state.completed >= state.total) {
      this.tutorialDoneAt = this.elapsed;
      this.emit({ type: 'tutorial-complete' });
    }
  }

  private finishScripted(): void {
    const active = this.scripted;
    if (!active) return;
    this.scripted = null;
    this.scriptedG = 1;
    this.velocityDir = null;
    this.flight.pitch = wrapRadians(this.flight.pitch);
    this.normalizeAttitude();
    this.flight.pitchRate = 0;
    this.flight.rollRate = 0;
    this.emit({ type: 'maneuver-end', id: active.id });
  }

  /** (yaw, pitch, roll) and (yaw+π, π-pitch, roll+π) describe one attitude. */
  private normalizeAttitude(): void {
    const pitch = this.flight.pitch;
    if (Math.abs(pitch) <= PITCH_LIMIT) return;
    this.flight.yaw = wrapRadians(this.flight.yaw + Math.PI);
    this.flight.pitch = wrapRadians(Math.PI - pitch);
    this.flight.roll = wrapRadians(this.flight.roll + Math.PI);
    if (!Number.isFinite(this.flight.pitch) || Math.abs(this.flight.pitch) > PITCH_LIMIT) {
      this.flight.pitch = 0;
    }
  }

  cycleTarget(): void {
    const candidates = this.getCandidates();
    if (candidates.length === 0) {
      this.selectedId = null;
      this.warn('system', 'caution', 'NO CONTACT', '雷达范围内没有可锁定目标', 1.8);
      return;
    }
    const index = candidates.findIndex((candidate) => candidate.id === this.selectedId);
    const next = candidates[(index + 1) % candidates.length];
    this.completeTutorial('target');
    this.selectTarget(next.id);
  }

  selectTarget(id: string | null, manual = true): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.lockProgress = 0;
    this.lockWasLocked = false;
    this.lockInCone = false;
    this.lockDistance = 0;
    if (id && manual) this.completeTutorial('target');
  }

  cycleWeapon(): void {
    this.weapons.selected = this.weapons.selected === 'aam' ? 'gun' : 'aam';
  }

  selectWeapon(weapon: WeaponId): void {
    this.weapons.selected = weapon;
  }

  fire(): void {
    if (!this.canUseWeapons()) return;
    if (this.weapons.selected === 'gun') {
      this.gunBurst = Math.max(this.gunBurst, 0.32);
    } else {
      this.fireMissile();
    }
  }

  startGun(): void {
    if (!this.canUseWeapons()) return;
    this.weapons.selected = 'gun';
    this.gunHeld = true;
  }

  stopGun(): void {
    this.gunHeld = false;
  }

  fireMissile(): void {
    if (!this.canUseWeapons()) return;
    const target = this.getEntity(this.selectedId);
    if (!target || !this.isLockable(target)) {
      this.warn('system', 'caution', 'NO LOCK', '未选择有效目标 — 按 TAB 切换', 1.6);
      return;
    }
    if (this.weapons.missiles <= 0) {
      this.warn('system', 'warning', 'AAM EMPTY', '导弹挂架已空', 1.8);
      return;
    }
    if (this.fireCooldown > 0) return;
    if (this.lockProgress < 0.999) {
      this.warn('system', 'caution', 'LOCK IN PROGRESS', '保持目标在锁定锥内', 1.2);
      return;
    }
    const origin = add(
      add(this.flight.position, scale(forwardFromAngles(this.flight.yaw, this.flight.pitch), 14)),
      { x: 0, y: -4, z: 0 },
    );
    const direction = normalize(sub(target.position, origin));
    const angles = yawPitchFromDirection(direction);
    const missile = this.makeEntity({
      kind: 'missile',
      team: 'player',
      callsign: 'AAM',
      position: origin,
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed: 920,
      hp: 1,
      maxHp: 1,
      radius: 3,
      label: target.callsign,
    });
    missile.missile = {
      targetId: target.id,
      speed: 920,
      life: 8,
      maxLife: 8,
      owner: 'player',
      whooshed: false,
    };
    missile.maxLife = 8;
    missile.life = 8;
    this.entities.push(missile);
    this.weapons.missiles -= 1;
    this.stats.missilesFired += 1;
    this.fireCooldown = 0.45;
    this.spawnEffect('muzzle', origin, { scale: 8, color: 'cyan', life: 0.14 });
    this.emit({ type: 'missile-fire', team: 'player', id: missile.id });
    this.completeTutorial('fire');
  }

  /**
   * v0.5 flare. Three changes make the countermeasure behave like one:
   *
   * 1. Four cartridges instead of three, thrown wide, each with its own drift
   *    and gravity, so the cloud spreads behind the aircraft instead of hanging
   *    in the sky as a single sprite.
   * 2. A continuous seduction check in `updateMissiles`: any hostile round that
   *    passes within `FLARE_SEDUCE_RANGE` of a burning cartridge re-targets onto
   *    it. v0.4 only rolled the dice at launch, which meant a flare fired a
   *    second late did nothing at all.
   * 3. The launch itself is loud — a bright bloom, an ejection puff and a
   *    burning trail — because the effect has to be legible from the outside
   *    camera as well as from the cockpit.
   */
  flare(): void {
    if (!this.canUseWeapons() || this.flareCooldown > 0) return;
    if (this.weapons.flares <= 0) {
      this.warn('system', 'warning', 'FLARE EMPTY', '热焰弹耗尽', 1.6);
      return;
    }
    this.weapons.flares -= 1;
    this.flareCooldown = 2.6;
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const base = add(
      add(this.flight.position, scale(forward, -16)),
      { x: 0, y: -6, z: 0 },
    );
    // The cartridges keep a *large* share of the aircraft's velocity, and that
    // is a gameplay decision rather than a physical one. A flare that
    // immediately falls two hundred metres astern only decoys a missile chasing
    // from behind; one fired head-on passes the aircraft where the flare is not.
    // Holding the cloud near the airframe is what lets a single press of `F`
    // answer both geometries — and the AUTO ACE soak runs say the same thing:
    // at a third of this value the performer was shot down seven times in a
    // sortie it now clears in three minutes.
    const inherited = scale(this.travelDir, this.flight.speed * 0.32);
    const flares: SimEntity[] = [];
    for (let index = 0; index < FLARE_SALVO; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const spread = 16 + index * 6;
      const offset = {
        x: side * spread + randomRange(-6, 6),
        y: randomRange(-9, 3),
        z: randomRange(-12, 8),
      };
      const flare = this.makeEntity({
        kind: 'flare',
        team: 'player',
        callsign: 'FLARE',
        position: add(base, offset),
        speed: 0,
        hp: 1,
        maxHp: 1,
        radius: 2,
        label: 'FLARE',
        yaw: this.flight.yaw,
        roll: randomRange(-3, 3),
      });
      flare.drift = {
        x: inherited.x + side * randomRange(6, 16),
        y: inherited.y - randomRange(4, 12),
        z: inherited.z + randomRange(-6, 6),
      };
      flare.life = FLARE_LIFE;
      flare.maxLife = FLARE_LIFE;
      flares.push(flare);
      this.entities.push(flare);
      // The launch plume is modest on purpose: four cartridges going off 20 m
      // from the camera would otherwise white out the whole outside view.
      this.spawnEffect('flash', flare.position, { scale: 9, color: 'amber', life: 0.2 });
      this.spawnEffect('muzzle', flare.position, {
        scale: 4,
        color: 'amber',
        life: 0.16,
        velocity: scale(right, side * 12),
      });
      this.spawnEffect('smoke', flare.position, {
        scale: 5,
        color: 'white',
        life: 1.5,
        velocity: { x: side * 8, y: 10, z: 0 },
      });
    }
    // The immediate break: a round already in the air loses the aircraft.
    for (const entity of this.entities) {
      if (entity.kind !== 'missile' || !entity.alive || entity.team !== 'hostile') continue;
      if (entity.missile?.targetId !== 'player') continue;
      if (Math.random() < 0.62) {
        entity.missile.targetId = flares[Math.floor(Math.random() * flares.length)]?.id ?? 'player';
      }
    }
    this.emit({ type: 'flare' });
    this.completeTutorial('defend');
  }

  warpToBoss(): void {
    if (this.phase === 'idle') this.launch();
    this.cancelManeuvers();
    this.phase = 'boss';
    this.bootTimer = 0;
    this.bossIntroTimer = 0;
    this.bossDefeated = false;
    this.completionTimer = 0;
    this.elapsed = Math.max(this.elapsed, 62);
    this.kills = Math.max(this.kills, this.scenario.requiredKills);
    // Jumping straight to the dreadnought means the waves before it already
    // happened; without this the whole campaign arrives on top of the boss.
    this.waveIndex = this.getReinforcements().length;
    this.waveInboundTimer = 0;
    this.score = Math.max(this.score, 420);
    this.flight.hp = this.flight.maxHp;
    this.weapons.missiles = this.weapons.maxMissiles;
    this.weapons.flares = this.weapons.maxFlares;
    this.weapons.gunAmmo = this.weapons.gunMax;
    if (!this.getEntity(this.wingmanId)) this.spawnWingman();
    this.spawnBoss();
    const boss = this.getEntity(this.bossId);
    const firstShield = this.entities.find(
      (entity) => entity.kind === 'weakpoint' && entity.alive && entity.weakpoint?.key === 'shieldL',
    );
    if (firstShield) this.selectTarget(firstShield.id);
    if (boss) {
      this.say(
        this.scenario.awacsCallsign,
        'awacs',
        'LEVIATHAN 进入射程。护盾节点是突破口，LUMEN 1，看你的了。',
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* v0.5 camera                                                         */
  /* ------------------------------------------------------------------ */

  getView(): ViewMode {
    return this.view;
  }

  setView(mode: ViewMode): ViewMode {
    if (!isViewMode(mode) || mode === this.view) return this.view;
    this.view = mode;
    this.addComms(
      'TACS-8',
      'system',
      mode === 'chase'
        ? `外部视角接通 — ${VIEW_LABEL.chase.zh}，可以看到本机姿态与机动。`
        : `回到 ${VIEW_LABEL.cockpit.zh} — 全息 HUD 与座舱框恢复。`,
    );
    this.emit({ type: 'view-change', mode });
    return this.view;
  }

  toggleView(): ViewMode {
    return this.setView(this.view === 'cockpit' ? 'chase' : 'cockpit');
  }

  /** Consumed by the renderer once per frame; returns and clears the request. */
  drainShake(): number {
    const value = this.pendingShake;
    this.pendingShake = 0;
    return value;
  }

  /**
   * Everything the three.js layer needs that is not already in the entity list:
   * the current camera, the control surfaces' deflection and the manoeuvre the
   * airframe is flying. Cheap enough to call every frame.
   */
  getViewTelemetry(): {
    mode: ViewMode;
    maneuver: ManeuverId | null;
    maneuverProgress: number;
    control: ControlInput;
    gLoad: number;
    speed: number;
    afterburner: boolean;
    postStall: boolean;
    airbrake: boolean;
    highG: boolean;
    stall: boolean;
  } {
    const maneuver = this.activeManeuver();
    return {
      mode: this.view,
      maneuver,
      maneuverProgress: this.scripted
        ? clamp(this.scripted.time / MANEUVERS[this.scripted.id].duration, 0, 1)
        : 0,
      control: { ...this.input },
      gLoad: this.flight.gLoad,
      speed: this.flight.speed,
      afterburner: this.flight.afterburner,
      postStall: this.flight.postStall,
      airbrake: this.flight.airbrake,
      highG: this.flight.highG,
      stall: this.flight.speed <= (scriptedFloor(this.scripted) ?? SPEED_FLOOR) + 3,
    };
  }

  setProjection(id: string, projection: Projection): void {
    this.projections.set(id, projection);
  }

  clearProjections(): void {
    this.projections.clear();
  }

  /* ------------------------------------------------------------------ */
  /* simulation                                                          */
  /* ------------------------------------------------------------------ */

  update(dt: number): void {
    if (this.paused || this.phase === 'idle') return;
    const step = clamp(dt, 0, 0.05);
    if (step <= 0) return;

    this.elapsed += step;
    this.updateEffectsLifetime(step);
    this.updateCombatFeedback(step);
    this.updateAmbience(step);
    this.flareCooldown = Math.max(0, this.flareCooldown - step);
    this.fireCooldown = Math.max(0, this.fireCooldown - step);
    this.throttleIdle += step;

    if (this.phase === 'boot') {
      this.updateManeuver(step);
      this.updateThrottle(step);
      this.updateAutoPilot(step);
      this.updateFlight(step);
      this.bootTimer -= step;
      if (this.bootTimer <= 0) this.beginCombat();
      return;
    }

    if (this.phase === 'complete' || this.phase === 'failed') {
      // The performer still gets a turn: it either banks the win or queues the
      // retry that keeps "clear the game automatically" honest.
      this.updateAutoPilot(step);
      return;
    }

    this.updateManeuver(step);
    this.updateThrottle(step);
    this.updateAutoPilot(step);
    this.updateFlight(step);
    this.updateGun(step);
    this.updateWaves(step);
    this.updateJamming();
    this.updateLock(step);
    this.updateAI(step);
    this.updateWingman(step);
    this.updateMissiles(step);
    this.updateBoss(step);
    this.updateMissileWarning();
    this.updateAssistWarnings();
    this.updateTutorial(step);
    this.updateMissionState(step);

    if (this.phase === 'boss-intro') {
      this.bossIntroTimer -= step;
      if (this.bossIntroTimer <= 0) {
        this.phase = 'boss';
        this.flakTimer = 3.5;
        this.droneTimer = 12;
      }
    }
  }

  private beginCombat(): void {
    this.phase = 'dogfight';
    this.bootTimer = 0;
    this.warnings = [];
    this.cancelManeuvers();
    this.spawnWingman();
    this.spawnInitialEnemies();
    this.say(this.scenario.awacsCallsign, 'awacs', 'LUMEN 1，VESPER 编队出现在十二点方向。交战规则：自由开火。');
    this.say(this.scenario.wingmanCallsign, 'wingman', '两架主力，一架王牌。队长，别让王牌咬住你。');
    this.emit({ type: 'launch' });
    this.autoSelect();
  }

  private updateFlight(dt: number): void {
    const flight = this.flight;

    /* 1 ── pilot input shaping: quick to build, softer to relax -------- */
    for (const axis of ['pitch', 'roll', 'yaw'] as const) {
      const target = this.inputTarget[axis];
      const current = this.input[axis];
      const lambda = Math.abs(target) > Math.abs(current) ? INPUT_ATTACK : INPUT_RELEASE;
      this.input[axis] = current + (target - current) * (1 - Math.exp(-lambda * dt));
    }

    /* 2 ── flight aids layer on top of the pilot, never instead of them */
    const definition = this.scripted
      ? MANEUVERS[this.scripted.id]
      : this.sustained
        ? MANEUVERS[this.sustained]
        : null;
    const scriptedDefinition: ManeuverDefinition | null =
      definition && definition.kind === 'scripted' ? definition : null;
    const sustainedDefinition: ManeuverDefinition | null =
      definition && definition.kind === 'sustained' ? definition : null;

    const solution = solveAssists({
      settings: this.assistSettings,
      master: this.assistMaster,
      dt,
      input: this.input,
      roll: flight.roll,
      rollRate: flight.rollRate,
      pitch: flight.pitch,
      yaw: flight.yaw,
      speed: flight.speed,
      altitude: flight.position.y,
      throttle: flight.throttle,
      pilotThrottle: this.pilotThrottle,
      throttleIdle: this.throttleIdle,
      target: this.buildAssistTarget(),
      maneuverActive: definition !== null,
      active: this.phase === 'dogfight' || this.phase === 'boss-intro' || this.phase === 'boss',
    });
    this.assistSolution = solution;
    if (solution.throttle !== null) flight.throttle = solution.throttle;

    /* 3 ── control authority: dynamic pressure, config and manoeuvre ---- */
    const stallFactor = flight.postStall ? 0.6 : 1;
    const q = clamp(flight.speed / 245, 0.42, 1.28) * stallFactor;
    const pitchAuthority = sustainedDefinition?.pitchAuthority ?? 1;
    const rollAuthority = sustainedDefinition?.rollAuthority ?? 1;
    const turnBonus = sustainedDefinition?.turnBonus ?? 1;
    const gLimit = sustainedDefinition?.gLimit ?? scriptedDefinition?.gLimit ?? 9.2;

    flight.airbrake = sustainedDefinition?.id === 'airbrake';
    flight.highG = sustainedDefinition?.id === 'highG';

    const effPitch = clamp(this.input.pitch + solution.pitch, -1, 1);
    const effRoll = clamp(this.input.roll + solution.roll, -1, 1);
    const effYaw = clamp(this.input.yaw + solution.yaw, -1, 1);

    let speedBias = 0;
    let velocityLock = 0;

    if (scriptedDefinition && this.scripted) {
      /* Scripted profiles own the airframe: the pilot gets it back after. */
      const profile = scriptedDefinition.profile!;
      const t = clamp(this.scripted.time / scriptedDefinition.duration, 0, 1);
      const [pitchMin, pitchMax] = scriptedDefinition.pitchRange(this.scripted.entryPitch);
      const targetPitch = profile.pitchTarget(t, this.scripted.entryPitch);
      flight.pitchRate = clamp((targetPitch - flight.pitch) * 7.5, -4.8, 4.8);
      flight.pitch = clamp(flight.pitch + flight.pitchRate * dt, pitchMin, pitchMax);
      flight.rollRate = profile.rollRate(t);
      flight.roll = wrapRadians(flight.roll + flight.rollRate * dt);
      flight.yaw = wrapRadians(flight.yaw + profile.yawRate(t) * dt);
      speedBias = profile.speedBias(t);
      velocityLock = profile.velocityLock(t);
      this.scriptedG = profile.gTarget(t);
    } else {
      /* Roll: angular acceleration plus damping gives the wing some weight. */
      const rollAccel = effRoll * ROLL_ACCEL * rollAuthority * q;
      flight.rollRate = clamp(
        flight.rollRate * Math.exp(-ROLL_DAMP * dt) + rollAccel * dt,
        -ROLL_RATE_MAX * rollAuthority,
        ROLL_RATE_MAX * rollAuthority,
      );
      flight.roll = wrapRadians(flight.roll + flight.rollRate * dt);

      /* Pitch: rate commanded through a first-order lag. */
      flight.pitchRate = damp(
        flight.pitchRate,
        effPitch * PITCH_RATE_MAX * pitchAuthority * q,
        PITCH_LAG,
        dt,
      );
      flight.pitch = clamp(flight.pitch + flight.pitchRate * dt, -PITCH_LIMIT, PITCH_LIMIT);

      /* Yaw: rudder plus the banked-lift turn, automatically coordinated. */
      const bankTurn =
        Math.tan(clamp(flight.roll, -1.42, 1.42)) *
        (9.81 / Math.max(flight.speed, SPEED_FLOOR)) *
        2.5 *
        turnBonus;
      const coordination = flight.rollRate * 0.1;
      flight.yaw = wrapRadians(
        flight.yaw +
          (effYaw * 0.62 * q * turnBonus + bankTurn + coordination) * dt,
      );
    }

    flight.postStall = Math.abs(flight.pitch) > PITCH_LIMIT;

    /* 4 ── energy: throttle, gravity along the nose, induced drag ------- */
    const throttleSpeed =
      SPEED_IDLE + flight.throttle * SPEED_SPAN + (flight.throttle > 0.9 ? SPEED_AB_BONUS : 0);
    const gravity = -Math.sin(flight.pitch) * GRAVITY_BIAS;
    const inducedDrag =
      Math.abs(flight.pitchRate) * PITCH_DRAG +
      Math.abs(flight.rollRate) * ROLL_DRAG +
      (sustainedDefinition?.speedBleed ?? 0);
    const floor = scriptedDefinition?.profile?.speedFloor ?? SPEED_FLOOR;
    const targetSpeed = clamp(throttleSpeed + gravity - inducedDrag + speedBias, floor, SPEED_MAX);
    flight.speed = approach(flight.speed, targetSpeed, 58 * dt);

    /* 5 ── translate: the velocity vector can lag the nose -------------- */
    const forward = forwardFromAngles(flight.yaw, flight.pitch);
    let travel = forward;
    if (velocityLock > 0.001 && this.velocityDir) {
      travel = normalize({
        x: lerp(forward.x, this.velocityDir.x, velocityLock),
        y: lerp(forward.y, this.velocityDir.y, velocityLock),
        z: lerp(forward.z, this.velocityDir.z, velocityLock),
      });
    }
    this.travelDir = travel;
    flight.position = add(flight.position, scale(travel, flight.speed * dt));
    flight.position.y = clamp(flight.position.y, GROUND_FLOOR, CEILING);
    if (!this.scripted && flight.position.y <= GROUND_FLOOR + 1 && travel.y < 0) {
      // The low-altitude guard's last resort: level the nose instead of the
      // airframe, so the player keeps full control of everything else.
      flight.pitch = Math.max(flight.pitch, 0);
    }

    /* 6 ── G load and the afterburner transition ------------------------ */
    const speedFactor = clamp(flight.speed / 245, 0.5, 1.15);
    const rateRatio = Math.abs(flight.pitchRate) / PITCH_RATE_MAX;
    const targetG =
      1 +
      rateRatio * 7.4 * speedFactor +
      Math.abs(flight.rollRate) * 0.34 +
      (scriptedDefinition ? this.scriptedG - 1 : 0) +
      (sustainedDefinition?.id === 'highG' ? 1.4 : 0);
    flight.gLoad = damp(flight.gLoad, clamp(targetG, 1, gLimit), 4.5, dt);

    const afterburner = flight.throttle > 0.88;
    if (afterburner !== flight.afterburner) {
      flight.afterburner = afterburner;
      if (afterburner) this.emit({ type: 'afterburner' });
    }

    const stalling = flight.speed <= floor + 3 && Math.abs(flight.pitch) > 0.35;
    if (stalling && !this.stallAnnounced) {
      this.stallAnnounced = true;
      this.emit({ type: 'stall' });
    } else if (!stalling) {
      this.stallAnnounced = false;
    }
  }

  private updateManeuver(dt: number): void {
    const active = this.scripted;
    if (!active) return;
    const definition = MANEUVERS[active.id];
    active.time += dt;
    if (active.time >= definition.duration) this.finishScripted();
  }

  private updateThrottle(dt: number): void {
    if (this.throttleAxis === 0) return;
    const next = clamp(this.flight.throttle + this.throttleAxis * 0.42 * dt, 0, 1);
    this.flight.throttle = next;
    this.pilotThrottle = next;
    this.throttleIdle = 0;
  }

  private buildAssistTarget() {
    const target = this.getEntity(this.selectedId);
    if (!target || !target.alive || !this.isLockable(target)) return null;
    const toTarget = sub(target.position, this.flight.position);
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const angles = yawPitchFromDirection(toTarget);
    return {
      yaw: angles.yaw,
      pitch: angles.pitch,
      distance: Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2),
      angle: angleBetween(forward, normalize(toTarget)) * RAD,
      lockable: true,
    };
  }

  private updateAssistWarnings(): void {
    const solution = this.assistSolution;
    if (!solution) return;
    if (solution.terrainAlert && this.assistSettings.terrain && this.assistMaster) {
      this.warn(
        'terrain',
        solution.terrainAlert,
        solution.terrainAlert === 'critical' ? 'PULL UP' : 'LOW ALTITUDE',
        solution.terrainAlert === 'critical' ? '低空保护接通 — 正在拉起' : '注意高度 — 地形接近',
        solution.terrainAlert === 'critical' ? 0.9 : 1.8,
      );
    }
    for (const id of solution.engaged) {
      if (this.assistAnnounced.has(id)) continue;
      this.assistAnnounced.add(id);
      this.emit({ type: 'assist-engaged', id });
    }
    for (const id of Array.from(this.assistAnnounced)) {
      if (!solution.engaged.includes(id)) this.assistAnnounced.delete(id);
    }
  }

  private updateTutorial(dt: number): void {
    if (this.tutorialDismissed) return;
    if (this.phase !== 'dogfight' && this.phase !== 'boss-intro' && this.phase !== 'boss') return;
    this.tutorialTimer += dt;
    const state = buildTutorialState(this.tutorialFlags, false, true);
    if (state.completed >= state.total) {
      if (this.tutorialDoneAt === null) this.tutorialDoneAt = this.elapsed;
      if (this.elapsed - this.tutorialDoneAt >= TUTORIAL_LINGER) this.dismissTutorial();
      return;
    }
    if (this.tutorialTimer >= TUTORIAL_AUTO_HIDE) this.dismissTutorial();
  }

  private updateLock(dt: number): void {
    const target = this.getEntity(this.selectedId);
    if (!target || !target.alive || !this.isLockable(target)) {
      if (this.selectedId !== null && this.phase !== 'boss-intro') {
        this.selectedId = null;
        this.lockProgress = 0;
        this.lockWasLocked = false;
        if (this.phase === 'dogfight' || this.phase === 'boss') this.autoSelect();
      }
      return;
    }

    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const toTarget = sub(target.position, this.flight.position);
    const dist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
    const angle = angleBetween(forward, normalize(toTarget)) * RAD;
    this.lockDistance = dist;
    this.lockInCone = angle <= LOCK_CONE_DEG && dist <= LOCK_RANGE;
    const desired = yawPitchFromDirection(toTarget);
    this.lockSteering = wrapRadians(desired.yaw - this.flight.yaw) * RAD;
    this.lockElevation = (desired.pitch - this.flight.pitch) * RAD;
    if (this.lockProgress < 1) {
      // v0.4: a live jammer stretches the lock instead of blocking it, so the
      // counter-play is "kill the jammer", not "wait it out".
      const jamFactor = this.jammerEngaged ? 0.45 : 1;
      const rate = this.lockInCone ? (dt / LOCK_TIME) * jamFactor : -(dt / LOCK_TIME) * 2.4;
      this.lockProgress = clamp(this.lockProgress + rate, 0, 1);
    } else if (angle <= 38 && dist <= 4800) {
      // Once acquired, keep the lock while the target stays roughly in front.
      this.lockProgress = 1;
    } else {
      this.lockProgress = 0;
    }

    const locked = this.lockProgress >= 0.999;
    if (locked && !this.lockWasLocked) {
      this.emit({ type: 'lock-acquired', targetId: target.id });
      this.completeTutorial('lock');
      this.addComms(
        this.scenario.wingmanCallsign,
        'wingman',
        target.kind === 'weakpoint'
          ? '护盾节点的锁定信号很稳定，打它！'
          : '咬住了！队长，Fox Two！',
      );
    }
    if (!locked && this.lockWasLocked) this.emit({ type: 'lock-lost' });
    this.lockWasLocked = locked;
  }

  private updateGun(dt: number): void {
    const active = this.phase === 'dogfight' || this.phase === 'boss';
    this.gunBurst = Math.max(0, this.gunBurst - dt);
    if (!active || this.weapons.gunAmmo <= 0 || (!this.gunHeld && this.gunBurst <= 0)) {
      this.gunFiring = false;
      return;
    }
    this.gunFiring = true;
    this.gunAccumulator += dt;
    const interval = 0.085;
    let fired = 0;
    while (this.gunAccumulator >= interval && fired < 4 && this.weapons.gunAmmo > 0) {
      this.gunAccumulator -= interval;
      this.weapons.gunAmmo -= 1;
      fired += 1;
      this.fireGunRound();
    }
    if (fired > 0) this.emit({ type: 'gun-fire', team: 'player' });
    if (this.weapons.gunAmmo <= 0) {
      this.gunFiring = false;
      this.warn('system', 'caution', 'GUN DRY', '机炮弹药耗尽', 1.4);
    }
  }

  private fireGunRound(): void {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const origin = add(
      add(this.flight.position, scale(forward, 22)),
      { x: 0, y: -3, z: 0 },
    );
    const target = this.findGunTarget();
    let end = target ? target.point : add(origin, scale(forward, 1600));
    // A burst that misses every weak point but lands on the hull is not a miss
    // — it is the armour telling the player to aim somewhere else.
    let armour: { part: string; point: Vec3 } | null = null;
    if (!target) {
      const stop = this.bossArmourStop(origin, end);
      if (stop) {
        end = stop.point;
        armour = { part: stop.part, point: stop.point };
      }
    }
    this.spawnEffect('tracer', origin, { to: end, scale: 1, color: 'amber', life: 0.12 });
    // Muzzle flash at the gun port — a one-frame bloom that makes the burst read.
    this.spawnEffect('muzzle', origin, {
      scale: 6.5,
      color: 'amber',
      life: 0.07,
      velocity: scale(forward, 40),
    });
    if (armour) {
      this.spawnEffect('spark', armour.point, {
        scale: 2.4,
        color: 'cyan',
        life: 0.18,
        velocity: scale(forward, -30),
      });
      if (Math.random() < 0.25) this.reportArmourHit(armour.point, armour.part);
    }
    if (target) {
      this.applyDamage(target.entity, 5 + Math.random() * 3, 'player', false, 'gun');
    }
  }

  /**
   * v0.5 gunnery. The cone is the *aiming* gate; the target's own radius is
   * added to it, so a 60 m reactor at 2 km is a real target rather than a
   * fraction of a degree. Without this the dreadnought's weak points were
   * effectively unhittable with the gun while the HUD drew a lock box on them.
   */
  private findGunTarget(): GunTarget | null {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    let best: GunTarget | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const entity of this.entities) {
      if (!entity.alive || !this.isLockable(entity)) continue;
      const toTarget = sub(entity.position, this.flight.position);
      const range = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
      if (range > GUN_RANGE) continue;
      const angle = angleBetween(forward, normalize(toTarget)) * RAD;
      const allowance = Math.atan2(entity.radius * GUN_RADIUS_PAD, Math.max(1, range)) * RAD;
      if (angle > GUN_CONE_DEG + allowance) continue;
      const score = angle * 10 + range / 250;
      if (score < bestScore) {
        bestScore = score;
        best = { entity, point: entity.position };
      }
    }
    return best;
  }

  /**
   * v0.4 bandit AI. v0.3 gave every hostile the same two behaviours — fly at
   * the player and lob a missile when roughly nose-on. v0.4 reads the airframe
   * profile instead, so a scout slashes past, a heavy sits still and hoses the
   * player with its gun, a jammer keeps its distance behind the fight and a
   * commander actually tries to stay out of the player's forward hemisphere.
   */
  private updateAI(dt: number): void {
    const player = this.flight.position;
    const combat = this.phase === 'dogfight' || this.phase === 'boss';

    for (const entity of this.entities) {
      if (!entity.alive || entity.kind !== 'fighter' || !entity.ai) continue;
      const ai = entity.ai;
      const profile = enemyProfile(entity.enemyId);
      ai.cooldown -= dt;
      ai.evadeTimer = Math.max(0, ai.evadeTimer - dt);
      ai.gunCooldown = Math.max(0, ai.gunCooldown - dt);
      ai.gunBurst = Math.max(0, ai.gunBurst - dt);

      const toPlayer = sub(player, entity.position);
      const dist = Math.sqrt(toPlayer.x ** 2 + toPlayer.y ** 2 + toPlayer.z ** 2);
      const forward = forwardFromAngles(entity.yaw, entity.pitch);
      const angle = angleBetween(forward, normalize(toPlayer)) * RAD;

      // Break off when the player is about to fly through them, scaled by how
      // willing this airframe is to trade a firing position for survival.
      const breakRange = profile?.id === 'heavy' ? 620 : profile?.jammer ? 1500 : 900;
      if (dist < breakRange) {
        ai.mode = 'evade';
        ai.evadeTimer = Math.max(ai.evadeTimer, profile?.jammer ? 2.6 : 1.7);
      }
      const nerve = profile?.evadeBias ?? 0.3;
      if (
        this.selectedId === entity.id &&
        ai.evadeTimer <= 0 &&
        Math.random() < 0.01 * nerve
      ) {
        ai.mode = 'evade';
        ai.evadeTimer = randomRange(0.9, 1.9);
      }
      if (ai.mode === 'evade' && ai.evadeTimer <= 0) ai.mode = 'engage';

      if (ai.mode === 'engage') {
        const desired = yawPitchFromDirection(toPlayer);
        const yawDelta = wrapRadians(desired.yaw - entity.yaw);
        const maxYaw = (profile?.turnRate ?? 0.9) * dt;
        entity.yaw = wrapRadians(entity.yaw + clamp(yawDelta, -maxYaw, maxYaw));
        entity.pitch = clamp(
          entity.pitch + clamp(desired.pitch - entity.pitch, -0.5 * dt, 0.5 * dt),
          -1.1,
          1.1,
        );
        entity.roll = damp(entity.roll, clamp(-yawDelta * 2.2, -1.05, 1.05), 3.2, dt);

        // --- missiles -------------------------------------------------
        const fit = profile?.missile;
        if (fit && combat && ai.cooldown <= 0 && dist < fit.max && dist > fit.min && angle < fit.cone) {
          this.fireEnemyMissile(entity, fit.speed);
          ai.cooldown = randomRange(...fit.cooldown);
        }

        // --- guns -----------------------------------------------------
        // Bursts are telegraphed by tracers before they hurt, and only ever
        // land while the player stays parked in front of the muzzle.
        const gun = profile?.gun;
        if (gun && combat) {
          const aligned = angle < gun.cone && dist < gun.range && dist > 180;
          if (ai.gunBurst > 0) {
            if (!aligned) {
              ai.gunBurst = 0;
            } else {
              this.fireEnemyGun(entity, gun.dps, dt);
            }
          } else if (ai.gunCooldown <= 0 && aligned) {
            ai.gunBurst = gun.burst;
            ai.burstHits = 0;
            ai.gunCooldown = randomRange(...gun.interval);
            this.emit({ type: 'enemy-gun', id: entity.id });
            this.fireEnemyGun(entity, gun.dps, dt);
          }
        }
      } else {
        entity.roll = damp(entity.roll, Math.sin(this.elapsed * 3 + ai.seed) * 0.7, 2.5, dt);
        entity.pitch = clamp(entity.pitch + Math.sin(this.elapsed + ai.seed) * 0.14 * dt, -0.9, 0.9);
      }

      // Standoff discipline: scouts and drones press, jammers and heavies hang
      // back, everyone else holds a working range.
      const standoff = profile?.standoff ?? 1800;
      const closing = dist > standoff * 1.25 ? 1.12 : dist < standoff * 0.6 ? 0.86 : 1;
      const heading = forwardFromAngles(entity.yaw, entity.pitch);
      entity.position = add(entity.position, scale(heading, entity.speed * closing * dt));
      entity.position.y = clamp(entity.position.y, 1800, 11800);
      if (dist > 5200) ai.mode = 'engage';
    }
  }

  /** One tick of a hostile gun burst: a tracer plus whatever it actually hits. */
  private fireEnemyGun(enemy: SimEntity, dps: number, dt: number): void {
    this.spawnEffect('tracer', enemy.position, {
      to: this.flight.position,
      scale: 1,
      color: 'red',
      life: 0.11,
    });
    if (Math.random() < 0.55) this.damagePlayer(dps * dt * 1.6, enemy.position);
  }

  private fireEnemyMissile(enemy: SimEntity, speed = 660): void {
    const direction = normalize(sub(this.flight.position, enemy.position));
    const angles = yawPitchFromDirection(direction);
    const missile = this.makeEntity({
      kind: 'missile',
      team: 'hostile',
      callsign: 'VESPER AAM',
      position: add(enemy.position, scale(direction, 16)),
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed,
      hp: 1,
      maxHp: 1,
      radius: 3,
      label: enemy.callsign,
    });
    missile.missile = {
      targetId: 'player',
      speed,
      life: 9,
      maxLife: 9,
      owner: 'hostile',
      whooshed: false,
    };
    missile.life = 9;
    missile.maxLife = 9;
    this.entities.push(missile);
    this.emit({ type: 'missile-fire', team: 'hostile', id: missile.id });
  }

  private updateWingman(dt: number): void {
    const wingman = this.getEntity(this.wingmanId);
    if (!wingman || !wingman.alive) return;
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const slot = add(
      add(this.flight.position, scale(forward, 300)),
      add(scale(right, 190), { x: 0, y: 30, z: 0 }),
    );
    const lerpFactor = 1 - Math.exp(-1.8 * dt);
    wingman.position.x += (slot.x - wingman.position.x) * lerpFactor;
    wingman.position.y += (slot.y - wingman.position.y) * lerpFactor;
    wingman.position.z += (slot.z - wingman.position.z) * lerpFactor;
    wingman.yaw = this.flight.yaw + Math.sin(this.elapsed * 0.7) * 0.015;
    wingman.pitch = this.flight.pitch;
    wingman.roll = this.flight.roll - 0.06;
    wingman.speed = this.flight.speed;
    wingman.hp = wingman.maxHp;

    wingman.ai = wingman.ai ?? createAIState({
      mode: 'formation',
      cooldown: 4,
      seed: 1,
      gunCooldown: 99,
    });
    wingman.ai.cooldown -= dt;
    if (
      wingman.ai.cooldown <= 0 &&
      (this.phase === 'dogfight' || this.phase === 'boss')
    ) {
      const target = this.entities.find(
        (entity) =>
          entity.alive &&
          entity.team === 'hostile' &&
          entity.kind === 'fighter' &&
          distance(entity.position, this.flight.position) < 2800,
      );
      if (target) {
        this.spawnEffect('tracer', wingman.position, {
          to: target.position,
          scale: 1,
          color: 'green',
          life: 0.14,
        });
        this.applyDamage(target, 6, 'wingman', true);
        wingman.ai.cooldown = randomRange(5.5, 8);
      } else {
        wingman.ai.cooldown = 2.5;
      }
    }
  }

  private updateMissiles(dt: number): void {
    for (const entity of this.entities) {
      if (entity.kind !== 'missile' || !entity.alive || !entity.missile) continue;
      entity.missile.life -= dt;
      entity.life = entity.missile.life;
      if (entity.missile.life <= 0) {
        entity.alive = false;
        this.spawnEffect('explosion', entity.position, { scale: 10, color: 'white', life: 0.5 });
        continue;
      }
      const target = this.resolveMissileTarget(entity.missile.targetId);
      if (!target) {
        entity.alive = false;
        this.spawnEffect('explosion', entity.position, { scale: 8, color: 'white', life: 0.4 });
        continue;
      }
      const targetPoint = target === 'player' ? this.flight.position : target.position;
      const desired = yawPitchFromDirection(sub(targetPoint, entity.position));
      const turn = 2.1 * dt;
      entity.yaw = wrapRadians(
        entity.yaw + clamp(wrapRadians(desired.yaw - entity.yaw), -turn, turn),
      );
      entity.pitch = clamp(
        entity.pitch + clamp(desired.pitch - entity.pitch, -turn, turn),
        -1.3,
        1.3,
      );
      const forward = forwardFromAngles(entity.yaw, entity.pitch);
      const from = entity.position;
      entity.position = add(entity.position, scale(forward, entity.missile.speed * dt));
      entity.roll = Math.sin(this.elapsed * 9) * 0.3;

      const closing = distance(entity.position, this.flight.position);
      if (!entity.missile.whooshed && closing < 420) {
        entity.missile.whooshed = true;
        this.emit({ type: 'flyby', team: entity.team, distance: closing });
      }

      // v0.5: the dreadnought is a body, not a point. A round that reaches the
      // armour detonates on it instead of tunnelling through to the weak point
      // behind — so the attack geometry is something the player has to solve.
      const armour = this.bossArmourStop(from, entity.position);
      if (armour) {
        entity.alive = false;
        if (entity.team === 'player') {
          this.stats.missilesHit += 1;
          this.reportArmourHit(armour.point, armour.part);
        } else {
          this.spawnEffect('explosion', armour.point, { scale: 14, color: 'amber', life: 0.7 });
          this.spawnEffect('flash', armour.point, { scale: 60, color: 'white', life: 0.18 });
          this.spawnSparks(armour.point, 'amber', 7, 1.1);
        }
        continue;
      }

      // v0.5: a burning cartridge is a better target than the airframe, so any
      // hostile round that passes close enough to one goes for it instead. This
      // is what makes a flare fired *at the right moment* work, rather than
      // only a flare fired at the instant of launch.
      if (entity.team === 'hostile' && entity.missile.targetId === 'player') {
        const decoy = this.nearestFlare(entity.position);
        if (decoy) {
          entity.missile.targetId = decoy.id;
          this.warn('missile', 'caution', 'DECOY', '热焰弹诱骗 — 导弹脱离', 1.4);
          this.spawnEffect('spark', decoy.position, { scale: 2.6, color: 'amber', life: 0.3 });
          continue;
        }
      }

      // Radius-aware proximity fuse. v0.4 used a flat 62 m against the target's
      // origin, which made a wide airframe as easy to hit as a narrow one.
      const fuse =
        target === 'player'
          ? MISSILE_FUSE_BASE + MISSILE_FUSE_PAD
          : MISSILE_FUSE_BASE + target.radius;
      if (distance(entity.position, targetPoint) < fuse) {
        entity.alive = false;
        this.detonateMissile(entity, target);
      }
    }
    this.entities = this.entities.filter(
      (entity) =>
        entity.alive ||
        entity.kind === 'fighter' ||
        entity.kind === 'weakpoint' ||
        entity.kind === 'dreadnought',
    );
  }

  private detonateMissile(missile: SimEntity, target: SimEntity | null | 'player'): void {
    const impact = missile.position;
    const mine = missile.team === 'player';
    this.spawnEffect('explosion', impact, {
      scale: mine ? 20 : 17,
      color: 'amber',
      life: 0.9,
    });
    this.spawnEffect('flash', impact, { scale: mine ? 90 : 72, color: 'white', life: 0.2 });
    this.spawnEffect('shockwave', impact, { scale: mine ? 44 : 36, color: 'amber', life: 0.55 });
    this.spawnSparks(impact, 'amber', mine ? 9 : 6, 1.2);
    this.emit({
      type: 'explosion',
      position: impact,
      scale: 16,
      distance: distance(impact, this.flight.position),
    });
    if (!mine) {
      if (missile.missile?.targetId === 'player') {
        this.damagePlayer(12, impact);
      }
      return;
    }
    this.stats.missilesHit += 1;
    if (target && target !== 'player') {
      this.applyDamage(target, target.kind === 'weakpoint' ? 120 : 200, 'player', false, 'missile');
    }
  }

  private resolveMissileTarget(id: string): SimEntity | 'player' | null {
    if (id === 'player') return 'player';
    const entity = this.getEntity(id);
    if (!entity || !entity.alive) return null;
    return entity;
  }

  /* ------------------------------------------------------------------ */
  /* v0.5 collision volume                                               */
  /* ------------------------------------------------------------------ */

  /** The hottest burning cartridge within seduction range of a point. */
  private nearestFlare(point: Vec3): SimEntity | null {
    let best: SimEntity | null = null;
    let bestRange = FLARE_SEDUCE_RANGE;
    for (const entity of this.entities) {
      if (!entity.alive || entity.kind !== 'flare') continue;
      const range = distance(entity.position, point);
      if (range < bestRange) {
        bestRange = range;
        best = entity;
      }
    }
    return best;
  }

  /** The dreadnought's compound body, for a swept weapon path. */
  private bossArmourStop(from: Vec3, to: Vec3) {
    const boss = this.getEntity(this.bossId);
    if (!boss || !boss.alive) return null;
    return bossSegmentHit(this.bossPose(boss), from, to);
  }

  /**
   * v0.5: turn the charged boss attacks into a single escape heading for the
   * performer. The lance asks for a hard break across its own axis; the shield
   * pulse asks for a run out of the umbrella along the current line of sight.
   */
  private bossHazard(): AutoPilotHazard | null {
    const boss = this.getEntity(this.bossId);
    if (!boss || !boss.alive || !this.bossAttackId) return null;
    const attack = BOSS_ATTACKS[this.bossAttackId];
    if (this.bossAttackPhase === 'idle' || this.bossAttackPhase === 'recover') return null;
    const flight = this.flight;
    const telegraphing = this.bossAttackPhase === 'telegraph';
    const progress = telegraphing
      ? clamp(1 - this.bossAttackTimer / Math.max(0.001, attack.telegraph), 0, 1)
      : 1;

    if (attack.id === 'pulse') {
      const range = distance(boss.position, flight.position);
      if (range > attack.range[1] * 1.05) return null;
      const away = normalize(sub(flight.position, boss.position));
      const wanted = yawPitchFromDirection(away);
      return {
        id: 'boss-pulse',
        label: '护盾脉冲',
        yawError: clamp(wrapRadians(wanted.yaw - flight.yaw), -1.4, 1.4),
        pitchError: clamp(wanted.pitch - flight.pitch, -0.35, 0.35),
        urgency: telegraphing ? progress : 1,
      };
    }

    if (attack.id === 'lance' && this.lanceAxis) {
      const axis = this.lanceAxis;
      const muzzle = this.bossLanceMuzzle(this.bossPose(boss));
      // Only break if the airframe is actually near the corridor. A performer
      // that abandons every attack run for the whole three-second charge spends
      // the boss fight doing nothing but dodging a gun it was never in front of
      // — the same "aerobatics at nothing" failure as the v0.4 orbit bug.
      const series = bossSegmentHit(this.bossPose(boss), muzzle, this.flight.position);
      const along =
        (this.flight.position.x - muzzle.x) * axis.x +
        (this.flight.position.y - muzzle.y) * axis.y +
        (this.flight.position.z - muzzle.z) * axis.z;
      if (along <= 0 || series) return null;
      const offset = lanceOffset(muzzle, axis, this.flight.position);
      if (offset > lanceRadius(along) * 3.4) return null;

      const toPlayer = sub(this.flight.position, boss.position);
      const perp = sub(toPlayer, scale(axis, along));
      const right = rightFromYaw(this.flight.yaw);
      const lateral = perp.x * right.x + perp.y * right.y + perp.z * right.z;
      // Break to whichever side buys the most clearance soonest. Dead on the
      // axis there is no such side, so the tie-break is a hard left.
      const side = Math.abs(lateral) < 1 ? -1 : lateral >= 0 ? 1 : -1;
      return {
        id: 'boss-lance',
        label: '主炮照射',
        yawError: side * 1.35,
        pitchError: side * 0.18,
        // The beam only really hurts once it is live, but the performer needs
        // the whole telegraph to fly out of a 4° corridor.
        urgency: telegraphing ? clamp(progress * 1.6, 0, 1) : 1,
      };
    }

    return null;
  }

  /** A round that hit the armour rather than a weak point. */
  private reportArmourHit(point: Vec3, part: string): void {
    this.spawnEffect('shield', point, { scale: 22, color: 'cyan', life: 0.36 });
    this.spawnEffect('flash', point, { scale: 48, color: 'white', life: 0.16 });
    this.spawnSparks(point, 'cyan', 6, 1.1);
    this.emit({ type: 'shield-deflect', key: 'shieldL' });
    this.warn('boss', 'caution', `ARMOUR · ${part}`, '装甲未穿透 — 攻击护盾节点或反应堆', 1.5);
  }

  /** Boss collider pose — kept in one place so the sim and the model agree. */
  private bossPose(boss: SimEntity): BossPose {
    return { position: boss.position, yaw: boss.yaw, pitch: 0, roll: boss.roll };
  }

  private updateBoss(dt: number): void {
    const boss = this.getEntity(this.bossId);
    if (!boss || !boss.alive) return;
    const player = this.flight.position;
    const pose = this.bossPose(boss);

    const toPlayer = sub(player, boss.position);
    const desired = yawPitchFromDirection(toPlayer);
    boss.yaw = wrapRadians(
      boss.yaw + clamp(wrapRadians(desired.yaw - boss.yaw), -0.06 * dt, 0.06 * dt),
    );
    boss.roll = Math.sin(this.elapsed * 0.31) * 0.02;
    const forward = forwardFromAngles(boss.yaw, 0);
    // v0.5: the dreadnought closes on the player when it is far away and holds
    // station when it is close, so the fight cannot be run away from forever.
    const range = distance(boss.position, player);
    const closing = range > 5200 ? 9 : range > 3200 ? 5.5 : 3;
    boss.position = add(boss.position, scale(forward, closing * dt));

    const right = rightFromYaw(boss.yaw);
    for (const entity of this.entities) {
      if (entity.kind !== 'weakpoint' || !entity.alive || !entity.weakpoint) continue;
      if (entity.weakpoint.parentId !== boss.id) continue;
      const anchor =
        entity.weakpoint.key === 'shieldL'
          ? BOSS_ANCHOR.shieldL
          : entity.weakpoint.key === 'shieldR'
            ? BOSS_ANCHOR.shieldR
            : BOSS_ANCHOR.core;
      entity.position = add(
        add(boss.position, scale(right, anchor.x)),
        add(scale(forward, -anchor.z), { x: 0, y: anchor.y, z: 0 }),
      );
      entity.yaw = boss.yaw;
      entity.roll = boss.roll;
    }

    // The hull is solid now. Keep the player out of it and charge them for the
    // mistake — this is the single biggest readability fix of the encounter:
    // the dreadnought can no longer be flown through like a hologram.
    this.resolveHullContact(boss, pose, dt);

    if (this.phase !== 'boss' || this.bossDefeated) return;

    this.flakTimer -= dt;
    if (this.flakTimer <= 0) {
      this.flakTimer = randomRange(4.6, 6.8);
      this.flak = {
        at: this.elapsed + 2,
        offset: {
          x: randomRange(-160, 160),
          y: randomRange(-40, 90),
          z: randomRange(-160, 160),
        },
      };
      this.warn('boss', 'warning', 'FLAK BURST', '弹幕锁定 — 立即机动', 2.1);
    }
    if (this.flak && this.elapsed >= this.flak.at) {
      const impact = add(this.flight.position, this.flak.offset);
      this.flak = null;
      this.spawnEffect('explosion', impact, { scale: 28, color: 'amber', life: 1 });
      this.spawnEffect('flash', impact, { scale: 120, color: 'white', life: 0.24 });
      this.spawnSparks(impact, 'amber', 10, 1.5);
      // A near miss rattles the airframe even when it does not connect.
      const near = distance(impact, this.flight.position);
      if (near < 130) this.spawnEffect('shockwave', impact, { scale: 46, color: 'amber', life: 0.6 });
      this.emit({
        type: 'explosion',
        position: impact,
        scale: 20,
        distance: near,
      });
      if (Math.random() < 0.32) this.damagePlayer(8, impact);
    }

    this.droneTimer -= dt;
    if (this.droneTimer <= 0) {
      this.droneTimer = randomRange(18, 24);
      const droneCount = this.entities.filter(
        (entity) => entity.alive && entity.kind === 'fighter' && entity.team === 'hostile',
      ).length;
      // v0.4 gave the drones guns, so the swarm cap came down with it. The swarm
      // also stops once the shields are gone: a reactor run is a long, straight,
      // predictable pass, and having three armed drones sawing at the airframe
      // through it turned the endgame into a war of attrition the player could
      // not win by flying well. The escorts belong to the shield phase.
      const shieldsUp = this.getWeakpoints().some(
        (weakpoint) => weakpoint.weakpoint?.key !== 'core' && weakpoint.alive,
      );
      if (droneCount < 2 && shieldsUp) this.spawnDrone(boss);
    }

    this.updateBossAttacks(boss, pose, dt);
  }

  /* ------------------------------------------------------------------ */
  /* v0.5 boss attacks                                                   */
  /* ------------------------------------------------------------------ */

  /** 1 = both shields up, 2 = one down, 3 = reactor exposed. */
  private bossStage(): 1 | 2 | 3 {
    const weakpoints = this.getWeakpoints();
    const shieldsAlive = weakpoints.filter(
      (entity) => entity.weakpoint?.key !== 'core' && entity.alive,
    ).length;
    const coreExposed = weakpoints.some(
      (entity) => entity.weakpoint?.key === 'core' && entity.weakpoint.targetable,
    );
    return coreExposed ? 3 : shieldsAlive >= 2 ? 1 : 2;
  }

  /**
   * The attack director. It is a small state machine — idle → telegraph →
   * active → recover — with one rule that matters: an attack is only ever
   * chosen when the player is *outside* its reach, and every attack carries the
   * counter that beats it on the telegraph banner. Losing to the dreadnought
   * should always feel like losing a decision, never like being surprised.
   */
  private updateBossAttacks(boss: SimEntity, pose: BossPose, dt: number): void {
    const player = this.flight.position;
    const range = distance(boss.position, player);
    this.turretHeat = Math.max(0, this.turretHeat - dt * 0.8);
    this.pulseGlow = Math.max(0, this.pulseGlow - dt * 1.4);

    const active = this.bossAttackId ? BOSS_ATTACKS[this.bossAttackId] : null;

    if (active) {
      this.bossAttackTimer -= dt;
      if (this.bossAttackPhase === 'telegraph') {
        this.telegraphBossAttack(active, boss, pose, dt);
        if (this.bossAttackId && this.bossAttackTimer <= 0) {
          this.beginBossAttackActive(active, boss, pose);
        }
      } else if (this.bossAttackPhase === 'active') {
        this.runBossAttack(active, boss, pose, dt);
        if (this.bossAttackTimer <= 0) this.endBossAttack(active);
      } else if (this.bossAttackPhase === 'recover') {
        if (this.bossAttackTimer <= 0) {
          this.bossAttackId = null;
          this.bossAttackPhase = 'idle';
          this.bossAttackCooldown = randomRange(2.6, 4.6);
          this.emit({ type: 'boss-attack', id: active.id, phase: 'idle' });
        }
      }
      return;
    }

    for (const [id, value] of Array.from(this.bossAttackReady)) {
      if (value > 0) this.bossAttackReady.set(id, Math.max(0, value - dt));
    }
    this.bossAttackCooldown = Math.max(0, this.bossAttackCooldown - dt);

    // Sitting inside the shield umbrella winds the capacitor up. This is the
    // number that turns "park on its tail" into a losing plan.
    if (range < BOSS_ATTACKS.pulse.range[1]) this.loiter += dt;
    else this.loiter = Math.max(0, this.loiter - dt * 2);

    if (this.bossAttackCooldown > 0) return;

    const stage = this.bossStage();
    const ready = (id: BossAttackId) =>
      (this.bossAttackReady.get(id) ?? 0) <= 0 && BOSS_ATTACKS[id].fromStage <= stage;
    const inBand = (id: BossAttackId) =>
      range >= BOSS_ATTACKS[id].range[0] && range <= BOSS_ATTACKS[id].range[1];

    let pick: BossAttackId | null = null;
    if (this.loiter >= 2.4 && ready('pulse') && inBand('pulse')) pick = 'pulse';
    else if (stage === 3 && ready('lance') && inBand('lance') && Math.random() < 0.72) pick = 'lance';
    else if (ready('salvo') && inBand('salvo') && Math.random() < 0.55) pick = 'salvo';
    else if (ready('ciws') && inBand('ciws')) pick = 'ciws';
    else if (ready('salvo') && inBand('salvo')) pick = 'salvo';
    else if (ready('lance') && inBand('lance')) pick = 'lance';

    if (!pick) return;
    this.beginBossAttack(pick, boss, pose);
  }

  private beginBossAttack(id: BossAttackId, boss: SimEntity, pose: BossPose): void {
    const attack = BOSS_ATTACKS[id];
    this.bossAttackId = id;
    this.bossAttackPhase = 'telegraph';
    this.bossAttackTimer = attack.telegraph;
    this.bossAttackUses.set(id, (this.bossAttackUses.get(id) ?? 0) + 1);
    this.salvoFired = 0;

    if (id === 'lance') {
      this.lanceAxis = normalize(sub(this.flight.position, this.bossLanceMuzzle(pose)));
    }
    if (id === 'ciws') this.turretHeat = 1;

    this.warn('boss', attack.severity, attack.code, `${attack.labelZh} — ${attack.counterZh}`, attack.telegraph + 0.6);
    this.emit({ type: 'boss-attack', id, phase: 'telegraph' });

    // One AWACS line per attack, the first time it is used, so the mechanic is
    // taught in-fiction rather than only on the HUD.
    if (!this.bossSeenAttacks.has(id)) {
      this.bossSeenAttacks.add(id);
      this.say(this.scenario.awacsCallsign, 'awacs', BOSS_ATTACK_CALLOUT[id]);
    } else if (Math.random() < 0.4) {
      this.say(this.scenario.wingmanCallsign, 'wingman', BOSS_ATTACK_WINGMAN[id]);
    }
    if (boss.hp > 0) this.spawnEffect('flash', boss.position, { scale: 90, color: 'amber', life: 0.3 });
  }

  private telegraphBossAttack(
    attack: BossAttackDefinition,
    boss: SimEntity,
    pose: BossPose,
    dt: number,
  ): void {
    const total = Math.max(0.001, attack.telegraph);
    const charge = clamp(1 - this.bossAttackTimer / total, 0, 1);

    if (attack.id === 'lance') {
      // The lance tracks the player for the first 70% of the charge, then the
      // axis is committed and burns bright. That is the window the player has
      // to leave the corridor — and the reason the attack is survivable.
      const muzzle = this.bossLanceMuzzle(pose);
      if (charge < 0.7) {
        const wanted = normalize(sub(this.flight.position, muzzle));
        this.lanceAxis = normalize({
          x: lerp(this.lanceAxis?.x ?? wanted.x, wanted.x, 1 - Math.exp(-2.4 * dt)),
          y: lerp(this.lanceAxis?.y ?? wanted.y, wanted.y, 1 - Math.exp(-2.4 * dt)),
          z: lerp(this.lanceAxis?.z ?? wanted.z, wanted.z, 1 - Math.exp(-2.4 * dt)),
        });
      }
      if (charge > 0.5 && Math.random() < 0.5) {
        this.spawnEffect('spark', muzzle, {
          scale: randomRange(1.4, 3.2),
          color: 'cyan',
          life: 0.4,
          velocity: scale(this.lanceAxis ?? forwardFromAngles(boss.yaw, 0), randomRange(-20, 30)),
        });
      }
    } else if (attack.id === 'pulse') {
      this.pulseGlow = charge;
      if (Math.random() < 0.5) {
        const angle = randomRange(0, Math.PI * 2);
        const radius = 260 + charge * 900;
        this.spawnEffect(
          'spark',
          add(boss.position, {
            x: Math.cos(angle) * radius,
            y: randomRange(-90, 130),
            z: Math.sin(angle) * radius,
          }),
          { scale: randomRange(1.2, 2.4), color: 'cyan', life: 0.3 },
        );
      }
    } else if (attack.id === 'salvo') {
      for (const cell of BOSS_VLS) {
        this.spawnEffect('flash', bossAnchor(pose, cell), {
          scale: 26 + charge * 60,
          color: 'amber',
          life: 0.14,
        });
      }
    } else {
      this.turretHeat = Math.max(this.turretHeat, charge);
      for (const mount of BOSS_TURRETS) {
        this.spawnEffect('muzzle', bossAnchor(pose, mount), { scale: 3, color: 'amber', life: 0.08 });
      }
    }
  }

  private beginBossAttackActive(attack: BossAttackDefinition, boss: SimEntity, pose: BossPose): void {
    this.bossAttackPhase = 'active';
    this.bossAttackTimer = attack.active;
    this.emit({ type: 'boss-attack', id: attack.id, phase: 'active' });

    if (attack.id === 'pulse') {
      const origin = boss.position;
      this.pulseGlow = 1;
      this.spawnEffect('pulse', origin, { scale: 420, color: 'cyan', life: 0.85 });
      this.spawnEffect('shockwave', origin, { scale: 340, color: 'cyan', life: 0.9 });
      this.spawnEffect('flash', origin, { scale: 260, color: 'white', life: 0.24 });
      this.emit({ type: 'explosion', position: origin, scale: 40, distance: distance(origin, this.flight.position) });
      const range = distance(origin, this.flight.position);
      if (range < BOSS_ATTACKS.pulse.range[1]) {
        this.damagePlayer(attack.damage, origin);
        this.shovePlayer(origin, 260);
        this.warn('boss', 'critical', 'PULSE HIT', '被护盾脉冲命中 — 脱离近距', 2.2);
      } else {
        this.warn('system', 'caution', 'PULSE CLEAR', '已脱离脉冲范围 — 保持距离', 1.6);
      }
    }
    if (attack.id === 'lance' && this.lanceAxis) {
      const muzzle = this.bossLanceMuzzle(pose);
      this.spawnEffect('beam', muzzle, {
        to: add(muzzle, scale(this.lanceAxis, 4600)),
        scale: 30,
        color: 'red',
        life: attack.active,
      });
      this.spawnEffect('flash', muzzle, { scale: 220, color: 'white', life: 0.3 });
      this.emit({ type: 'boss-lance-fire', origin: muzzle, axis: this.lanceAxis });
      this.shakeOnly(1.1);
    }
  }

  private runBossAttack(
    attack: BossAttackDefinition,
    boss: SimEntity,
    pose: BossPose,
    dt: number,
  ): void {
    const player = this.flight.position;
    if (attack.id === 'ciws') {
      this.turretHeat = 1;
      const forward = forwardFromAngles(boss.yaw, 0);
      const toPlayer = normalize(sub(player, boss.position));
      const angle = angleBetween(forward, toPlayer) * RAD;
      const range = distance(boss.position, player);
      // The guns only bear on the forward hemisphere: get behind it and the
      // close-in battery stops being a reason to stay away.
      if (angle < 112 && range < attack.range[1]) {
        for (const mount of BOSS_TURRETS) {
          this.spawnEffect('tracer', bossAnchor(pose, mount), {
            to: player,
            scale: 1,
            color: 'amber',
            life: 0.1,
          });
        }
        if (Math.random() < 0.55) {
          this.damagePlayer((attack.damage / attack.active) * dt * 1.15, boss.position);
        }
      }
      return;
    }

    if (attack.id === 'salvo') {
      const want = Math.min(4, Math.floor((1 - this.bossAttackTimer / attack.active) * 4) + 1);
      if (this.salvoFired < want) {
        this.salvoFired += 1;
        const cell = BOSS_VLS[(this.salvoFired - 1 + BOSS_VLS.length) % BOSS_VLS.length]!;
        this.fireBossMissile(bossAnchor(pose, cell));
      }
      return;
    }

    if (attack.id === 'lance') {
      const axis = this.lanceAxis;
      if (!axis) return;
      const muzzle = this.bossLanceMuzzle(pose);
      // The beam sweeps a couple of degrees across its firing window, so
      // standing perfectly still on the edge of the corridor is not a save.
      const sweep = Math.sin((1 - this.bossAttackTimer / attack.active) * Math.PI) * 0.045;
      const swept = normalize({
        x: axis.x + Math.cos(boss.yaw) * sweep,
        y: axis.y,
        z: axis.z - Math.sin(boss.yaw) * sweep,
      });
      this.lanceAxis = swept;
      if (lanceHits(muzzle, swept, player)) {
        this.damagePlayer((attack.damage / attack.active) * dt * 1.05, muzzle);
        this.spawnEffect('spark', player, { scale: 3.4, color: 'red', life: 0.2 });
      }
      if (Math.random() < 0.7) {
        const along = randomRange(600, 4200);
        this.spawnEffect('spark', add(muzzle, scale(swept, along)), {
          scale: randomRange(2, 4.5),
          color: 'red',
          life: 0.22,
        });
      }
      this.shakeOnly(dt * 6);
      return;
    }

    // Pulse is a single detonation; the active window is only its afterglow.
    this.pulseGlow = Math.max(0, this.bossAttackTimer / attack.active);
  }

  private endBossAttack(attack: BossAttackDefinition): void {
    this.bossAttackReady.set(
      attack.id,
      randomRange(attack.cooldown[0], attack.cooldown[1]),
    );
    this.bossAttackPhase = 'recover';
    this.bossAttackTimer = 0.45;
    if (attack.id === 'lance') this.lanceAxis = null;
    if (attack.id === 'pulse') this.loiter = 0;
    this.emit({ type: 'boss-attack', id: attack.id, phase: 'recover' });
  }

  private bossLanceMuzzle(pose: BossPose): Vec3 {
    return bossAnchor(pose, BOSS_LANCE_MUZZLE);
  }

  /** A radar-guided round from the vertical launch cells. */
  private fireBossMissile(origin: Vec3): void {
    const direction = normalize(sub(this.flight.position, origin));
    const angles = yawPitchFromDirection(direction);
    const missile = this.makeEntity({
      kind: 'missile',
      team: 'hostile',
      callsign: 'LEVIATHAN VLS',
      position: add(origin, scale(direction, 10)),
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed: 540,
      hp: 1,
      maxHp: 1,
      radius: 3,
      label: 'LEVIATHAN',
    });
    missile.missile = {
      targetId: 'player',
      speed: 540,
      life: 9,
      maxLife: 9,
      owner: 'hostile',
      whooshed: false,
    };
    missile.life = 9;
    missile.maxLife = 9;
    this.entities.push(missile);
    this.spawnEffect('flash', origin, { scale: 70, color: 'amber', life: 0.18 });
    this.spawnEffect('smoke', origin, {
      scale: 8,
      color: 'white',
      life: 1.1,
      velocity: { x: 0, y: 22, z: 0 },
    });
    this.emit({ type: 'missile-fire', team: 'hostile', id: missile.id });
  }

  /** A directional shove, used by the shield pulse and by hull contact. */
  private shovePlayer(origin: Vec3, power: number): void {
    const away = normalize(sub(this.flight.position, origin));
    const before = this.flight.yaw;
    const push = add(this.flight.position, scale(away, power));
    this.flight.position = push;
    // Nudge the nose away from the blast so the shove reads on the camera too.
    const wanted = yawPitchFromDirection(away);
    this.flight.yaw = wrapRadians(before + clamp(wrapRadians(wanted.yaw - before), -0.22, 0.22));
    this.flight.rollRate += randomRange(-0.4, 0.4);
  }

  private shakeOnly(amount: number): void {
    this.pendingShake = Math.min(2, this.pendingShake + amount);
  }

  /**
   * v0.5 collision volume. The dreadnought is a compound body, not a point:
   * fly into it and you scrape 45% off the airframe and get shoved clear, while
   * a gun pass over the hull sparks off the armour instead of passing through.
   *
   * The shove is clamped rather than applied in full. A shallow clip — the case
   * that actually happens at 250 m/s — resolves in one frame either way, but a
   * player who somehow ends up in the middle of the keel would otherwise be
   * teleported four hundred metres sideways by a single "nearest exit" solve.
   * Clamped, they get bounced hard along the escape direction and walk out over
   * the next few frames, which is what a collision should look like.
   */
  private resolveHullContact(boss: SimEntity, pose: BossPose, dt: number): void {
    this.hullScrapeCooldown = Math.max(0, this.hullScrapeCooldown - dt);
    const push = bossHullPushOut(pose, this.flight.position, HULL_GRACE);
    if (!push) return;

    const span =
      Math.abs(push.correction.x) + Math.abs(push.correction.y) + Math.abs(push.correction.z);
    const factor = span > HULL_PUSH_MAX ? HULL_PUSH_MAX / span : 1;
    this.flight.position = add(this.flight.position, scale(push.correction, factor));
    this.flight.position.y = clamp(this.flight.position.y, GROUND_FLOOR, CEILING);

    if (this.hullScrapeCooldown > 0) return;
    this.hullScrapeCooldown = 1.6;
    const impact = this.flight.position;
    this.spawnEffect('explosion', impact, { scale: 18, color: 'amber', life: 0.5 });
    this.spawnSparks(impact, 'amber', 12, 1.4);
    this.spawnEffect('flash', impact, { scale: 90, color: 'white', life: 0.16 });
    this.damagePlayer(45, boss.position);
    this.warn('boss', 'critical', `HULL STRIKE · ${push.part}`, '撞击舰体 — 立即脱离', 2.6);
    this.emit({ type: 'hull-impact', part: push.part, damage: 45 });
    this.shakeOnly(1.4);
  }

  /** Where the collision volume sits, for the renderer's near-miss cues. */
  getBossVisualState(): BossVisualState {
    const boss = this.getEntity(this.bossId);
    if (!boss || !boss.alive) return BOSS_VISUAL_IDLE;
    const weakpoints = this.getWeakpoints();
    const shieldsUp = weakpoints.some(
      (entity) => entity.weakpoint?.key !== 'core' && entity.alive,
    );
    const coreExposed = weakpoints.some(
      (entity) => entity.weakpoint?.key === 'core' && entity.weakpoint.targetable,
    );
    const attack = this.bossAttackId ? BOSS_ATTACKS[this.bossAttackId] : null;
    const total =
      attack === null
        ? 1
        : this.bossAttackPhase === 'telegraph'
          ? Math.max(0.001, attack.telegraph)
          : Math.max(0.001, attack.active);
    return {
      active: true,
      alive: true,
      stage: this.bossStage(),
      shieldsUp,
      coreExposed,
      attackId: this.bossAttackId,
      phase: this.bossAttackPhase,
      charge: attack ? clamp(1 - this.bossAttackTimer / total, 0, 1) : 0,
      pulse: this.pulseGlow,
      turretHeat: this.turretHeat,
      lanceAxis: this.lanceAxis,
    };
  }

  private updateMissionState(dt: number): void {
    if (this.flight.hp <= 0 && this.phase !== 'complete' && this.phase !== 'failed') {
      this.failMission();
      return;
    }
    if (this.phase === 'dogfight') {
      // v0.4: the boss arrives once the required kills are in, once the clock
      // runs out, or once every wave has been released and the sky is clear —
      // whichever the sortie reaches first. The last clause stops a slow player
      // from being stranded with nothing left to shoot, but it needs the
      // scenario to actually field bandits: an empty stage is a test rig, not a
      // cleared sky.
      const staged = this.allHostileUnits().length > 0;
      const wavesLeft = this.waveIndex < this.getReinforcements().length;
      const swept = staged && !wavesLeft && this.hostileCount() === 0;
      if (
        this.kills >= this.scenario.requiredKills ||
        this.elapsed >= this.scenario.bossTriggerAt ||
        swept
      ) {
        this.beginBossIntro();
      }
      return;
    }
    if (this.phase === 'boss' && this.bossDefeated) {
      this.completionTimer -= dt;
      if (this.completionTimer <= 0) this.completeMission();
    }
  }

  private beginBossIntro(): void {
    if (this.phase !== 'dogfight') return;
    this.phase = 'boss-intro';
    this.bossIntroTimer = 3.1;
    this.weapons.missiles = this.weapons.maxMissiles;
    this.weapons.flares = this.weapons.maxFlares;
    this.weapons.gunAmmo = this.weapons.gunMax;
    // v0.4 tripled the number of bandits waiting before the dreadnought, and
    // gave them guns. Without a field repair the second half of the sortie was
    // decided before it started; this is the arcade concession that keeps the
    // stage winnable for a human and for AUTO ACE alike.
    const patched = Math.min(this.flight.maxHp, this.flight.hp + RESUPPLY_REPAIR);
    const repaired = patched - this.flight.hp;
    this.flight.hp = patched;
    this.emit({ type: 'resupply' });
    this.spawnBoss();
    this.say(
      this.scenario.awacsCallsign,
      'awacs',
      '警告！巨型空中目标进入战区 — 识别为 LEVIATHAN。全员规避其弹幕。',
    );
    this.say(this.scenario.wingmanCallsign, 'wingman', '那东西比整座城市还大……队长，我跟着你。');
    if (repaired >= 4) {
      this.say(
        this.scenario.awacsCallsign,
        'awacs',
        `补给机完成空中加油与应急修补，机体恢复 ${Math.round(repaired)}%。`,
      );
    }
    this.warn('boss', 'critical', 'MASSIVE CONTACT', '战争巨兽出现 — 摧毁护盾节点', 4.5);
    this.emit({ type: 'boss-intro' });
    const shield = this.entities.find(
      (entity) => entity.kind === 'weakpoint' && entity.weakpoint?.key === 'shieldL',
    );
    if (shield) this.selectTarget(shield.id);
  }

  private completeMission(): void {
    if (this.phase === 'complete') return;
    const accuracy = this.stats.missilesFired > 0 ? this.stats.missilesHit / this.stats.missilesFired : 0;
    const timeBonus = Math.max(0, Math.round(1200 - this.elapsed * 5.5));
    this.score += 2000 + Math.round(accuracy * 800) + timeBonus;
    this.stats.score = this.score;
    this.stats.elapsed = Math.floor(this.elapsed);
    // v0.4 put eight bandits, a swarm of drones and a dreadnought on the stage
    // instead of three fighters, so the bar for an S moved with the pot.
    this.stats.rank =
      this.score >= 7200 ? 'S' : this.score >= 5800 ? 'A' : this.score >= 4200 ? 'B' : 'C';
    this.phase = 'complete';
    this.gunHeld = false;
    this.gunFiring = false;
    this.cancelManeuvers();
    this.addComms(this.scenario.awacsCallsign, 'awacs', 'LEVIATHAN 已沉没。全体返航，这是属于 CIRRUS 的黄昏。');
    this.say(this.scenario.wingmanCallsign, 'wingman', '干得漂亮，队长。今晚的酒我请。');
    this.emit({ type: 'mission-complete' });
  }

  private failMission(): void {
    if (this.phase === 'failed' || this.phase === 'complete') return;
    this.phase = 'failed';
    this.flight.hp = 0;
    this.gunHeld = false;
    this.gunFiring = false;
    this.cancelManeuvers();
    this.stats.elapsed = Math.floor(this.elapsed);
    this.stats.rank = 'C';
    this.stats.score = this.score;
    this.spawnEffect('explosion', this.flight.position, { scale: 40, color: 'red', life: 1.4 });
    this.emit({
      type: 'explosion',
      position: this.flight.position,
      scale: 40,
      distance: 0,
    });
    this.say(this.scenario.wingmanCallsign, 'wingman', 'LUMEN 1！跳伞！重复，跳伞！');
    this.emit({ type: 'mission-failed' });
  }

  /* ------------------------------------------------------------------ */
  /* spawning & damage                                                   */
  /* ------------------------------------------------------------------ */

  private makeEntity(options: {
    kind: SimEntity['kind'];
    team: SimEntity['team'];
    callsign: string;
    position: Vec3;
    speed: number;
    hp: number;
    maxHp: number;
    radius: number;
    yaw?: number;
    pitch?: number;
    roll?: number;
    label?: string;
    variant?: SimEntity['variant'];
    enemyId?: EnemyId | null;
  }): SimEntity {
    this.idCounter += 1;
    return {
      id: `${options.kind}-${this.idCounter}`,
      kind: options.kind,
      team: options.team,
      callsign: options.callsign,
      label: options.label ?? options.callsign,
      position: options.position,
      yaw: options.yaw ?? 0,
      pitch: options.pitch ?? 0,
      roll: options.roll ?? 0,
      speed: options.speed,
      hp: options.hp,
      maxHp: options.maxHp,
      radius: options.radius,
      alive: true,
      variant: options.variant ?? 'standard',
      enemyId: options.enemyId ?? null,
      ai: null,
      missile: null,
      weakpoint: null,
      drift: null,
      life: 0,
      maxLife: 0,
    };
  }

  /**
   * Put one scenario bandit in the air. The airframe profile decides hp, speed
   * and role; the scenario only has to say where it starts.
   */
  private spawnBandit(
    enemy: Scenario['enemies'][number],
    origin: Vec3,
    forward: Vec3,
    right: Vec3,
  ): SimEntity {
    const profile = ENEMIES[resolveEnemyId(enemy)];
    const position = add(
      add(origin, scale(forward, enemy.distance)),
      add(scale(right, enemy.side), { x: 0, y: enemy.vertical, z: 0 }),
    );
    const angles = yawPitchFromDirection(sub(origin, position));
    const entity = this.makeEntity({
      kind: 'fighter',
      team: 'hostile',
      callsign: enemy.callsign,
      label: enemy.callsign,
      position,
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed: profile.speed,
      hp: profile.hp,
      maxHp: profile.hp,
      radius: profile.radius,
      variant: profile.variant,
      enemyId: profile.id,
    });
    entity.ai = createAIState({
      mode: 'engage',
      cooldown: profile.missile ? randomRange(...profile.missile.cooldown) : randomRange(4, 8),
      gunCooldown: profile.gun ? randomRange(...profile.gun.interval) : 99,
      seed: randomRange(0, 10),
    });
    this.entities.push(entity);
    return entity;
  }

  private spawnWingman(): void {
    if (this.getEntity(this.wingmanId)) return;
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const position = add(
      add(this.flight.position, scale(forward, 300)),
      add(scale(right, 190), { x: 0, y: 30, z: 0 }),
    );
    const wingman = this.makeEntity({
      kind: 'wingman',
      team: 'ally',
      callsign: this.scenario.wingmanCallsign,
      label: 'WINGMAN',
      position,
      yaw: this.flight.yaw,
      pitch: this.flight.pitch,
      roll: this.flight.roll,
      speed: this.flight.speed,
      hp: 100,
      maxHp: 100,
      radius: 8,
    });
    wingman.ai = createAIState({ mode: 'formation', cooldown: 4.5, seed: 2, gunCooldown: 99 });
    this.entities.push(wingman);
    this.wingmanId = wingman.id;
  }

  private spawnInitialEnemies(): void {
    const forward = forwardFromAngles(this.flight.yaw, 0);
    const right = rightFromYaw(this.flight.yaw);
    for (const enemy of this.scenario.enemies) {
      this.spawnBandit(enemy, this.flight.position, forward, right);
    }
  }

  /**
   * v0.4 wave director. The opening formation is wave one; every entry in
   * `scenario.reinforcements` is released once the fighting has burned down,
   * on a kill count or a clock — whichever the mission reaches first.
   */
  private updateWaves(dt: number): void {
    this.waveInboundTimer = Math.max(0, this.waveInboundTimer - dt);
    const waves = this.getReinforcements();
    if (this.waveIndex >= waves.length) return;
    if (this.phase !== 'dogfight' && this.phase !== 'boss') return;

    const wave = waves[this.waveIndex];
    const gate = {
      kills: this.kills,
      elapsed: this.elapsed,
      hostiles: this.hostileCount(),
      pending: waves.length - this.waveIndex,
      phase: this.phase,
    };
    if (!waveReady(wave, gate)) return;

    this.waveIndex += 1;
    this.waveInboundTimer = 3.4;
    const forward = forwardFromAngles(this.flight.yaw, 0);
    const right = rightFromYaw(this.flight.yaw);
    for (const unit of wave.units) {
      this.spawnBandit(unit, this.flight.position, forward, right);
    }
    // Reinforcements arrive with a rearm. v0.4 puts three times as many bandits
    // in the air as v0.3 did, and eight missiles is not a sortie's worth of
    // eight-plus bandits — a player who spends them on the vanguard would face
    // the commander's flight with an empty rail and a gun. Tying the resupply to
    // the wave is also the clearest tactical reading: the wave is the beat.
    this.weapons.missiles = this.weapons.maxMissiles;
    this.weapons.flares = this.weapons.maxFlares;
    this.emit({ type: 'resupply' });
    const text = waveBriefing(wave, wave.units);
    this.say(this.scenario.awacsCallsign, 'awacs', text);
    this.warn('system', 'warning', wave.code, `${wave.labelZh} — ${wave.units.length} 架进入战区`, 3.2);
    this.emit({
      type: 'wave-inbound',
      code: wave.code,
      labelZh: wave.labelZh,
      units: wave.units.length,
    });
  }

  private hostileCount(): number {
    let count = 0;
    for (const entity of this.entities) {
      if (entity.alive && entity.kind === 'fighter' && entity.team === 'hostile') count += 1;
    }
    return count;
  }

  private aliveJammers(): SimEntity[] {
    return this.entities.filter(
      (entity) =>
        entity.alive &&
        entity.kind === 'fighter' &&
        entity.team === 'hostile' &&
        enemyProfile(entity.enemyId)?.jammer === true,
    );
  }

  /**
   * A live jammer inside its working radius halves the fire-control solution.
   * It is deliberately a rate penalty, not a lock-out: the player can still
   * fight, but the smart play is to kill the jammer first — and the autopilot
   * does exactly that.
   */
  private updateJamming(): void {
    const active = this.aliveJammers().some(
      (jammer) => distance(jammer.position, this.flight.position) < 4600,
    );
    if (active === this.jammerEngaged) return;
    this.jammerEngaged = active;
    this.emit({ type: 'jammer-active', engaged: active });
    if (active) {
      this.warn('system', 'caution', 'ECM ACTIVE', '敌方干扰机在压制火控 — 优先击落', 3.2);
    } else {
      this.warn('system', 'caution', 'ECM CLEAR', '干扰消失 — 火控恢复正常', 2.2);
    }
  }

  private spawnDrone(boss: SimEntity): void {
    const profile = ENEMIES.drone;
    const offset = {
      x: randomRange(-180, 180),
      y: randomRange(-40, 50),
      z: randomRange(-120, 120),
    };
    const position = add(boss.position, offset);
    const direction = sub(this.flight.position, position);
    const angles = yawPitchFromDirection(direction);
    const drone = this.makeEntity({
      kind: 'fighter',
      team: 'hostile',
      callsign: 'VESPER DRONE',
      position,
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed: profile.speed,
      hp: profile.hp,
      maxHp: profile.hp,
      radius: profile.radius,
      variant: 'standard',
      enemyId: 'drone',
    });
    drone.ai = createAIState({
      mode: 'engage',
      cooldown: randomRange(1, 2.5),
      gunCooldown: randomRange(3, 6),
      seed: randomRange(0, 10),
    });
    this.entities.push(drone);
    this.say(this.scenario.awacsCallsign, 'awacs', 'LEVIATHAN 放出无人机群，注意近距离缠斗。');
  }

  private spawnBoss(): void {
    if (this.getEntity(this.bossId)) return;
    const config = this.scenario.boss;
    const forward = forwardFromAngles(this.flight.yaw, 0);
    const right = rightFromYaw(this.flight.yaw);
    const position: Vec3 = {
      x: this.flight.position.x + forward.x * config.spawnDistance + right.x * config.spawnSide,
      y: config.spawnAlt,
      z: this.flight.position.z + forward.z * config.spawnDistance + right.z * config.spawnSide,
    };
    const boss = this.makeEntity({
      kind: 'dreadnought',
      team: 'hostile',
      callsign: config.callsign,
      label: config.nameEn,
      position,
      yaw: yawPitchFromDirection(sub(this.flight.position, position)).yaw,
      pitch: 0,
      speed: 5,
      hp: 600,
      maxHp: 600,
      // v0.5: the radius now describes the *collision volume* and the building
      // the player sees, not a fudge factor. The compound collider in
      // `sim/boss.ts` is the authority; this is its bounding sphere.
      radius: BOSS_HULL_RADIUS,
      variant: 'dreadnought',
    });
    boss.ai = createAIState({ mode: 'drift', cooldown: 0, seed: 7, gunCooldown: 99 });
    this.entities.push(boss);
    this.bossId = boss.id;

    for (const key of ['shieldL', 'shieldR', 'core'] as WeakpointKey[]) {
      const anchor = BOSS_ANCHOR[key];
      const weakpoint = this.makeEntity({
        kind: 'weakpoint',
        team: 'hostile',
        callsign: config.callsign,
        label: BOSS_WEAKPOINT_LABEL[key],
        position: boss.position,
        yaw: boss.yaw,
        speed: 0,
        hp: BOSS_WEAKPOINT_HP[key],
        maxHp: BOSS_WEAKPOINT_HP[key],
        // v0.5 gave the nodes a body worth aiming at: 26 m across a 3.6 km lock
        // range was a pixel, so the gun literally could not hit what the HUD
        // was pointing at.
        radius: key === 'core' ? 62 : 48,
        variant: 'dreadnought',
      });
      weakpoint.weakpoint = {
        key,
        parentId: boss.id,
        label: BOSS_WEAKPOINT_LABEL[key],
        targetable: key !== 'core',
      };
      weakpoint.position = add(
        add(boss.position, scale(rightFromYaw(boss.yaw), anchor.x)),
        add(scale(forwardFromAngles(boss.yaw, 0), -anchor.z), { x: 0, y: anchor.y, z: 0 }),
      );
      this.entities.push(weakpoint);
    }
  }

  private applyDamage(
    target: SimEntity,
    damage: number,
    source: 'player' | 'wingman',
    assist = false,
    weapon: 'gun' | 'missile' = 'gun',
  ): void {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - damage);
    const mine = source === 'player';
    const willKill =
      !assist && target.hp <= 0 && (target.kind === 'fighter' || target.kind === 'weakpoint');
    this.emit({
      type: 'hit',
      targetId: target.id,
      damage,
      mine,
      weapon,
      kind: target.kind === 'weakpoint' ? 'weakpoint' : 'fighter',
      kill: willKill,
    });
    if (mine) this.registerHit(target, damage, willKill);

    if (target.kind === 'weakpoint') {
      // The v0.3 shield read: a hard, cold hit that clearly says "not through yet".
      this.spawnEffect('shield', target.position, { scale: 26, color: 'cyan', life: 0.42 });
      this.spawnSparks(target.position, 'cyan', 3, 0.9);
    } else {
      this.spawnEffect('explosion', target.position, {
        scale: weapon === 'missile' ? 8 : 4.6,
        color: 'amber',
        life: weapon === 'missile' ? 0.42 : 0.3,
      });
      this.spawnSparks(
        target.position,
        'amber',
        weapon === 'missile' ? 8 : 4,
        weapon === 'missile' ? 1.35 : 1,
      );
    }

    if (target.kind === 'fighter') {
      if (target.hp <= 0) {
        if (assist) {
          target.hp = 1;
          return;
        }
        this.destroyFighter(target, mine);
      }
      return;
    }
    if (target.kind === 'weakpoint' && target.weakpoint) {
      if (assist) {
        target.hp = Math.max(1, target.hp);
        return;
      }
      if (target.hp <= 0) this.destroyWeakpoint(target);
    }
  }

  private destroyFighter(target: SimEntity, minedByPlayer: boolean): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    this.spawnEffect('explosion', target.position, { scale: 28, color: 'red', life: 1.2 });
    this.spawnEffect('shockwave', target.position, { scale: 40, color: 'amber', life: 0.8 });
    this.spawnEffect('flash', target.position, { scale: 60, color: 'white', life: 0.22 });
    this.spawnDebris(target.position, 7, 1);
    this.emit({
      type: 'explosion',
      position: target.position,
      scale: 24,
      distance: distance(target.position, this.flight.position),
    });
    if (minedByPlayer) {
      this.kills += 1;
      this.stats.kills += 1;
      const profile = enemyProfile(target.enemyId);
      const points = profile?.points ?? (target.variant === 'ace' ? 180 : 100);
      this.score += points;
      if (target.enemyId) {
        this.rosterDown.set(target.enemyId, (this.rosterDown.get(target.enemyId) ?? 0) + 1);
      }
      this.registerKill(target, points, false);
      this.emit({
        type: 'kill',
        targetId: target.id,
        callsign: target.callsign,
        label: target.label,
        points,
        ace: target.variant === 'ace',
      });
      this.say(this.scenario.wingmanCallsign, 'wingman', this.killLine(profile));
    }
    if (this.selectedId === target.id) {
      this.selectedId = null;
      this.lockProgress = 0;
      this.lockWasLocked = false;
      this.autoSelect();
    }
  }

  private destroyWeakpoint(target: SimEntity): void {
    if (!target.alive || !target.weakpoint) return;
    target.alive = false;
    target.weakpoint.targetable = false;
    target.hp = 0;
    this.spawnEffect('explosion', target.position, { scale: 60, color: 'amber', life: 1.5 });
    this.spawnEffect('shockwave', target.position, { scale: 120, color: 'amber', life: 1.2 });
    this.spawnEffect('flash', target.position, { scale: 180, color: 'white', life: 0.3 });
    this.spawnDebris(target.position, 12, 1.6);
    this.emit({
      type: 'explosion',
      position: target.position,
      scale: 55,
      distance: distance(target.position, this.flight.position),
    });
    const points = 500;
    this.score += points;
    this.registerKill(target, points, true);
    this.emit({
      type: 'kill',
      targetId: target.id,
      callsign: target.callsign,
      label: target.label,
      points,
      ace: false,
    });

    const boss = this.getEntity(this.bossId);
    const weakpoints = this.getWeakpoints();
    if (target.weakpoint.key === 'core') {
      if (boss) {
        boss.alive = false;
        boss.hp = 0;
      }
      this.bossDefeated = true;
      this.completionTimer = 3.4;
      this.score += 2000;
      this.weapons.missiles = this.weapons.maxMissiles;
      this.spawnEffect('shockwave', target.position, { scale: 300, color: 'white', life: 2 });
      this.emit({ type: 'boss-destroyed' });
      this.say(this.scenario.awacsCallsign, 'awacs', '反应堆核心贯穿！LEVIATHAN 正在解体 — 全员脱离。');
      this.say(this.scenario.wingmanCallsign, 'wingman', '天哪……它真的沉了。队长，我们回家。');
      this.selectedId = null;
      this.lockProgress = 0;
      return;
    }

    this.emit({ type: 'boss-shield-down', key: target.weakpoint.key });
    const aliveShields = weakpoints.filter(
      (weakpoint) => weakpoint.weakpoint?.key !== 'core' && weakpoint.alive,
    ).length;
    const core = weakpoints.find((weakpoint) => weakpoint.weakpoint?.key === 'core');
    if (aliveShields === 0 && core && core.weakpoint) {
      core.weakpoint.targetable = true;
      this.say(this.scenario.awacsCallsign, 'awacs', '两具护盾节点失效，核心暴露！集中火力攻击反应堆。');
      this.selectTarget(core.id);
    } else {
      this.say(this.scenario.wingmanCallsign, 'wingman', '护盾节点失效一个，还有一具！');
      const next = weakpoints.find(
        (weakpoint) =>
          weakpoint.alive &&
          weakpoint.weakpoint?.key !== 'core' &&
          weakpoint.weakpoint?.targetable,
      );
      if (next) this.selectTarget(next.id);
    }
  }

  /**
   * The wingman reacts to *what* went down. v0.4 has seven airframe classes, so
   * "VESPER 被击落" for all of them wastes the best narrative beat in the game.
   */
  private killLine(profile: EnemyProfile | null): string {
    const lines = profile ? KILL_LINES[profile.id] : undefined;
    const pool = lines ?? KILL_LINES.interceptor;
    return pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
  }

  private damagePlayer(amount: number, from: Vec3 | null = null): void {
    if (this.phase === 'complete' || this.phase === 'failed') return;
    this.flight.hp = Math.max(0, this.flight.hp - amount);
    this.stats.damageTaken += amount;
    const bearing = from ? bearingDegrees(this.flight.yaw, this.flight.position, from) : 180;
    this.warn(
      'damage',
      amount >= 10 ? 'critical' : 'warning',
      'HULL DAMAGE',
      `结构损伤 -${amount.toFixed(0)}%`,
      1.7,
      bearing,
    );
    this.registerIncoming(amount, bearing);
    this.emit({ type: 'damage', amount, bearing });
    if (this.flight.hp <= 0) this.failMission();
  }

  /* ------------------------------------------------------------------ */
  /* v0.3 impact feedback                                                */
  /* ------------------------------------------------------------------ */

  /** Remember the last shot that connected so the HUD can flash a marker. */
  private registerHit(target: SimEntity, damage: number, kill: boolean): void {
    this.feedbackId += 1;
    this.hitMarker = {
      id: this.feedbackId,
      age: 0,
      duration: HIT_MARKER_TIME,
      damage,
      kill,
      kind: target.kind === 'weakpoint' ? 'weakpoint' : 'fighter',
    };
    this.comboHits.push(this.elapsed);
  }

  private registerIncoming(amount: number, bearing: number): void {
    this.feedbackId += 1;
    this.incoming.push({
      id: this.feedbackId,
      age: 0,
      duration: INCOMING_TIME,
      amount,
      bearing,
      severity: amount >= 12 ? 'critical' : amount >= 8 ? 'warning' : 'caution',
    });
    if (this.incoming.length > 4) this.incoming.shift();
  }

  private registerKill(target: SimEntity, points: number, weakpoint: boolean): void {
    this.feedbackId += 1;
    this.killFeed.unshift({
      id: this.feedbackId,
      age: 0,
      duration: KILL_FEED_TIME,
      callsign: target.callsign,
      label: target.label,
      points,
      ace: target.variant === 'ace',
      weakpoint,
    });
    if (this.killFeed.length > 4) this.killFeed.length = 4;
  }

  /**
   * Advance the transient feedback timers and re-derive the two atmosphere
   * numbers (threat, intensity) that the score, the mix and the HUD grade all
   * share, so the whole presentation breathes together.
   */
  private updateCombatFeedback(dt: number): void {
    if (this.hitMarker) {
      this.hitMarker.age += dt;
      if (this.hitMarker.age > this.hitMarker.duration) this.hitMarker = null;
    }
    for (const hit of this.incoming) hit.age += dt;
    this.incoming = this.incoming.filter((hit) => hit.age <= hit.duration);
    for (const entry of this.killFeed) entry.age += dt;
    this.killFeed = this.killFeed.filter((entry) => entry.age <= entry.duration);

    const cutoff = this.elapsed - COMBO_WINDOW;
    this.comboHits = this.comboHits.filter((at) => at >= cutoff);

    let nearest = Number.POSITIVE_INFINITY;
    for (const entity of this.entities) {
      if (!entity.alive || entity.team !== 'hostile') continue;
      if (entity.kind !== 'fighter' && entity.kind !== 'weakpoint') continue;
      nearest = Math.min(nearest, distance(entity.position, this.flight.position));
    }
    const proximity = Number.isFinite(nearest) ? clamp(1 - nearest / 7000, 0, 1) : 0;
    const inbound = this.entities.some(
      (entity) =>
        entity.alive &&
        entity.kind === 'missile' &&
        entity.team === 'hostile' &&
        entity.missile?.targetId === 'player',
    );
    const rawThreat = clamp(proximity + (inbound ? 0.7 : 0), 0, 1);
    this.threat = damp(this.threat, rawThreat, 1.6, dt);

    const danger = inbound ? 1 : this.lockWasLocked ? 0.72 : this.lockProgress > 0 ? 0.42 : 0.16;
    const base =
      this.phase === 'boss'
        ? 0.62
        : this.phase === 'boss-intro'
          ? 0.5
          : this.phase === 'dogfight'
            ? 0.28
            : this.phase === 'boot' || this.phase === 'idle'
              ? 0.06
              : 0.16;
    const targetIntensity = clamp(
      base +
        0.2 * danger +
        0.16 * this.threat +
        0.12 * clamp(this.flight.gLoad / 7, 0, 1) +
        0.07 * clamp((this.flight.speed - 150) / 180, 0, 1) +
        0.12 * (1 - clamp(this.flight.hp / this.flight.maxHp, 0, 1)) +
        (this.activeManeuver() ? 0.06 : 0) +
        (this.comboHits.length > 3 ? 0.06 : 0),
      0,
      1,
    );
    this.intensity = damp(this.intensity, targetIntensity, 1.1, dt);
  }

  /**
   * Background battle. The sky behind the duel keeps producing flak whether or
   * not the player is looking at it, which is what turns a flat sunset into a
   * war zone.
   */
  private updateAmbience(dt: number): void {
    const interval = AMBIENCE_INTERVAL[this.phase];
    if (!interval) {
      this.ambience = [];
      return;
    }
    for (const strike of this.ambience) {
      if (this.elapsed < strike.at) continue;
      this.spawnEffect('flak', strike.position, {
        scale: strike.scale,
        color: 'white',
        life: randomRange(1.1, 1.7),
        velocity: vec3(randomRange(-4, 4), randomRange(2, 7), randomRange(-4, 4)),
      });
    }
    this.ambience = this.ambience.filter((strike) => this.elapsed < strike.at);

    this.ambienceTimer -= dt;
    if (this.ambienceTimer > 0) return;
    this.ambienceTimer = randomRange(interval[0], interval[1]);
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const bursts = this.phase === 'boss' ? 2 : 1;
    for (let index = 0; index < bursts; index += 1) {
      const ahead = randomRange(2600, 8600);
      const lateral = randomRange(-5200, 5200);
      const vertical = randomRange(-900, 2400);
      this.ambience.push({
        at: this.elapsed + randomRange(0.35, 1.5),
        position: add(
          this.flight.position,
          add(scale(forward, ahead), add(scale(right, lateral), vec3(0, vertical, 0))),
        ),
        scale: randomRange(16, 34),
      });
    }
    // Tracer streams crossing the far sky. They never hit anything; they exist
    // so the horizon reads as a battle line rather than empty air.
    const streams = this.phase === 'boss' ? 7 : 4;
    for (let index = 0; index < streams; index += 1) {
      const origin = add(
        this.flight.position,
        add(
          scale(forward, randomRange(1800, 7200)),
          add(
            scale(right, randomRange(-6000, 6000)),
            vec3(0, randomRange(-600, 2600), 0),
          ),
        ),
      );
      const heading = normalize(
        vec3(randomRange(-1, 1), randomRange(-0.15, 0.35), randomRange(-1, 1)),
      );
      this.spawnEffect('tracer', origin, {
        to: add(origin, scale(heading, randomRange(700, 1600))),
        scale: 1,
        color: Math.random() < 0.3 ? 'red' : 'amber',
        life: randomRange(0.5, 0.95),
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* effects, warnings, comms                                            */
  /* ------------------------------------------------------------------ */

  private spawnEffect(
    kind: EffectKind,
    position: Vec3,
    options: {
      scale?: number;
      color?: EffectColor;
      life?: number;
      to?: Vec3;
      velocity?: Vec3;
      gravity?: number;
      spin?: number;
    } = {},
  ): void {
    this.idCounter += 1;
    const life = options.life ?? 0.6;
    this.effects.push({
      id: `fx-${this.idCounter}`,
      kind,
      position: { ...position },
      to: options.to ? { ...options.to } : null,
      scale: options.scale ?? 1,
      color: options.color ?? 'amber',
      life,
      maxLife: life,
      velocity: options.velocity ?? null,
      gravity: options.gravity ?? 0,
      spin: options.spin ?? 0,
      seed: Math.random(),
    });
    this.trimEffects();
  }

  /**
   * Keep the live effect count inside the frame budget by dropping the least
   * important effects first: a stray spark matters less than a kill explosion.
   */
  private trimEffects(): void {
    if (this.effects.length <= EFFECT_BUDGET) return;
    const overflow = this.effects.length - EFFECT_BUDGET;
    const ranked = this.effects
      .map((effect, index) => ({ index, priority: EFFECT_PRIORITY[effect.kind] ?? 5 }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index);
    const drop = new Set(ranked.slice(0, overflow).map((entry) => entry.index));
    this.effects = this.effects.filter((_, index) => !drop.has(index));
  }

  /** Bright metallic spray where a round lands — the core of the gun feel. */
  private spawnSparks(point: Vec3, color: EffectColor, count: number, power = 1): void {
    for (let index = 0; index < count; index += 1) {
      const direction = normalize(
        vec3(randomRange(-1, 1), randomRange(-0.6, 1), randomRange(-1, 1)),
      );
      this.spawnEffect('spark', point, {
        scale: randomRange(1.5, 3.2) * power,
        color,
        life: randomRange(0.14, 0.32),
        velocity: scale(direction, randomRange(26, 78) * power),
        gravity: 22,
      });
    }
  }

  /** Burning wreckage that tumbles away from a kill. */
  private spawnDebris(point: Vec3, count: number, power: number): void {
    for (let index = 0; index < count; index += 1) {
      const direction = normalize(
        vec3(randomRange(-1, 1), randomRange(-0.35, 1), randomRange(-1, 1)),
      );
      this.spawnEffect('debris', point, {
        scale: randomRange(2.4, 5.6) * power,
        color: Math.random() < 0.34 ? 'amber' : 'red',
        life: randomRange(0.9, 2.1),
        velocity: scale(direction, randomRange(18, 58) * power),
        gravity: 34,
        spin: randomRange(-7, 7),
      });
    }
  }

  private updateEffectsLifetime(dt: number): void {
    for (const effect of this.effects) {
      effect.life -= dt;
      if (!effect.velocity) continue;
      if (effect.gravity !== 0) effect.velocity.y -= effect.gravity * dt;
      effect.position = add(effect.position, scale(effect.velocity, dt));
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);
    for (const entity of this.entities) {
      if (entity.kind !== 'flare') continue;
      entity.life -= dt;
      if (entity.life <= 0) {
        entity.alive = false;
        continue;
      }
      // Cartridges are not flown: they tumble, fall and slow down.
      if (entity.drift) {
        entity.position = add(entity.position, scale(entity.drift, dt));
        entity.drift.y -= FLARE_FALL * dt;
        entity.drift.x *= Math.max(0, 1 - 1.6 * dt);
        entity.drift.z *= Math.max(0, 1 - 1.6 * dt);
        entity.roll += dt * 5;
      }
    }
  }

  private warn(
    kind: WarningState['kind'],
    severity: WarningState['severity'],
    message: string,
    detail: string,
    duration: number,
    direction = 0,
  ): void {
    const existing = this.warnings.find(
      (warning) => warning.kind === kind && warning.message === message,
    );
    if (existing) {
      existing.expiresAt = this.elapsed + duration;
      existing.detail = detail;
      existing.direction = direction;
      return;
    }
    const warning: WarningState = {
      id: `warn-${kind}-${this.idCounter++}`,
      kind,
      severity,
      message,
      detail,
      direction,
      expiresAt: this.elapsed + duration,
    };
    this.warnings.push(warning);
    if (this.warnings.length > 6) this.warnings.shift();
    this.emit({ type: 'warning', warning });
  }

  private updateMissileWarning(): void {
    const missile = this.entities.find(
      (entity) =>
        entity.alive &&
        entity.kind === 'missile' &&
        entity.team === 'hostile' &&
        entity.missile?.targetId === 'player',
    );
    if (!missile) return;
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const toMissile = normalize(sub(missile.position, this.flight.position));
    const direction =
      Math.atan2(
        toMissile.x * right.x + toMissile.y * right.y + toMissile.z * right.z,
        toMissile.x * forward.x + toMissile.y * forward.y + toMissile.z * forward.z,
      ) * RAD;
    this.warn('missile', 'critical', 'MISSILE ALERT', '导弹来袭 — F 释放热焰弹', 0.5, direction);
  }

  private addComms(from: string, role: CommsRole, text: string): void {
    const message: CommsMessage = {
      id: `comms-${this.idCounter++}`,
      at: this.elapsed,
      from,
      role,
      text,
    };
    this.comms.push(message);
    if (this.comms.length > 8) this.comms.shift();
    this.emit({ type: 'radio', message });
  }

  private say(from: string, role: CommsRole, text: string): void {
    this.addComms(from, role, text);
  }

  /* ------------------------------------------------------------------ */
  /* queries & snapshot                                                  */
  /* ------------------------------------------------------------------ */

  private canUseWeapons(): boolean {
    return (
      !this.paused &&
      (this.phase === 'dogfight' || this.phase === 'boss-intro' || this.phase === 'boss')
    );
  }

  private getEntity(id: string | null): SimEntity | undefined {
    if (!id) return undefined;
    return this.entities.find((entity) => entity.id === id);
  }

  private getWeakpoints(): SimEntity[] {
    return this.entities.filter((entity) => entity.kind === 'weakpoint');
  }

  private isLockable(entity: SimEntity): boolean {
    if (!entity.alive || entity.team !== 'hostile') return false;
    if (entity.kind === 'fighter') return true;
    if (entity.kind === 'weakpoint') return entity.weakpoint?.targetable === true;
    return false;
  }

  private getCandidates(): SimEntity[] {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    return this.entities
      .filter((entity) => this.isLockable(entity))
      .map((entity) => {
        const toTarget = normalize(sub(entity.position, this.flight.position));
        return {
          entity,
          score:
            angleBetween(forward, toTarget) * RAD +
            distance(entity.position, this.flight.position) / 1400,
        };
      })
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.entity);
  }

  private autoSelect(): void {
    if (this.phase !== 'dogfight' && this.phase !== 'boss' && this.phase !== 'boss-intro') return;
    const current = this.getEntity(this.selectedId);
    if (current && this.isLockable(current)) return;
    const candidates = this.getCandidates();
    const bossActive = Boolean(this.bossId) && !this.bossDefeated;
    const weakpoint = bossActive ? candidates.find((candidate) => candidate.kind === 'weakpoint') : undefined;
    this.selectTarget((weakpoint ?? candidates[0])?.id ?? null, false);
  }

  private getLockState(): LockState {
    const target = this.getEntity(this.selectedId);
    const targetable = Boolean(target && this.isLockable(target));
    const locked = targetable && this.lockProgress >= 0.999;
    const steeringAssist = this.assistSolution?.engaged.includes('steering') ?? false;
    return {
      targetId: targetable ? this.selectedId : null,
      callsign: targetable && target ? target.label || target.callsign : null,
      progress: targetable ? this.lockProgress : 0,
      state: locked ? 'locked' : targetable && this.lockProgress > 0.02 ? 'searching' : 'none',
      distance: this.lockDistance,
      inCone: this.lockInCone,
      steering: targetable ? this.lockSteering : 0,
      elevation: targetable ? this.lockElevation : 0,
      assisted: targetable && steeringAssist,
      jammed: targetable && this.jammerEngaged,
    };
  }

  /* ------------------------------------------------------------------ */
  /* v0.4 stage readouts                                                 */
  /* ------------------------------------------------------------------ */

  private buildRoster(): RosterEntry[] {
    const entries: RosterEntry[] = [];
    for (const [id, total] of this.roster) {
      const profile = ENEMIES[id];
      entries.push({
        enemyId: id,
        code: profile.code,
        labelZh: profile.labelZh,
        labelEn: profile.labelEn,
        total,
        alive: this.entities.filter(
          (entity) => entity.alive && entity.kind === 'fighter' && entity.enemyId === id,
        ).length,
        down: this.rosterDown.get(id) ?? 0,
      });
    }
    // Squadrons read best in the order the mission meets them.
    return entries.sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  }

  private buildWaveHud(): WaveHud {
    const waves = this.getReinforcements();
    const total = waves.length + 1;
    // `waveIndex` counts *released* reinforcements, so the wave on stage is the
    // previous entry — index 0 is the opening formation, which has no
    // `ScenarioWave` of its own. Reading `waves[waveIndex]` here is the obvious
    // mistake and it labels the tracker with the wave that has not arrived yet.
    const current = this.waveIndex > 0 ? waves[this.waveIndex - 1] : undefined;
    const next = this.waveIndex < waves.length ? waves[this.waveIndex] : undefined;
    const nextIn = next
      ? Math.max(0, Math.min(next.atTime - this.elapsed, next.atKills - this.kills))
      : null;
    return {
      index: this.waveIndex + 1,
      total,
      code: current?.code ?? 'WAVE 1',
      labelEn: current?.labelEn ?? 'VESPER VANGUARD',
      labelZh: current?.labelZh ?? '维斯珀 先锋',
      nextIn: this.phase === 'dogfight' && nextIn !== null ? nextIn : null,
      inbound: this.waveInboundTimer > 0,
      hostiles: this.hostileCount(),
      roster: this.buildRoster(),
    };
  }

  private buildAutoPilotHud(): AutoPilotHud {
    const memory = this.autoMemory;
    const label = AUTO_MODE_LABEL[memory.mode];
    const shown = autoPilotShown(memory);
    const scripted = this.scripted;
    const progress = scripted
      ? clamp(scripted.time / MANEUVERS[scripted.id].duration, 0, 1)
      : 0;
    return {
      engaged: this.autoPilot,
      mode: memory.mode,
      code: this.autoPilot ? label.code : 'MAN',
      labelEn: this.autoPilot ? label.en : 'MANUAL',
      labelZh: this.autoPilot ? label.zh : '手动',
      callout: this.autoPilot ? memory.callout || label.zh : '',
      progress: this.autoPilot ? progress : 0,
      demonstrated: shown.length,
      total: SHOWCASE_ORDER.length,
      plays: memory.plays,
      condition: autoPilotCondition({
        hp: this.flight.hp,
        maxHp: this.flight.maxHp,
        missiles: this.weapons.missiles,
        gunAmmo: this.weapons.gunAmmo,
        threats: this.entities.filter(
          (entity) =>
            entity.alive &&
            entity.kind === 'missile' &&
            entity.team === 'hostile' &&
            entity.missile?.targetId === 'player',
        ).length,
      }),
      targetCallsign: this.getEntity(this.selectedId)?.label ?? null,
      retryIn: this.autoPilot && this.autoRetryTimer !== null ? Math.max(0, this.autoRetryTimer) : null,
      shown,
    };
  }

  private buildBossHud(): BossHud | null {
    const boss = this.getEntity(this.bossId);
    if (!boss) return null;
    const weakpoints = this.getWeakpoints().filter(
      (entity) => entity.weakpoint?.parentId === boss.id,
    );
    if (weakpoints.length === 0) return null;
    const hp = weakpoints.reduce((total, entity) => total + Math.max(0, entity.hp), 0);
    const maxHp = weakpoints.reduce((total, entity) => total + entity.maxHp, 0);
    const shieldsAlive = weakpoints.filter(
      (entity) => entity.weakpoint?.key !== 'core' && entity.alive,
    ).length;
    const coreExposed = weakpoints.some(
      (entity) => entity.weakpoint?.key === 'core' && entity.weakpoint.targetable,
    );
    const stage: 1 | 2 | 3 = coreExposed ? 3 : shieldsAlive === 2 ? 1 : 2;
    const attack = this.buildBossAttackHud();
    const pose = this.bossPose(boss);
    const range = distance(boss.position, this.flight.position);
    return {
      id: boss.id,
      callsign: this.scenario.boss.callsign,
      nameEn: this.scenario.boss.nameEn,
      nameZh: this.scenario.boss.nameZh,
      hp,
      maxHp,
      stage,
      stageLabel: BOSS_STAGE_LABEL[stage].zh,
      stageCode: BOSS_STAGE_LABEL[stage].code,
      distance: range,
      // Inside this bubble the shield capacitor is winding up, and the hull is
      // close enough that a hard turn can put the player into it.
      tooClose: range < 900 || bossHitTest(pose, this.flight.position, 90) !== null,
      attack,
      nextIn:
        this.bossAttackId || this.phase !== 'boss'
          ? null
          : Math.max(0, this.bossAttackCooldown),
      weakpoints: weakpoints
        .map((entity) => ({
          key: entity.weakpoint?.key ?? 'core',
          label: entity.weakpoint?.label ?? BOSS_WEAKPOINT_LABEL.core,
          hp: Math.max(0, entity.hp),
          maxHp: entity.maxHp,
          destroyed: !entity.alive,
          targetable: entity.weakpoint?.targetable ?? false,
        }))
        .sort((a, b) => (a.key === 'core' ? 1 : b.key === 'core' ? -1 : a.key.localeCompare(b.key))),
    };
  }

  private buildBossAttackHud(): BossAttackHud | null {
    if (!this.bossAttackId || this.bossAttackPhase === 'idle') return null;
    const attack = BOSS_ATTACKS[this.bossAttackId];
    const total =
      this.bossAttackPhase === 'telegraph'
        ? Math.max(0.001, attack.telegraph)
        : this.bossAttackPhase === 'active'
          ? Math.max(0.001, attack.active)
          : 0.45;
    return {
      id: attack.id,
      code: attack.code,
      labelEn: attack.labelEn,
      labelZh: attack.labelZh,
      counterEn: attack.counterEn,
      counterZh: attack.counterZh,
      counterCode: attack.counter ? MANEUVERS[attack.counter].code : null,
      phase: this.bossAttackPhase,
      progress: clamp(1 - this.bossAttackTimer / total, 0, 1),
      remaining: Math.max(0, this.bossAttackTimer),
      severity: attack.severity,
      uses: this.bossAttackUses.get(attack.id) ?? 0,
    };
  }

  private buildManeuverHud(): ManeuverSnapshot {
    const active = this.activeManeuver();
    const definition = active ? MANEUVERS[active] : null;
    const progress =
      definition && definition.kind === 'scripted' && this.scripted
        ? clamp(this.scripted.time / definition.duration, 0, 1)
        : 0;
    return {
      active,
      activeLabelEn: definition?.labelEn ?? null,
      activeLabelZh: definition?.labelZh ?? null,
      activeCode: definition?.code ?? null,
      progress,
      list: buildManeuverStatus({
        speed: this.flight.speed,
        altitude: this.flight.position.y,
        activeManeuver: active,
        progress,
      }),
    };
  }

  private buildAssistHud() {
    const solution = this.assistSolution;
    return {
      master: this.assistMaster,
      anyEnabled: this.assistMaster && Object.values(this.assistSettings).some(Boolean),
      engaged: solution?.engaged ?? [],
      list: buildAssistStatus(
        this.assistSettings,
        this.assistMaster,
        solution?.engaged ?? [],
        solution?.authority ?? {
          attitude: 0,
          steering: 0,
          throttle: 0,
          terrain: 0,
        },
      ),
    };
  }

  private buildWingmanHud(): WingmanHud | null {    const wingman = this.getEntity(this.wingmanId);
    if (!wingman) return null;
    return {
      id: wingman.id,
      callsign: wingman.callsign,
      state:
        this.phase === 'complete'
          ? '返航 / RTB'
          : this.phase === 'failed'
            ? '紧急脱离'
            : this.bossId
              ? '交战 / ENGAGED'
              : '护航 / ON STATION',
      hp: wingman.hp,
      maxHp: wingman.maxHp,
      kills: 0,
      distance: distance(wingman.position, this.flight.position),
    };
  }

  private buildTargets(): HudTarget[] {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const lock = this.getLockState();
    const targets: HudTarget[] = [];
    for (const entity of this.entities) {
      const isAircraft = entity.kind === 'fighter' || entity.kind === 'wingman';
      const isWeakpoint = entity.kind === 'weakpoint';
      if (!entity.alive) continue;
      if (!isAircraft && !isWeakpoint) continue;
      if (isWeakpoint && !entity.weakpoint) continue;
      const toTarget = sub(entity.position, this.flight.position);
      const dist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
      const angle = angleBetween(forward, normalize(toTarget)) * RAD;
      const projection: Projection = this.projections.get(entity.id) ?? {
        x: 0.5,
        y: 0.5,
        scale: 1,
        onScreen: false,
      };
      const selected = this.selectedId === entity.id;
      targets.push({
        id: entity.id,
        callsign: entity.callsign,
        label: entity.label || entity.callsign,
        kind: entity.kind === 'weakpoint' ? 'weakpoint' : entity.kind === 'wingman' ? 'wingman' : 'fighter',
        team: entity.team,
        variant: entity.variant,
        enemyId: entity.enemyId,
        distance: dist,
        hp: entity.hp,
        maxHp: entity.maxHp,
        angle,
        selected,
        locked: selected && lock.state === 'locked',
        lockProgress: selected ? lock.progress : 0,
        lockable: this.isLockable(entity),
        priority: enemyPriority(entity),
        screen: projection,
      });
    }
    return targets.sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      if (a.team !== b.team) return a.team === 'hostile' ? -1 : 1;
      return a.distance - b.distance;
    });
  }

  private buildRadar(): RadarContact[] {
    const contacts: RadarContact[] = [];
    for (const entity of this.entities) {
      if (!entity.alive) continue;
      if (!['fighter', 'wingman', 'weakpoint', 'dreadnought'].includes(entity.kind)) continue;
      if (entity.kind === 'dreadnought') continue;
      const dx = entity.position.x - this.flight.position.x;
      const dz = entity.position.z - this.flight.position.z;
      contacts.push({
        id: entity.id,
        x: clamp(dx / RADAR_RANGE, -1, 1),
        y: clamp(dz / RADAR_RANGE, -1, 1),
        team: entity.team,
        kind:
          entity.kind === 'weakpoint'
            ? 'weakpoint'
            : entity.kind === 'wingman'
              ? 'wingman'
              : 'fighter',
        selected: this.selectedId === entity.id,
      });
    }
    return contacts;
  }

  private buildObjective(): { objective: string; objectiveZh: string; hint: string } {
    const lock = this.getLockState();
    const missileWarning = this.warnings.some((warning) => warning.kind === 'missile');
    if (this.phase === 'boot') {
      return { objective: 'SYSTEM BOOT', objectiveZh: '航电自检', hint: '座舱加压中……' };
    }
    if (this.phase === 'complete') {
      return { objective: 'MISSION COMPLETE', objectiveZh: '任务完成', hint: 'LEVIATHAN 已沉没' };
    }
    if (this.phase === 'failed') {
      return { objective: 'MISSION FAILED', objectiveZh: '任务失败', hint: '机体失控 — 按 R 重新出击' };
    }
    if (this.phase === 'boss-intro') {
      return {
        objective: 'MASSIVE CONTACT',
        objectiveZh: '战争巨兽接近',
        hint: 'LEVIATHAN — 摧毁护盾节点',
      };
    }
    const boss = this.buildBossHud();
    if (boss) {
      const core = boss.weakpoints.find((weakpoint) => weakpoint.key === 'core');
      if (this.bossDefeated) {
        return {
          objective: 'LEVIATHAN DOWN',
          objectiveZh: '巨兽解体',
          hint: '离开爆心，返航',
        };
      }
      if (core?.targetable) {
        return {
          objective: 'STRIKE THE CORE',
          objectiveZh: '攻击反应堆核心',
          hint: missileWarning ? '导弹来袭 — F 释放热焰弹' : '核心暴露 — 锁定并发射',
        };
      }
      return {
        objective: 'DESTROY SHIELD NODES',
        objectiveZh: '摧毁护盾节点',
        hint: missileWarning ? '导弹来袭 — F 释放热焰弹' : '护盾节点是唯一弱点',
      };
    }
    if (missileWarning) {
      return {
        objective: 'EVADE',
        objectiveZh: '规避导弹',
        hint: '导弹来袭 — F 释放热焰弹并机动',
      };
    }
    if (lock.state === 'locked') {
      return {
        objective: 'WEAPONS FREE',
        objectiveZh: '锁定完成',
        hint: '按 SPACE 发射导弹',
      };
    }
    return {
      objective: 'INTERCEPT',
      objectiveZh: `击落敌机 ${Math.min(this.kills, this.scenario.requiredKills)}/${this.scenario.requiredKills}`,
      hint: 'TAB 切换目标 — 保持目标在锁定锥内',
    };
  }

  getSnapshot(): CockpitSnapshot {
    const lock = this.getLockState();
    const boss = this.buildBossHud();
    const objective = this.buildObjective();
    const activeWarnings = this.warnings
      .filter((warning) => warning.expiresAt > this.elapsed)
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, caution: 2 };
        return order[a.severity] - order[b.severity];
      });
    return {
      phase: this.phase,
      paused: this.paused,
      elapsed: this.elapsed,
      operation: this.scenario.operation,
      titleEn: this.scenario.titleEn,
      titleZh: this.scenario.titleZh,
      view: this.view,
      flight: {
        speed: this.flight.speed,
        knots: this.flight.speed * 1.94384,
        mach: this.flight.speed / 340,
        altitude: this.flight.position.y,
        verticalSpeed: this.travelDir.y * this.flight.speed,
        heading: headingFromYaw(this.flight.yaw),
        pitch: clamp(this.flight.pitch * RAD, -90, 90),
        pitchRaw: this.flight.pitch * RAD,
        roll: this.flight.roll * RAD,
        rollRate: this.flight.rollRate * RAD,
        gLoad: this.flight.gLoad,
        throttle: this.flight.throttle,
        hp: this.flight.hp,
        maxHp: this.flight.maxHp,
        afterburner: this.flight.afterburner,
        airbrake: this.flight.airbrake,
        highG: this.flight.highG,
        postStall: this.flight.postStall,
        inverted: Math.abs(this.flight.pitch) > Math.PI / 2,
        stall: this.flight.speed <= (scriptedFloor(this.scripted) ?? SPEED_FLOOR) + 3,
      },
      weapons: {
        selected: this.weapons.selected,
        missiles: this.weapons.missiles,
        maxMissiles: this.weapons.maxMissiles,
        gunAmmo: this.weapons.gunAmmo,
        gunMax: this.weapons.gunMax,
        flares: this.weapons.flares,
        maxFlares: this.weapons.maxFlares,
        gunFiring: this.gunFiring,
      },
      lock,
      targets: this.buildTargets(),
      radar: this.buildRadar(),
      warnings: activeWarnings,
      comms: this.comms.slice(-6),
      wingman: this.buildWingmanHud(),
      boss,
      maneuver: this.buildManeuverHud(),
      assist: this.buildAssistHud(),
      tutorial: buildTutorialState(
        this.tutorialFlags,
        this.tutorialDismissed,
        this.phase === 'dogfight' || this.phase === 'boss-intro' || this.phase === 'boss',
      ),
      combat: this.buildCombatFeedback(),
      wave: this.buildWaveHud(),
      auto: this.buildAutoPilotHud(),
      mission: {
        kills: this.kills,
        requiredKills: this.scenario.requiredKills,
        objective: objective.objective,
        objectiveZh: objective.objectiveZh,
        hint: objective.hint,
        score: this.score,
        stats: {
          ...this.stats,
          elapsed: this.stats.elapsed || Math.floor(this.elapsed),
          score: this.stats.score || this.score,
        },
      },
    };
  }

  getAudioTelemetry(): AudioTelemetry {
    const missileWarning = this.entities.some(
      (entity) =>
        entity.alive &&
        entity.kind === 'missile' &&
        entity.team === 'hostile' &&
        entity.missile?.targetId === 'player',
    );
    return {
      phase: this.phase,
      paused: this.paused,
      throttle: this.flight.throttle,
      speed: this.flight.speed,
      altitude: this.flight.position.y,
      gLoad: this.flight.gLoad,
      hpRatio: this.flight.hp / this.flight.maxHp,
      lockState: this.getLockState().state,
      lockProgress: this.lockProgress,
      missileWarning,
      intensity: this.intensity,
      combo: this.comboHits.length,
      threat: this.threat,
      bossActive: Boolean(this.bossId) && !this.bossDefeated,
      elapsed: this.elapsed,
      maneuver: this.activeManeuver(),
      airbrake: this.flight.airbrake,
      assistEngaged: this.assistSolution?.engaged.length ?? 0,
    };
  }

  getEntities(): readonly SimEntity[] {
    return this.entities;
  }

  getEffects(): readonly SimEffect[] {
    return this.effects;
  }

  /**
   * v0.3 combat feedback block. Everything here carries an `age` instead of an
   * absolute clock so the HUD can animate it without knowing the mission timer,
   * and so a paused game freezes the animation.
   */
  private buildCombatFeedback(): CombatFeedback {
    return {
      hit: this.hitMarker ? { ...this.hitMarker } : null,
      incoming: this.incoming.map((hit) => ({ ...hit })),
      kills: this.killFeed.map((entry) => ({ ...entry })),
      intensity: this.intensity,
      threat: this.threat,
      combo: this.comboHits.length,
    };
  }

  /** Read the live combat atmosphere numbers without taking a full snapshot. */
  getCombatFeedback(): CombatFeedback {
    return this.buildCombatFeedback();
  }

  /**
   * Just the atmosphere scalar. The renderer reads this every frame, so it must
   * not allocate the way `getCombatFeedback` does.
   */
  getIntensity(): number {
    return this.intensity;
  }

  getFlight(): Readonly<typeof this.flight> {
    return this.flight;
  }

  getBossEntity(): SimEntity | undefined {
    return this.getEntity(this.bossId);
  }

  getTargetLabel(id: string | null): string | null {
    return this.getEntity(id)?.label ?? null;
  }

  getClockLabel(): string {
    return formatClock(this.elapsed);
  }

  /** Test/debug helper: force a boss encounter without replaying the full sortie. */
  debugTriggerBoss(): void {
    this.warpToBoss();
  }
}
