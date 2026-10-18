import type { BossAttackId, BossAttackPhase, ManeuverId, Vec3 } from './types';

export type { BossAttackId, BossAttackPhase };
/**
 * v0.5 — the LEVIATHAN encounter.
 *
 * v0.4's dreadnought was a slowly drifting box with a random flak burst and a
 * drone swarm: you could park on its six, hold the trigger and win. v0.5 gives
 * it a body you can hit and cannot fly through, a compound collision volume
 * that actually matches the silhouette, and four attacks that each have one
 * readable answer — so the fight is a conversation about positioning instead of
 * a damage race.
 *
 * This module is deliberately pure: the geometry, the attack book and the
 * telegraph maths live here so the engine, the three.js layer, the HUD and the
 * tests all read the same numbers.
 */

/* ------------------------------------------------------------------ */
/* collision volume                                                    */
/* ------------------------------------------------------------------ */

/**
 * One axis-aligned box of the dreadnought's compound collider, in the boss's
 * own frame: +X starboard, +Y up, −Z forward (the bow is at negative Z, which
 * is also the direction the three.js model faces).
 */
export interface BossHullBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** Human-readable part name, for the impact callout. */
  part: string;
}

/**
 * The compound body. It is intentionally *not* one giant box: the reactor maw
 * between the bow jaws and the gap between the wing and the outrigger pods are
 * real holes a good pilot can thread, and a single AABB would make the whole
 * ship — including its own weak points — unreachable.
 */
export const BOSS_HULL: BossHullBox[] = [
  // Central keel: the long armoured spine.
  { x: 0, y: 0, z: -30, hx: 78, hy: 46, hz: 268, part: 'KEEL' },
  // Dorsal superstructure and the flight deck behind it.
  { x: 0, y: 74, z: 30, hx: 62, hy: 42, hz: 190, part: 'DECK' },
  // Main wing: wide, thin, swept.
  { x: 0, y: -6, z: 60, hx: 396, hy: 15, hz: 152, part: 'WING' },
  // Outer wing panels, thinner still, so the tips are hard to clip.
  { x: -312, y: -4, z: 128, hx: 118, hy: 9, hz: 84, part: 'WING' },
  { x: 312, y: -4, z: 128, hx: 118, hy: 9, hz: 84, part: 'WING' },
  // Bow jaws: two prongs with the reactor maw between them.
  { x: -74, y: 2, z: -318, hx: 26, hy: 34, hz: 76, part: 'BOW' },
  { x: 74, y: 2, z: -318, hx: 26, hy: 34, hz: 76, part: 'BOW' },
  // Stern block and the engine housing.
  { x: 0, y: 4, z: 232, hx: 150, hy: 40, hz: 96, part: 'STERN' },
  // Outrigger pylons that carry the shield nodes.
  { x: -430, y: 40, z: -30, hx: 60, hy: 20, hz: 26, part: 'PYLON' },
  { x: 430, y: 40, z: -30, hx: 60, hy: 20, hz: 26, part: 'PYLON' },
];

/** Overall bounding radius, used by the HUD and the radar. */
export const BOSS_HULL_RADIUS = 560;

/**
 * Where the shield nodes and the reactor sit, in the boss frame. The three.js
 * model is built around these anchors, so the visual and the sim can never
 * drift apart: change a number here and the model moves with it.
 */
export const BOSS_ANCHOR: Record<'shieldL' | 'shieldR' | 'core', Vec3> = {
  shieldL: { x: -520, y: 60, z: -130 },
  shieldR: { x: 520, y: 60, z: -130 },
  core: { x: 0, y: -6, z: -330 },
};

/** Muzzle of the spinal lance, tucked under the bow jaws. */
export const BOSS_LANCE_MUZZLE: Vec3 = { x: 0, y: -50, z: -352 };

/** The four CIWS mounts: two under the wings, two on the deck shoulders. */
export const BOSS_TURRETS: Vec3[] = [
  { x: -306, y: -26, z: 34 },
  { x: 306, y: -26, z: 34 },
  { x: -178, y: 118, z: -52 },
  { x: 178, y: 118, z: -52 },
];

