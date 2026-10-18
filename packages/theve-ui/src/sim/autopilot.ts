import { clamp } from './math';
import { checkManeuverAvailability, MANEUVERS } from './maneuvers';
import { SHOWCASE_ORDER, SHOWCASE_PLAYS, styleRating } from './enemies';
import type {
  AutoPilotMode,
  EnemyId,
  LockState,
  ManeuverId,
  MissionPhase,
  TargetKind,
  Vec3,
  WeaponId,
} from './types';

/**
 * v0.4 AUTO ACE — a full pilot model, not a cheat.
 *
 * The design rule is that the autopilot has no privileges: every frame it emits
 * the same thing a human hand would (`pitch`/`roll`/`yaw`, a throttle, a weapon
 * selection, a trigger, a manoeuvre request), and the engine feeds those into
 * exactly the same flight model, gate checks, ammo counters and score as a
 * manual sortie. Nothing is teleported, nothing is made invulnerable, and the
 * debrief it earns is the same debrief you would earn.
 *
 * On top of flying and shooting, it is a *performer*. Every manoeuvre in the
 * v0.2 set is wired to a readable situation — a cobra when a missile is chasing,
 * a kulbit when a bandit is glued to the tail, an immelmann when the fight has
 * gone vertical — and on top of that it keeps a demo reel: whenever the sky is
 * quiet it flies whatever move the audience has not seen yet. That is what makes
 * "press one key and watch the game finish itself" also worth watching.
 */

/* ------------------------------------------------------------------ */
/* the world view the engine hands over                                */
/* ------------------------------------------------------------------ */

export interface AutoPilotContact {
  id: string;
  callsign: string;
  kind: TargetKind;
  enemyId: EnemyId | null;
  position: Vec3;
  distance: number;
  /** Angle off the nose in degrees. */
  angle: number;
  /** Signed yaw error in radians: positive means pull left. */
  yawError: number;
  /** Signed pitch error in radians: positive means pull up. */
  pitchError: number;
  hp: number;
  maxHp: number;
  lockable: boolean;
  /** Higher is a more valuable kill. */
  priority: number;
  /** True when this contact is the one currently selected. */
  selected: boolean;
}

export interface AutoPilotThreat {
  id: string;
  distance: number;
  /**
   * Signed degrees off the nose: 0 dead ahead, +90 off the left wing,
   * ±180 dead astern. The sign matters — it tells the performer which way to
   * break without recomputing the geometry.
   */
  bearing: number;
  /** Seconds until impact at the current closure rate. */
  impactIn: number;
}

export interface AutoPilotWorld {
  dt: number;
  elapsed: number;
  phase: MissionPhase;
  paused: boolean;
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  rollRate: number;
  speed: number;
  altitude: number;
  gLoad: number;
  hp: number;
  maxHp: number;
  throttle: number;
  activeManeuver: ManeuverId | null;
  activeProgress: number;
  contacts: AutoPilotContact[];
  threats: AutoPilotThreat[];
  selectedId: string | null;
  lock: { state: LockState['state']; progress: number; targetId: string | null; distance: number };
  weapons: { selected: WeaponId; missiles: number; gunAmmo: number; flares: number };
  jammed: boolean;
  /** Hostiles that have not been released yet — stops it loitering when idle. */
  pendingHostiles: number;
  /** True once both shield nodes are gone and the reactor core is targetable. */
  coreExposed: boolean;
}

export interface AutoPilotCommand {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  selectTarget: string | null;
  selectWeapon: WeaponId | null;
  fireMissile: boolean;
  gun: boolean;
  flare: boolean;
  startManeuver: ManeuverId | null;
  endManeuver: ManeuverId | null;
}

/* ------------------------------------------------------------------ */
/* memory — everything the controller has to remember between frames   */
/* ------------------------------------------------------------------ */

export interface AutoPilotPlayEvent {
  maneuver: ManeuverId;
  playId: string;
  demonstration: boolean;
}

export interface AutoPilotMemory {
  mode: AutoPilotMode;
  modeTimer: number;
  demonstrated: Record<ManeuverId, boolean>;
  plays: number;
  callout: string;
  calloutCode: string;
  calloutLabelZh: string;
  calloutLabelEn: string;
  /** Drained by the engine and turned into a radio call. */
  announce: string | null;
  /** Drained by the engine and turned into a `auto-play` event. */
  playEvent: AutoPilotPlayEvent | null;
  /** The move that just ignited, so the engine can arm its own timers. */
  lastPlay: ManeuverId | null;
  maneuverCooldown: number;
  flareCooldown: number;
  missileCooldown: number;
  weaponCooldown: number;
  targetCooldown: number;
  /** Seconds the performer is committed to the current target. */
  commitUntil: number;
  /** Sustained manoeuvres the performer is currently holding. */
  hold: ManeuverId | null;
  holdTimer: number;
  /** Seconds of continuous defence, used to break out of a losing spiral. */
  defensiveTimer: number;
  /** Seconds left of the straight extension after a firing pass. */
  overshootTimer: number;
  /** Blockout before another extension is allowed. */
  extendCooldown: number;
  /** How long the nose has been stuck badly off the target. */
  orbitTimer: number;
}

export function createAutoPilotMemory(): AutoPilotMemory {
  return {
    mode: 'standby',
    modeTimer: 0,
    demonstrated: {
      highG: false,
      airbrake: false,
      cobra: false,
      barrelRoll: false,
      splitS: false,
      immelmann: false,
      kulbit: false,
    },
    plays: 0,
    callout: '',
    calloutCode: 'STBY',
    calloutLabelZh: '待命',
    calloutLabelEn: 'STANDBY',
    announce: null,
    playEvent: null,
    lastPlay: null,
    maneuverCooldown: 0,
    flareCooldown: 0,
    missileCooldown: 0,
    weaponCooldown: 0,
    targetCooldown: 0,
    commitUntil: 0,
    hold: null,
    holdTimer: 0,
    defensiveTimer: 0,
    overshootTimer: 0,
    extendCooldown: 0,
    orbitTimer: 0,
  };
}

/** Fresh memory, used on every mission restart. */
export function resetAutoPilotMemory(memory: AutoPilotMemory, keepReel = true): void {
  const fresh = createAutoPilotMemory();
  const demonstrated = keepReel ? memory.demonstrated : fresh.demonstrated;
  const plays = keepReel ? memory.plays : 0;
  Object.assign(memory, fresh, { demonstrated, plays });
}

export function autoPilotShown(memory: AutoPilotMemory): ManeuverId[] {
  return SHOWCASE_ORDER.filter((id) => memory.demonstrated[id]);
}

export function autoPilotStyle(memory: AutoPilotMemory): number {
  return styleRating(
    memory.plays,
    autoPilotShown(memory).length,
    SHOWCASE_ORDER.length,
  );
}

/* ------------------------------------------------------------------ */
/* tuning                                                              */
/* ------------------------------------------------------------------ */

/** Hardest bank the performer will command outside a scripted manoeuvre. */
const BANK_MAX = 1.3;
/** Roll loop gain: how much bank error becomes stick. */
const ROLL_GAIN = 2.6;
/** Roll-rate damping so it does not oscillate around the commanded bank. */
const ROLL_DAMP = 0.52;
/** Pitch loop gain. */
const PITCH_GAIN = 3.0;
/** Rudder is a fine-trim control on this airframe, not a turn control. */
const YAW_GAIN = 1.15;
const YAW_MAX = 0.6;
/** Altitudes the performer protects. */
const HARD_FLOOR = 1900;
const SOFT_FLOOR = 2600;
const CEILING_HOLD = 11200;
/** Below this speed the throttle goes to the wall no matter what. */
const ENERGY_FLOOR = 190;
/** Threat ranges. */
const THREAT_PANIC = 1250;
/** A missile that will arrive this soon is panic-worthy whatever the range. */
const THREAT_PANIC_SECONDS = 3;
const THREAT_AWARE = 1900;
const FLARE_RANGE = 950;
/** Quiet sky: how far the nearest bandit must be before showing off. */
const SHOWCASE_CLEARANCE = 2400;
/** Airborne fighters this close make the dreadnought the wrong target. */
const ESCORT_CLEAR_RANGE = 1400;
/** Seconds the performer stays on a target before it will re-rank again. */
const TARGET_COMMIT = 2.4;
/** How much better a new target must score before the nose is allowed to swing. */
const TARGET_SWITCH_MARGIN = 1.5;
/**
 * Inside this the performer and the bandit are inside each other's turn circles
 * and neither can win; break off and rebuild separation instead. The numbers are
 * deliberately tight: an earlier pass used 520 m / 26°, which is ordinary
 * turning-fight geometry, so the performer spent the whole engagement flying
 * straight extensions instead of fighting.
 */
const MERGE_RANGE = 260;
const MERGE_ANGLE = 35;
/**
 * The nose is this far off — and staying this far off for this long — then the
 * performer is orbiting rather than fighting, and it extends instead.
 */
const ORBIT_ANGLE = 58;
const ORBIT_PATIENCE = 1.8;
const PASS_EXTEND_TIME = 1.7;
/** Long enough that extensions cannot chain into a permanent run away. */
const PASS_EXTEND_COOLDOWN = 2.4;