/** Vertical launch cells on the dorsal deck; a salvo uses them in order. */
export const BOSS_VLS: Vec3[] = [
  { x: -44, y: 118, z: 22 },
  { x: 44, y: 118, z: 22 },
  { x: -44, y: 118, z: 116 },
  { x: 44, y: 118, z: 116 },
  { x: -44, y: 118, z: 210 },
  { x: 44, y: 118, z: 210 },
];

/** Anchor in the boss's own frame → world point. */
export function bossAnchor(pose: BossPose, anchor: Vec3): Vec3 {
  return fromBossLocal(pose, anchor);
}

export interface BossPose {
  position: Vec3;
  yaw: number;
  /** Small hover/bank angles; kept so the collider follows the model exactly. */
  pitch?: number;
  roll?: number;
}

/** World point → boss local frame. */
export function toBossLocal(pose: BossPose, point: Vec3): Vec3 {
  const dx = point.x - pose.position.x;
  const dy = point.y - pose.position.y;
  const dz = point.z - pose.position.z;
  const cy = Math.cos(-pose.yaw);
  const sy = Math.sin(-pose.yaw);
  // Yaw about +Y, then the small pitch/roll trim.
  let x = dx * cy - dz * sy;
  let z = dx * sy + dz * cy;
  let y = dy;
  const roll = pose.roll ?? 0;
  if (roll !== 0) {
    const cr = Math.cos(-roll);
    const sr = Math.sin(-roll);
    const nx = x * cr - y * sr;
    const ny = x * sr + y * cr;
    x = nx;
    y = ny;
  }
  const pitch = pose.pitch ?? 0;
  if (pitch !== 0) {
    const cp = Math.cos(-pitch);
    const sp = Math.sin(-pitch);
    const ny = y * cp - z * sp;
    const nz = y * sp + z * cp;
    y = ny;
    z = nz;
  }
  return { x, y, z };
}

/** Boss local frame → world point. */
export function fromBossLocal(pose: BossPose, local: Vec3): Vec3 {
  let { x, y, z } = local;
  const pitch = pose.pitch ?? 0;
  if (pitch !== 0) {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const ny = y * cp - z * sp;
    const nz = y * sp + z * cp;
    y = ny;
    z = nz;
  }
  const roll = pose.roll ?? 0;
  if (roll !== 0) {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const nx = x * cr - y * sr;
    const ny = x * sr + y * cr;
    x = nx;
    y = ny;
  }
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  return {
    x: pose.position.x + x * cy - z * sy,
    y: pose.position.y + y,
    z: pose.position.z + x * sy + z * cy,
  };
}

export interface BossHullHit {
  part: string;
  /** 0..1 along the segment. */
  t: number;
  point: Vec3;
}

/**
 * Minimal push-out from the compound body, used when the player flies into the
 * dreadnought. Returns the correction that lifts the point clear of the hull
 * plus the part it scraped, or null when the point is already outside.
 *
 * The body is a *compound*: the keel and the deck overlap, so a single
 * minimum-translation step can hand the player straight from one box into the
 * next. The resolution therefore iterates — each pass escapes the box it is
 * deepest in, and the loop stops as soon as the point is outside everything.
 */
export function bossHullPushOut(
  pose: BossPose,
  point: Vec3,
  margin = 6,
): { part: string; correction: Vec3 } | null {
  const first = toBossLocal(pose, point);
  if (!boxHit(first)) return null;

  const local = { ...first };
  let deepest = 'HULL';
  let depth = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    const step = escapeStep(local, pass === 0 ? margin : 1);
    if (!step) break;
    if (pass === 0 || step.depth > depth) {
      deepest = step.part;
      depth = step.depth;
    }
    local.x += step.dx;
    local.y += step.dy;
    local.z += step.dz;
  }

  // The correction is a *rotation* of the local displacement, not a world
  // vector: building it from the rotated local points keeps the boss's own
  // position out of the arithmetic. Subtracting the world point instead would
  // fold the dreadnought's altitude into the push and drive the player into the
  // ground — which is exactly the bug the soak run in `tests/boss.test.ts` now
  // guards against.
  const frame: BossPose = {
    position: { x: 0, y: 0, z: 0 },
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
  };
  const before = fromBossLocal(frame, first);
  const after = fromBossLocal(frame, local);
  return {
    part: deepest,
    correction: { x: after.x - before.x, y: after.y - before.y, z: after.z - before.z },
  };
}