/** Manoeuvres that are defensively useful, best escape first. */
const DECOY_ORDER: ManeuverId[] = ['cobra', 'kulbit', 'barrelRoll', 'splitS'];

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function zeroCommand(): AutoPilotCommand {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0.72,
    selectTarget: null,
    selectWeapon: null,
    fireMissile: false,
    gun: false,
    flare: false,
    startManeuver: null,
    endManeuver: null,
  };
}

interface Aim {
  pitch: number;
  roll: number;
  yaw: number;
  /** True when the nose is inside the gun cone. */
  onNose: boolean;
}

/**
 * Bank-to-turn steering. This airframe turns by banking — the model derives its
 * heading rate directly from `tan(roll)` — so the outer loop commands a bank
 * angle from the heading error and the inner loop drives the stick from the
 * bank error.
 *
 * Note the one term that is deliberately tiny rather than absent: the bank pull
 * below. See its own comment for why deleting it outright was worse.
 */
function aimAt(world: AutoPilotWorld, yawError: number, pitchError: number): Aim {
  const desiredRoll = clamp(yawError * 1.85, -BANK_MAX, BANK_MAX);
  let roll = (desiredRoll - world.roll) * ROLL_GAIN - world.rollRate * ROLL_DAMP;
  roll = clamp(roll, -1, 1);

  // Level out once the heading error collapses, otherwise the loop hunts.
  if (Math.abs(yawError) < 0.035 && Math.abs(world.rollRate) < 0.35) {
    roll = clamp(roll * 0.35 - world.roll * 0.9, -1, 1);
  }

  const pitch = clamp(pitchError * PITCH_GAIN + bankPull(world.roll), -1, 1);

  // Rudder only fine-tunes: it is de-authorised as the bank grows so the two
  // yaw sources never stack into an overshoot.
  const bankShare = Math.min(1, Math.abs(world.roll) / BANK_MAX);
  const yaw = clamp(yawError * YAW_GAIN, -YAW_MAX, YAW_MAX) * (1 - 0.65 * bankShare);

  return {
    pitch,
    roll,
    yaw,
    onNose: Math.abs(yawError) * 57.2958 < 4.5 && Math.abs(pitchError) * 57.2958 < 4.5,
  };
}

/**
 * A small nose-up bias in a bank, capped low.
 *
 * A real aircraft loses vertical lift in a bank and has to be pulled to hold the
 * turn, and the first version of this controller copied that reflex at full
 * strength. It was wrong twice over: here the banked turn is kinematic and free,
 * so the only thing pitch does is point the nose up, and a full-strength pull
 * drove the aircraft into a climbing spiral — the probe runs showed 25–48° of
 * average elevation error to the target. Deleted entirely it was worse still,
 * because the aircraft then refused to hold the turn at all. A cap of 0.3 keeps
 * the nose in the turn without flying the jet away from the fight.
 */
function bankPull(roll: number): number {
  const bank = clamp(roll, -1.42, 1.42);
  return clamp((1 / Math.max(Math.cos(bank), 0.35) - 1) * 0.18, 0, 0.3);
}

/**
 * Cruise controller: hold the current heading, ease the wings level and settle
 * onto a target altitude. `aimAt` with a zero heading error is exactly that,
 * because the roll loop then drives the bank to zero.
 */
function flyLevel(world: AutoPilotWorld, altitudeTarget: number): Aim {
  const climb = clamp(
    Math.atan2(altitudeTarget - world.altitude, Math.max(world.speed * 9, 600)),
    -0.5,
    0.5,
  );
  const pitchError = climb - clamp(world.pitch, -1.2, 1.2);
  return aimAt(world, 0, pitchError);
}

function terrainPitchBias(world: AutoPilotWorld): number {
  if (world.altitude < HARD_FLOOR) return 1;
  if (world.altitude < SOFT_FLOOR) {
    return clamp((SOFT_FLOOR - world.altitude) / (SOFT_FLOOR - HARD_FLOOR), 0, 1);
  }
  if (world.altitude > CEILING_HOLD) return -0.55;
  return 0;
}

function nearestThreat(world: AutoPilotWorld): AutoPilotThreat | null {
  let best: AutoPilotThreat | null = null;
  for (const threat of world.threats) {
    if (!best || threat.distance < best.distance) best = threat;
  }
  return best;
}