function boxHit(local: Vec3): boolean {
  for (const box of BOSS_HULL) {
    if (
      Math.abs(local.x - box.x) <= box.hx &&
      Math.abs(local.y - box.y) <= box.hy &&
      Math.abs(local.z - box.z) <= box.hz
    ) {
      return true;
    }
  }
  return false;
}

/**
 * One step out of the body.
 *
 * A single minimum-translation push per box is not enough on a compound hull:
 * a point sitting between the keel and the deck is *below* the deck's centre,
 * so its closest deck face is the underside and the naive step drives it down
 * into the keel — then the keel pushes it back up, and the player rattles around
 * inside the dreadnought. So every face of every box the point is inside is
 * tested as a candidate exit, and the smallest one that is clear of the *whole*
 * body wins. If none of them clears it in one move, the smallest penetration
 * still makes progress and the caller iterates.
 */
function escapeStep(
  local: Vec3,
  margin: number,
): { part: string; depth: number; dx: number; dy: number; dz: number } | null {
  let clear: { part: string; depth: number; distance: number; dx: number; dy: number; dz: number } | null = null;
  let partial: { part: string; depth: number; dx: number; dy: number; dz: number } | null = null;

  for (const box of BOSS_HULL) {
    const dx = local.x - box.x;
    const dy = local.y - box.y;
    const dz = local.z - box.z;
    const ox = box.hx - Math.abs(dx);
    const oy = box.hy - Math.abs(dy);
    const oz = box.hz - Math.abs(dz);
    if (ox <= 0 || oy <= 0 || oz <= 0) continue;

    const faces: Array<[number, number, number]> = [
      [(dx >= 0 ? 1 : -1) * (ox + margin), 0, 0],
      [0, (dy >= 0 ? 1 : -1) * (oy + margin), 0],
      [0, 0, (dz >= 0 ? 1 : -1) * (oz + margin)],
    ];
    const penetration = Math.min(ox, oy, oz);
    if (!partial || penetration < partial.depth) {
      const face = faces.find(
        (candidate) => Math.min(ox, oy, oz) === ox
          ? candidate[0] !== 0
          : Math.min(ox, oy, oz) === oy
            ? candidate[1] !== 0
            : candidate[2] !== 0,
      )!;
      partial = { part: box.part, depth: penetration, dx: face[0], dy: face[1], dz: face[2] };
    }

    for (const [fx, fy, fz] of faces) {
      const candidate = { x: local.x + fx, y: local.y + fy, z: local.z + fz };
      if (boxHit(candidate)) continue;
      const distance = Math.abs(fx) + Math.abs(fy) + Math.abs(fz);
      if (!clear || distance < clear.distance) {
        clear = { part: box.part, depth: penetration, distance, dx: fx, dy: fy, dz: fz };
      }
    }
  }

  return clear ?? partial;
}

/**
 * What the three.js layer needs to animate the dreadnought: which part is
 * glowing, how charged the lance is, how far the shield shockwave has expanded.
 */
export interface BossVisualState {
  active: boolean;
  alive: boolean;
  stage: 1 | 2 | 3;
  shieldsUp: boolean;
  coreExposed: boolean;
  attackId: BossAttackId | null;
  phase: BossAttackPhase;
  /** 0..1 charge readout for the lance and the shield pulse. */
  charge: number;
  /** 0..1 shield shockwave expansion, 0 when idle. */
  pulse: number;
  /** 0..1 turret activity, drives the muzzle flashes. */
  turretHeat: number;
  /** World-space axis the lance is charging or firing along. */
  lanceAxis: Vec3 | null;
}

export const BOSS_VISUAL_IDLE: BossVisualState = {
  active: false,
  alive: false,
  stage: 1,
  shieldsUp: true,
  coreExposed: false,
  attackId: null,
  phase: 'idle',
  charge: 0,
  pulse: 0,
  turretHeat: 0,
  lanceAxis: null,
};

/**
 * Slab test against the compound body. `padding` inflates every box, which the
 * renderer uses to keep near misses visually honest and the sim uses to give
 * the player a small grace margin at 250 m/s.
 */