/**
 * How valuable a contact is right now.
 *
 * The `escortsUp` term is the single most important line in this file. Strafing
 * a dreadnought is a slow, straight, predictable pass, and doing it while armed
 * bandits orbit inside gun range is how the sortie ends: the probe runs showed
 * the performer pinned on the reactor core with three drones and two escorts
 * sawing at it from 300 m, out of missiles and unable to finish. Doctrine is
 * "clear the escorts, then make your attack run", and it applies to a machine
 * exactly as well as it applies to a pilot.
 *
 * Two range bonuses then encode "kill what is killing you": a bandit already
 * inside gun range outranks a more valuable target further out.
 */
function contactScore(
  contact: AutoPilotContact,
  hurt: boolean,
  escortsUp: boolean,
  coreExposed: boolean,
): number {
  // Once the core is open there is no more escort work to do: the sortie ends
  // with that reactor, and every second spent chasing a drone is a second the
  // dreadnought spends shooting back.
  const priority =
    contact.kind === 'weakpoint'
      ? coreExposed
        ? 4.2
        : escortsUp
          ? 0.9
          : 3.4
      : contact.priority;
  return (
    priority * 2.4 -
    contact.distance / 850 -
    contact.angle / 32 +
    (contact.selected ? 0.45 : 0) +
    (contact.distance < 1300 ? 1.6 : 0) +
    (contact.distance < 850 ? 1.4 : 0) +
    (hurt && contact.distance < 850 ? 1.2 : 0)
  );
}

/**
 * Pick a victim — with hysteresis.
 *
 * The naive version of this function re-ranked every contact every frame, which
 * looked fine in isolation and was catastrophic in practice: the nose would
 * swing from a shield node to a drone to a jammer, and because selecting a new
 * target resets `lockProgress`, the performer spent the entire boss fight at
 * zero lock and never fired a missile. Commitment plus a score margin is what
 * turns a twitchy selector into a pilot that actually finishes a firing pass.
 */
function chooseContact(world: AutoPilotWorld, memory: AutoPilotMemory): AutoPilotContact | null {
  const hurt = world.maxHp > 0 && world.hp / world.maxHp < 0.4;
  const escortsUp = world.contacts.some(
    (contact) => contact.kind === 'fighter' && contact.distance < ESCORT_CLEAR_RANGE,
  );
  let best: AutoPilotContact | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let current: AutoPilotContact | null = null;
  let currentScore = Number.NEGATIVE_INFINITY;

  for (const contact of world.contacts) {
    if (!contact.lockable) continue;
    const score = contactScore(contact, hurt, escortsUp, world.coreExposed);
    if (score > bestScore) {
      bestScore = score;
      best = contact;
    }
    if (contact.selected) {
      current = contact;
      currentScore = score;
    }
  }

  if (!best) return null;
  if (!current) return best;
  // Finish what you started. An earlier version let a close bandit on the tail
  // interrupt the commitment, which read as tactically clever and behaved as
  // pure churn: every interruption resets the lock, so the performer spent the
  // fight re-acquiring instead of shooting. Rear-hemisphere threats are handled
  // by the manoeuvre layer, which is what reversals are for.
  if (memory.commitUntil > 0) return current;
  if (best.id !== current.id && bestScore < currentScore + TARGET_SWITCH_MARGIN) return current;
  return best;
}

/** Can this move be flown right now without the flight computer refusing? */
function moveLegal(world: AutoPilotWorld, id: ManeuverId): boolean {
  const gate = checkManeuverAvailability(id, {
    speed: world.speed,
    altitude: world.altitude,
    activeManeuver: world.activeManeuver,
  });
  return gate.available;
}

/** Ignite a scripted move and stamp the performer's bookkeeping. */
function play(
  memory: AutoPilotMemory,
  world: AutoPilotWorld,
  id: ManeuverId,
  demonstration: boolean,
  command: AutoPilotCommand,
): boolean {
  if (world.activeManeuver === id) return false;
  if (!moveLegal(world, id)) return false;
  const script = SHOWCASE_PLAYS[id];
  command.startManeuver = id;
  memory.demonstrated[id] = true;
  memory.plays += 1;
  memory.lastPlay = id;
  memory.playEvent = { maneuver: id, playId: script.id, demonstration };
  memory.announce = script.callout;
  memory.callout = script.labelZh;
  memory.calloutCode = MANEUVERS[id].code;
  memory.calloutLabelZh = script.labelZh;
  memory.calloutLabelEn = script.labelEn;
  // Scripted moves block the airframe for their whole duration, so the gap
  // afterwards is what decides whether the performer is a pilot or an aerobatic
  // display. `tacticalGap` gives the aim loop room to actually shoot.
  memory.maneuverCooldown =
    MANEUVERS[id].kind === 'scripted' ? MANEUVERS[id].duration + 3.2 : 0.5;
  return true;
}

/** Hold a sustained move (high-G turn, airbrake) for `seconds`. */
function sustain(
  memory: AutoPilotMemory,
  world: AutoPilotWorld,
  id: ManeuverId,
  seconds: number,
  command: AutoPilotCommand,
): void {
  if (!moveLegal(world, id)) return;
  if (memory.hold !== id) {
    if (world.activeManeuver === id) {
      memory.hold = id;
      memory.holdTimer = seconds;
      return;
    }
    command.startManeuver = id;
    memory.hold = id;
    memory.holdTimer = seconds;
    // Sustained moves are control inputs rather than set pieces, so they count
    // towards the demonstration reel but never inflate the "plays" tally —
    // otherwise toggling the high-G turn reads as a hundred manoeuvres.
    if (!memory.demonstrated[id]) {
      const script = SHOWCASE_PLAYS[id];
      memory.demonstrated[id] = true;
      memory.playEvent = { maneuver: id, playId: script.id, demonstration: false };
    }
    memory.callout = SHOWCASE_PLAYS[id].labelZh;
    memory.calloutCode = MANEUVERS[id].code;
    memory.calloutLabelZh = SHOWCASE_PLAYS[id].labelZh;
    memory.calloutLabelEn = SHOWCASE_PLAYS[id].labelEn;
  }
  memory.holdTimer = Math.max(memory.holdTimer, seconds);
}

function releaseHold(memory: AutoPilotMemory, command: AutoPilotCommand): void {
  if (!memory.hold) return;
  command.endManeuver = memory.hold;
  if (memory.lastPlay === memory.hold) memory.lastPlay = null;
  memory.hold = null;
  memory.holdTimer = 0;
}

/* ------------------------------------------------------------------ */
/* the controller                                                      */
/* ------------------------------------------------------------------ */

/**
 * One frame of the performer. Mutates `memory` (cooldowns, demo reel, callouts)
 * and returns the stick / throttle / trigger it wants the engine to apply.
 */