export function bossHitTest(pose: BossPose, point: Vec3, padding = 0): string | null {
  const local = toBossLocal(pose, point);
  for (const box of BOSS_HULL) {
    if (
      Math.abs(local.x - box.x) <= box.hx + padding &&
      Math.abs(local.y - box.y) <= box.hy + padding &&
      Math.abs(local.z - box.z) <= box.hz + padding
    ) {
      return box.part;
    }
  }
  return null;
}

/**
 * Swept test: does the segment `from → to` enter the hull? Returns the first
 * intersection so the caller can detonate a missile or a gun round exactly on
 * the armour instead of behind it.
 */
export function bossSegmentHit(pose: BossPose, from: Vec3, to: Vec3, padding = 0): BossHullHit | null {
  const start = toBossLocal(pose, from);
  const end = toBossLocal(pose, to);
  const dir = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  let bestT = Number.POSITIVE_INFINITY;
  let bestPart: string | null = null;

  for (const box of BOSS_HULL) {
    let tMin = 0;
    let tMax = 1;
    let hit = true;
    const axes: Array<[number, number, number, number]> = [
      [start.x, dir.x, box.x, box.hx + padding],
      [start.y, dir.y, box.y, box.hy + padding],
      [start.z, dir.z, box.z, box.hz + padding],
    ];
    for (const [origin, delta, centre, half] of axes) {
      const min = centre - half;
      const max = centre + half;
      if (Math.abs(delta) < 1e-6) {
        if (origin < min || origin > max) {
          hit = false;
          break;
        }
        continue;
      }
      let t1 = (min - origin) / delta;
      let t2 = (max - origin) / delta;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) {
        hit = false;
        break;
      }
    }
    if (hit && tMin < bestT) {
      bestT = tMin;
      bestPart = box.part;
    }
  }

  if (bestPart === null || !Number.isFinite(bestT)) return null;
  return {
    part: bestPart,
    t: bestT,
    point: {
      x: from.x + (to.x - from.x) * bestT,
      y: from.y + (to.y - from.y) * bestT,
      z: from.z + (to.z - from.z) * bestT,
    },
  };
}

/* ------------------------------------------------------------------ */
/* attack book                                                         */
/* ------------------------------------------------------------------ */

export interface BossAttackDefinition {
  id: BossAttackId;
  code: string;
  labelEn: string;
  labelZh: string;
  /** What the player has to do, printed on the telegraph banner. */
  counterEn: string;
  counterZh: string;
  /** The manoeuvre that answers it outright, if one does. */
  counter: ManeuverId | null;
  /** Seconds of warning before the effect lands. */
  telegraph: number;
  /** Seconds the effect stays live. */
  active: number;
  /** Seconds before the same attack may be picked again. */
  cooldown: [number, number];
  /** Lowest boss stage this attack is unlocked at (3 = core exposed). */
  fromStage: 1 | 2 | 3;
  severity: 'caution' | 'warning' | 'critical';
  /** Damage a completely passive player eats. */
  damage: number;
  /** Working range band, in metres from the boss centre. */
  range: [number, number];
}