export function solveAutoPilot(
  world: AutoPilotWorld,
  memory: AutoPilotMemory,
  options: { retryIn?: number | null } = {},
): AutoPilotCommand {
  const command = zeroCommand();
  const dt = Math.max(0, Math.min(world.dt, 0.1));

  memory.modeTimer += dt;
  memory.maneuverCooldown = Math.max(0, memory.maneuverCooldown - dt);
  memory.flareCooldown = Math.max(0, memory.flareCooldown - dt);
  memory.missileCooldown = Math.max(0, memory.missileCooldown - dt);
  memory.weaponCooldown = Math.max(0, memory.weaponCooldown - dt);
  memory.targetCooldown = Math.max(0, memory.targetCooldown - dt);
  memory.commitUntil = Math.max(0, memory.commitUntil - dt);
  memory.holdTimer = Math.max(0, memory.holdTimer - dt);
  memory.overshootTimer = Math.max(0, memory.overshootTimer - dt);
  memory.extendCooldown = Math.max(0, memory.extendCooldown - dt);

  /* --- 0. terminal states ------------------------------------------- */
  if (world.phase === 'complete') {
    setMode(memory, 'complete');
    memory.callout = '任务完成';
    memory.calloutCode = 'DONE';
    memory.calloutLabelZh = '任务完成';
    memory.calloutLabelEn = 'MISSION COMPLETE';
    releaseHold(memory, command);
    return command;
  }
  if (world.phase === 'failed' || options.retryIn != null) {
    setMode(memory, 'recover');
    memory.calloutCode = 'RTB';
    memory.calloutLabelZh = '跳伞重来';
    memory.calloutLabelEn = 'EJECT / RETRY';
    releaseHold(memory, command);
    // Fly the wreckage level so the shot stays readable while it respawns.
    command.throttle = 0;
    return command;
  }
  if (world.phase === 'idle' || world.phase === 'boot') {
    setMode(memory, 'standby');
    memory.calloutCode = 'STBY';
    memory.calloutLabelZh = world.phase === 'boot' ? '航电自检' : '待命';
    memory.calloutLabelEn = world.phase === 'boot' ? 'BOOTING' : 'STANDBY';
    releaseHold(memory, command);
    return command;
  }

  /* --- 1. situational picture --------------------------------------- */
  const threat = nearestThreat(world);
  const contact = chooseContact(world, memory);
  const threatened = Boolean(threat && threat.distance < THREAT_AWARE);
  // Distance alone is the wrong test, and so is time-to-impact on its own: a
  // missile still 2 km out but closing head-on is beaten by a nudge, while the
  // same missile 2 km astern is a genuine emergency. Only a threat in the rear
  // hemisphere gets the time-to-impact promotion.
  const urgent = Boolean(
    threat &&
      (threat.distance < THREAT_PANIC ||
        (threat.impactIn < THREAT_PANIC_SECONDS && Math.abs(threat.bearing) > 75)),
  );

  /* --- 2. thing one: stay alive -------------------------------------- */
  let defending = false;
  if (threat && urgent) {
    defending = true;
    memory.defensiveTimer += dt;

    // Flares first. They are instant and they cost the airframe none of its
    // offensive tempo, which a two-second supermanoeuvre very much does.
    if (world.weapons.flares > 0 && memory.flareCooldown <= 0) {
      command.flare = true;
      memory.flareCooldown = 1.2;
    }

    // A decoy manoeuvre is the expensive answer, so it is reserved for the
    // cases the flare cannot cover: none left, or the missile is already
    // seconds from the airframe. An earlier version spent every inbound
    // missile on a cobra and never got a shot away after the dreadnought
    // arrived.
    const desperate = world.weapons.flares <= 0 || (threat?.impactIn ?? 9) < 1.5;
    if (desperate && memory.maneuverCooldown <= 0 && !world.activeManeuver) {
      for (const id of DECOY_ORDER) {
        if (!moveLegal(world, id)) continue;
        if (play(memory, world, id, false, command)) {
          // Hold the airframe clear for a beat so decoys cannot chain into a
          // permanent evasive loop with no offence in between.
          memory.maneuverCooldown = MANEUVERS[id].duration + 1.6;
          setMode(memory, 'defend');
          break;
        }
      }
    }
  } else {
    memory.defensiveTimer = Math.max(0, memory.defensiveTimer - dt * 0.5);
  }

  // Even outside panic range, an inbound missile is worth a flare.
  if (
    !command.flare &&
    threat &&
    threat.distance < FLARE_RANGE &&
    world.weapons.flares > 0 &&
    memory.flareCooldown <= 0
  ) {
    command.flare = true;
    memory.flareCooldown = 1.2;
    defending = true;
  }

  /* --- 3. pick a victim ---------------------------------------------- */
  if (contact && memory.targetCooldown <= 0 && !contact.selected) {
    command.selectTarget = contact.id;
    memory.targetCooldown = 0.75;
    memory.commitUntil = TARGET_COMMIT;
  }

  /* --- 4. fly the jet ------------------------------------------------- */
  // Three ways a pass ends, and all of them want the same answer.
  //
  // "Merge" is the dangerous one. This airframe turns at roughly 0.35 rad/s at
  // combat speed, so a bandit inside ~450 m crosses the nose faster than the
  // wing can follow; the performer and the bandit end up inside each other's
  // turn circles at a hundred metres, where no gun solution exists and neither
  // can disengage.
  //
  // "Orbit" is the subtle one, and it is the failure that took the longest to
  // find. Pure pursuit against a target with a similar turn rate has a *stable
  // limit cycle*: the aircraft banks hard, turns at its maximum rate, and the
  // line of sight rotates at exactly the same rate — so the target sits
  // permanently ninety degrees off the nose, the lock never builds, and the
  // aircraft circles a dreadnought until it is shot down. The probe runs caught
  // it averaging 90° of heading error with 4° of elevation error, which is the
  // signature of a level circle rather than a fight.
  //
  // The cure for both is the same, and it is what a pilot does: extend, rebuild
  // separation, and make a fresh straight attack run.
  const merged = contact !== null && contact.distance < MERGE_RANGE && contact.angle > MERGE_ANGLE;
  if (contact && contact.angle > ORBIT_ANGLE) memory.orbitTimer += dt;
  else memory.orbitTimer = 0;
  const orbiting = memory.orbitTimer > ORBIT_PATIENCE;
  if ((merged || orbiting) && memory.overshootTimer <= 0 && memory.extendCooldown <= 0) {
    memory.overshootTimer = PASS_EXTEND_TIME;
    memory.extendCooldown = PASS_EXTEND_TIME + PASS_EXTEND_COOLDOWN;
    memory.orbitTimer = 0;
  }

  const beaming = Boolean(threat && urgent && Math.abs(threat.bearing) < 55);
  let aim: Aim;
  if (memory.overshootTimer > 0 && contact && !beaming) {
    // Wings level, nose on the horizon, firewall — a clean extension.
    aim = flyLevel(world, clamp(world.altitude, SOFT_FLOOR + 200, 9000));
  } else if (contact && !beaming) {
    aim = aimAt(world, contact.yawError, contact.pitchError);
    // Never let a shot priority fly it into the ground.
    const bias = terrainPitchBias(world);
    if (bias !== 0) aim = { ...aim, pitch: clamp(aim.pitch + bias, -1, 1) };
  } else {
    const cruise = clamp(world.altitude, SOFT_FLOOR + 200, 9000);
    aim = flyLevel(world, cruise);
    if (beaming && threat) {
      // Turn away from the side the missile is on; dead astern, break left.
      const away = threat.bearing >= 0 ? -1 : 1;
      const energy = threat.distance < 700 ? 1.45 : 1.2;
      aim = aimAt(world, away * energy, 0.18);
    }
  }
  command.pitch = aim.pitch;
  command.roll = aim.roll;
  command.yaw = aim.yaw;

  /* --- 5. the demo reel ---------------------------------------------- */
  // Only when nobody is shooting, the airframe has the energy to spare and
  // there is nothing better to do with the time.
  const hurt = world.maxHp > 0 && world.hp / world.maxHp < 0.4;
  const quiet =
    !threatened && !hurt && (!contact || contact.distance > SHOWCASE_CLEARANCE);
  const showcaseMove = SHOWCASE_ORDER.find((id) => !memory.demonstrated[id]) ?? null;
  if (showcaseMove && quiet && memory.maneuverCooldown <= 0 && !world.activeManeuver) {
    const script = MANEUVERS[showcaseMove];
    const altitudeGate = Math.max(script.minAltitude, 1200) + 700;
    if (world.speed > script.minSpeed + 20 && world.altitude > altitudeGate) {
      if (play(memory, world, showcaseMove, true, command)) {
        setMode(memory, 'showcase');
        const follow = aimAt(world, contact?.yawError ?? 0, contact?.pitchError ?? 0);
        command.pitch = follow.pitch;
        command.roll = follow.roll;
        command.yaw = follow.yaw;
      }
    }
  }

  /* --- 6. tactical manoeuvres ---------------------------------------- */
  // Reversal manoeuvres are an air-to-air vocabulary, and they are a *last
  // resort* within it. A scripted profile takes the airframe off the aim loop
  // for one to three seconds and flies the nose wherever the profile says, so
  // an autopilot that reaches for one whenever the target drifts off-axis
  // spends the whole fight doing aerobatics at nothing: the probe runs caught
  // it averaging eighty degrees of heading error with a full missile rail.
  //
  // So the triggers are narrow (the bandit really is behind us), the cooldowns
  // are long (nothing chains), and the answer to an ordinary turning fight is
  // the aim loop — which tracks to within a couple of degrees.
  //
  // Against the dreadnought's shield nodes the answer is a gunnery pass
  // followed by an extension, never a reversal.
  const dogfight = contact?.kind === 'fighter';
  if (!command.startManeuver && !world.activeManeuver && contact && dogfight) {
    const angle = contact.angle;
    // A hurt airframe breaks earlier and harder.
    const breakAt = hurt ? 900 : 720;
    const behind = angle > (hurt ? 118 : 132);
    const close = contact.distance < breakAt;
    const closing = contact.distance < breakAt + 400;

    // Kulbit: a bandit glued to the tail inside knife range. The signature move.
    if (
      behind &&
      close &&
      memory.maneuverCooldown <= 0 &&
      moveLegal(world, 'kulbit') &&
      world.altitude > 2600
    ) {
      if (play(memory, world, 'kulbit', false, command)) setMode(memory, 'defend');
    }
    // Immelmann: the fight has gone vertical, the bandit is above and astern,
    // and there is airspeed in hand to trade for the reversal.
    else if (
      angle > 118 &&
      contact.pitchError > 0.35 &&
      world.speed > 232 &&
      memory.maneuverCooldown <= 0 &&
      moveLegal(world, 'immelmann')
    ) {
      if (play(memory, world, 'immelmann', false, command)) setMode(memory, 'engage');
    }
    // Split-S: he dove, we follow — and bank the altitude into airspeed.
    else if (
      angle > 118 &&
      contact.pitchError < -0.3 &&
      world.speed > 224 &&
      memory.maneuverCooldown <= 0 &&
      moveLegal(world, 'splitS') &&
      world.altitude > 4200
    ) {
      if (play(memory, world, 'splitS', false, command)) setMode(memory, 'engage');
    }
    // Airbrake bait: force the overshoot before he gets a shot.
    else if (
      angle > 140 &&
      closing &&
      world.speed > 246 &&
      memory.maneuverCooldown <= 0 &&
      moveLegal(world, 'airbrake')
    ) {
      sustain(memory, world, 'airbrake', 0.8, command);
      setMode(memory, 'defend');
    }
    // High-G: anything else needs a tighter turn than MIL power allows. This
    // one is sustained, so it stays on the aim loop and only sharpens it.
    else if (
      angle > 40 &&
      angle < 118 &&
      world.speed > 178 &&
      memory.maneuverCooldown <= 0
    ) {
      sustain(memory, world, 'highG', 0.5, command);
      if (!defending) setMode(memory, 'engage');
    }
  }

  // Let go of sustained manoeuvres once the reason is gone.
  if (memory.hold && memory.holdTimer <= 0) releaseHold(memory, command);
  if (memory.hold === 'airbrake' && world.speed < 200) releaseHold(memory, command);
  if (memory.hold === 'highG' && (!contact || contact.angle < 26)) {
    releaseHold(memory, command);
  }

  /* --- 7. energy management ------------------------------------------ */
  let want: number;
  if (defending) {
    want = 1;
  } else if (!contact) {
    want = 0.84;
  } else if (contact.distance > 2600) {
    want = 1;
  } else if (contact.distance > 1500) {
    want = 0.88;
  } else if (contact.distance > 800) {
    want = 0.74;
  } else {
    want = 0.62;
  }
  if (world.altitude < SOFT_FLOOR) want = Math.max(want, 1);
  if (world.speed < ENERGY_FLOOR) want = 1;
  if (memory.hold === 'airbrake') want = Math.min(want, 0.42);
  command.throttle = clamp(world.throttle + (want - world.throttle) * 3.4 * dt, 0.2, 1);
  if (world.speed < ENERGY_FLOOR) command.throttle = 1;

  /* --- 8. weapons ----------------------------------------------------- */
  // Gun tolerance sits just inside what `findGunTarget` accepts, so the burst
  // lands without the performer wasting the barrel on near misses.
  if (contact && contact.distance < 1900 && contact.angle < 6.6 && world.weapons.gunAmmo > 0) {
    if (world.weapons.selected !== 'gun' && memory.weaponCooldown <= 0) {
      command.selectWeapon = 'gun';
      memory.weaponCooldown = 0.4;
    }
    command.gun = true;
  } else if (world.weapons.missiles > 0 && world.weapons.selected !== 'aam' && memory.weaponCooldown <= 0) {
    command.selectWeapon = 'aam';
    memory.weaponCooldown = 0.4;
  }

  const locked = world.lock.state === 'locked' && Boolean(world.lock.targetId);
  if (locked && world.weapons.missiles > 0 && memory.missileCooldown <= 0 && contact) {
    const range = world.lock.distance || contact.distance;
    if (range > 620 && range < 3400) {
      command.fireMissile = true;
      memory.missileCooldown = 0.6;
    }
  }

  /* --- 9. mode label -------------------------------------------------- */
  // Priority: survival, then the show, then the fight, then getting there.
  if (defending) setMode(memory, 'defend');
  else if (memory.mode === 'showcase' && memory.modeTimer < 2.4) {
    /* stay in SHOW while the move plays out */
  } else if (!contact) setMode(memory, 'transit');
  else setMode(memory, 'engage');

  return command;
}