export const BOSS_ATTACKS: Record<BossAttackId, BossAttackDefinition> = {
  /**
   * Close-in weapon system. Cheap, constant, and the reason you slash at the
   * dreadnought instead of parking in front of it.
   */
  ciws: {
    id: 'ciws',
    code: 'CIWS',
    labelEn: 'CLOSE-IN GUNS',
    labelZh: '近防炮拦截',
    counterEn: 'Never fly straight at the hull — slash across it',
    counterZh: '不要正对舰体直线进入 — 侧向掠袭',
    counter: null,
    telegraph: 0.7,
    active: 3.2,
    cooldown: [5.5, 8],
    fromStage: 1,
    severity: 'warning',
    damage: 9,
    range: [0, 2600],
  },
  /**
   * Vertical launch salvo. The flare check: it arrives as four radar-guided
   * rounds, and one press of `F` (or a barrel roll) undoes all of them.
   */
  salvo: {
    id: 'salvo',
    code: 'VLS',
    labelEn: 'MISSILE SALVO',
    labelZh: '垂直发射齐射',
    counterEn: 'F — flares, or V — barrel roll',
    counterZh: 'F 释放热焰弹，或 V 做桶滚',
    counter: 'barrelRoll',
    telegraph: 1.5,
    active: 3,
    cooldown: [12, 16],
    fromStage: 1,
    severity: 'critical',
    damage: 22,
    range: [400, 4200],
  },
  /**
   * Shield discharge. Punishes loitering inside the umbrella: the longer you
   * sit close, the louder the capacitor whine gets.
   */
  pulse: {
    id: 'pulse',
    code: 'PULSE',
    labelEn: 'SHIELD DISCHARGE',
    labelZh: '护盾冲击脉冲',
    counterEn: 'Break off past 1.1 km before it fires',
    counterZh: '脱离近距 — 拉开 1.1 km 或加速脱离',
    counter: 'splitS',
    telegraph: 2.4,
    active: 0.55,
    cooldown: [8, 11],
    fromStage: 1,
    severity: 'critical',
    damage: 26,
    range: [0, 1150],
  },
  /**
   * The spinal lance. Charges in plain sight along a locked bearing, then
   * sweeps that bearing. Anything still on the axis eats 38%.
   */
  lance: {
    id: 'lance',
    code: 'LANCE',
    labelEn: 'SPINAL LANCE',
    labelZh: '主炮照射',
    counterEn: 'Leave the gun axis — barrel roll or high-G turn',
    counterZh: '横向脱离炮轴 — 桶滚或高G急转',
    counter: 'barrelRoll',
    telegraph: 3,
    active: 1.7,
    cooldown: [15, 20],
    fromStage: 3,
    severity: 'critical',
    damage: 38,
    range: [500, 5200],
  },
};

export const BOSS_ATTACK_ORDER: BossAttackId[] = ['ciws', 'salvo', 'pulse', 'lance'];

export function bossAttack(id: BossAttackId): BossAttackDefinition {
  return BOSS_ATTACKS[id];
}

/** Attacks unlocked at the boss's current stage, with their selection weight. */
export function bossAttackPool(stage: 1 | 2 | 3): BossAttackId[] {
  return BOSS_ATTACK_ORDER.filter((id) => BOSS_ATTACKS[id].fromStage <= stage);
}

/** Half-angle of the lance corridor, in degrees, at a given range. */
export const LANCE_BEAM_DEG = 4.2;

/**
 * How far off the gun axis the player is, in metres, at the moment the lance
 * fires. The beam is a moving cylinder, so this is the number that decides
 * whether the shot lands.
 */
export function lanceOffset(origin: Vec3, axis: Vec3, point: Vec3): number {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const along = dx * axis.x + dy * axis.y + dz * axis.z;
  if (along <= 0) return Number.POSITIVE_INFINITY;
  const px = dx - axis.x * along;
  const py = dy - axis.y * along;
  const pz = dz - axis.z * along;
  return Math.sqrt(px * px + py * py + pz * pz);
}

/**
 * Radius of the lance beam at a distance along the axis. It blooms as it
 * travels, so a long shot is easier to slip out of than a point-blank one.
 */
export function lanceRadius(range: number): number {
  return 26 + range * 0.02;
}

/** Whether a point is inside the beam corridor. */
export function lanceHits(origin: Vec3, axis: Vec3, point: Vec3): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const along = dx * axis.x + dy * axis.y + dz * axis.z;
  if (along <= 0 || along > 6000) return false;
  return lanceOffset(origin, axis, point) <= lanceRadius(along);
}

/* ------------------------------------------------------------------ */
/* HUD helpers                                                         */
/* ------------------------------------------------------------------ */

export const BOSS_STAGE_LABEL: Record<1 | 2 | 3, { code: string; zh: string; en: string }> = {
  1: { code: 'SHIELDED', zh: '护盾完整', en: 'SHIELD ARRAY NOMINAL' },
  2: { code: 'BREACHED', zh: '护盾破损', en: 'SHIELD ARRAY BREACHED' },
  3: { code: 'EXPOSED', zh: '核心暴露', en: 'REACTOR EXPOSED' },
};

/** Countdown copy for the telegraph banner. */
export function bossCountdown(
  attack: BossAttackDefinition,
  phase: BossAttackPhase,
  remaining: number,
): string {
  if (phase === 'telegraph') return `T-${Math.max(0, remaining).toFixed(1)}s`;
  if (phase === 'active') return attack.code;
  return 'CLEAR';
}