function setMode(memory: AutoPilotMemory, mode: AutoPilotMode): void {
  if (memory.mode === mode) return;
  memory.mode = mode;
  memory.modeTimer = 0;
}

/* ------------------------------------------------------------------ */
/* readouts                                                            */
/* ------------------------------------------------------------------ */

export const AUTO_MODE_LABEL: Record<AutoPilotMode, { code: string; zh: string; en: string }> = {
  standby: { code: 'STBY', zh: '待命', en: 'STANDBY' },
  transit: { code: 'NAV', zh: '占位机动', en: 'POSITIONING' },
  engage: { code: 'ATK', zh: '交战', en: 'ENGAGING' },
  defend: { code: 'EVD', zh: '规避', en: 'EVADING' },
  showcase: { code: 'SHOW', zh: '机动展示', en: 'SHOWCASE' },
  recover: { code: 'RTB', zh: '跳伞重来', en: 'RETRY' },
  complete: { code: 'DONE', zh: '任务完成', en: 'COMPLETE' },
};

/** 0..1 self-assessment, shown on the auto-pilot rail. */
export function autoPilotCondition(world: {
  hp: number;
  maxHp: number;
  missiles: number;
  gunAmmo: number;
  threats: number;
}): number {
  const hull = world.maxHp > 0 ? clamp(world.hp / world.maxHp, 0, 1) : 0;
  const ammo = clamp(world.missiles / 4, 0, 1) * 0.6 + clamp(world.gunAmmo / 450, 0, 1) * 0.4;
  const pressure = clamp(1 - world.threats / 3, 0, 1);
  return clamp(hull * 0.55 + ammo * 0.25 + pressure * 0.2, 0, 1);
}
