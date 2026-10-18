import { clamp } from './math';
import type { ManeuverId, ManeuverKind, ManeuverStatus } from './types';

const TAU = Math.PI * 2;

/** Hermite ease used by every scripted profile so the airframe never snaps. */
function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
}

function span(t: number, from: number, to: number): number {
  if (to <= from) return t >= to ? 1 : 0;
  return clamp((t - from) / (to - from), 0, 1);
}

/**
 * A scripted manoeuvre is expressed as attitude targets rather than raw rates,
 * so every airframe lands in a predictable attitude no matter the entry state.
 * `t` is normalised time in [0, 1]; `entry` is the pitch angle at ignition.
 */
export interface ManeuverProfile {
  pitchTarget: (t: number, entry: number) => number;
  rollRate: (t: number) => number;
  yawRate: (t: number) => number;
  /** Additive speed bias in m/s applied to the throttle target. */
  speedBias: (t: number) => number;
  gTarget: (t: number) => number;
  /**
   * 0 keeps the velocity vector glued to the nose, 1 freezes it at the entry
   * direction — that is what makes a cobra look like a cobra.
   */
  velocityLock: (t: number) => number;
  /** Lower stall floor while the profile is running. */
  speedFloor: number;
}

export interface ManeuverDefinition {
  id: ManeuverId;
  kind: ManeuverKind;
  labelEn: string;
  labelZh: string;
  /** Short label for the cramped command-deck chips. */
  shortZh: string;
  code: string;
  key: string;
  keyLabel: string;
  hint: string;
  duration: number;
  minSpeed: number;
  minAltitude: number;
  /** Pitch clamp while the manoeuvre owns the airframe. */
  pitchRange: (entry: number) => [number, number];
  /** Sustained modifiers. */
  pitchAuthority: number;
  rollAuthority: number;
  turnBonus: number;
  speedBleed: number;
  gLimit: number;
  /** Chance that an incoming missile loses track when this is triggered. */
  decoyChance: number;
  profile?: ManeuverProfile;
}

const NORMAL_RANGE = (entry: number): [number, number] => [
  Math.min(entry, -1.35),
  Math.max(entry, 1.35),
];

export const MANEUVERS: Record<ManeuverId, ManeuverDefinition> = {
  highG: {
    id: 'highG',
    kind: 'sustained',
    labelEn: 'HIGH-G TURN',
    labelZh: '高G转弯',
    shortZh: '高G',
    code: 'HGT',
    key: 'KeyC',
    keyLabel: 'C',
    hint: '拉杆加力：转弯更紧，掉速更快，过载更高',
    duration: 0,
    minSpeed: 165,
    minAltitude: 0,
    pitchRange: NORMAL_RANGE,
    pitchAuthority: 1.55,
    rollAuthority: 1.3,
    turnBonus: 1.38,
    speedBleed: 28,
    gLimit: 9.8,
    decoyChance: 0,
  },
  airbrake: {
    id: 'airbrake',
    kind: 'sustained',
    labelEn: 'AIRBRAKE',
    labelZh: '减速板',
    shortZh: '减速板',
    code: 'BRK',
    key: 'KeyX',
    keyLabel: 'X',
    hint: '展开减速板：迅速掉速抢位、逼敌机冲前',
    duration: 0,
    minSpeed: 0,
    minAltitude: 0,
    pitchRange: NORMAL_RANGE,
    pitchAuthority: 1.16,
    rollAuthority: 0.88,
    turnBonus: 1.08,
    speedBleed: 132,
    gLimit: 6.4,
    decoyChance: 0,
  },
  cobra: {
    id: 'cobra',
    kind: 'scripted',
    labelEn: 'PUGACHEV COBRA',
    labelZh: '眼镜蛇机动',
    shortZh: '眼镜蛇',
    code: 'COB',
    key: 'KeyZ',
    keyLabel: 'Z',
    hint: '急速上仰 110° 后恢复：速度矢量几乎不变，可让咬尾者冲前',
    duration: 1.7,
    minSpeed: 185,
    minAltitude: 0,
    pitchRange: (entry) => [entry - 0.6, Math.max(entry + 0.2, 1.98)],
    pitchAuthority: 1,
    rollAuthority: 0.4,
    turnBonus: 1,
    speedBleed: 0,
    gLimit: 4.2,
    decoyChance: 0.7,
    profile: {
      pitchTarget: (t, entry) => {
        if (t < 0.34) return entry + 1.95 * easeInOut(t / 0.34);
        if (t < 0.6) return entry + 1.95;
        return entry + 1.95 * (1 - smoothstep((t - 0.6) / 0.4));
      },
      rollRate: () => 0,
      yawRate: () => 0,
      speedBias: (t) => (t < 0.65 ? -190 * (1 - t * 0.35) : -46 * (1 - (t - 0.65) / 0.35)),
      gTarget: (t) => (t < 0.5 ? 3.4 : 1.4),
      velocityLock: (t) => 1 - smoothstep(span(t, 0.5, 0.85)),
      speedFloor: 104,
    },
  },
  barrelRoll: {
    id: 'barrelRoll',
    kind: 'scripted',
    labelEn: 'BARREL ROLL',
    labelZh: '桶滚',
    shortZh: '桶滚',
    code: 'BRL',
    key: 'KeyV',
    keyLabel: 'V',
    hint: '螺旋滚转摆脱：破坏来袭导弹的跟踪，航向基本不变',
    duration: 1.35,
    minSpeed: 120,
    minAltitude: 0,
    pitchRange: (entry) => [entry - 0.3, entry + 0.32],
    pitchAuthority: 0.5,
    rollAuthority: 0.5,
    turnBonus: 1,
    speedBleed: 0,
    gLimit: 4.4,
    decoyChance: 0.55,
    profile: {
      pitchTarget: (t, entry) => entry + 0.11 * Math.sin(Math.PI * t),
      rollRate: () => TAU / 1.35,
      yawRate: (t) => Math.sin(TAU * t) * 0.5,
      speedBias: (t) => -38 * Math.sin(Math.PI * t),
      gTarget: (t) => 2.6 + 1.6 * Math.sin(Math.PI * t),
      velocityLock: (t) => 0.35 * Math.sin(Math.PI * t),
      speedFloor: 130,
    },
  },
  splitS: {
    id: 'splitS',
    kind: 'scripted',
    labelEn: 'SPLIT-S',
    labelZh: '破S机动',
    shortZh: '破S',
    code: 'SPL',
    key: 'KeyB',
    keyLabel: 'B',
    hint: '半滚倒转后下扣：用高度换速度，同时把航向掉转 180°',
    duration: 2.2,
    minSpeed: 150,
    minAltitude: 1200,
    pitchRange: (entry) => [entry - Math.PI - 0.3, entry + 0.35],
    pitchAuthority: 0.5,
    rollAuthority: 0.5,
    turnBonus: 1,
    speedBleed: 0,
    gLimit: 7.4,
    decoyChance: 0.3,
    profile: {
      pitchTarget: (t, entry) =>
        entry - Math.PI * smoothstep(span(t, 0.3, 0.94)),
      rollRate: (t) => (t < 0.3 ? Math.PI / (0.3 * 2.2) : 0),
      yawRate: () => 0,
      speedBias: (t) => 64 * smoothstep(span(t, 0.28, 1)),
      gTarget: (t) => 1.6 + 4.6 * Math.sin(Math.PI * span(t, 0.28, 0.96)),
      velocityLock: () => 0,
      speedFloor: 150,
    },
  },
  immelmann: {
    id: 'immelmann',
    kind: 'scripted',
    labelEn: 'IMMELMANN',
    labelZh: '殷麦曼翻转',
    shortZh: '殷麦曼',
    code: 'IMM',
    key: 'KeyN',
    keyLabel: 'N',
    hint: '半筋斗上升后半滚改平：一次把航向掉转 180° 并抢到高度',
    duration: 2.4,
    minSpeed: 205,
    minAltitude: 0,
    pitchRange: (entry) => [entry - 0.3, entry + Math.PI + 0.3],
    pitchAuthority: 0.5,
    rollAuthority: 0.5,
    turnBonus: 1,
    speedBleed: 0,
    gLimit: 8.2,
    decoyChance: 0.2,
    profile: {
      pitchTarget: (t, entry) => entry + Math.PI * easeInOut(span(t, 0, 0.68)),
      rollRate: (t) => (t < 0.68 ? 0 : Math.PI / (0.32 * 2.4)),
      yawRate: () => 0,
      speedBias: (t) => -104 * Math.sin(Math.PI * span(t, 0, 0.9)),
      gTarget: (t) => 1.8 + 5.4 * Math.sin(Math.PI * span(t, 0, 0.68)),
      velocityLock: () => 0,
      speedFloor: 150,
    },
  },
  kulbit: {
    id: 'kulbit',
    kind: 'scripted',
    labelEn: 'KULBIT',
    labelZh: '库尔比特',
    shortZh: '库尔比特',
    code: 'KUL',
    key: 'KeyK',
    keyLabel: 'K',
    hint: '超机动：以极小半径完成 360° 筋斗，代价是几乎全部动能',
    duration: 2.6,
    minSpeed: 200,
    minAltitude: 1500,
    pitchRange: (entry) => [entry - 0.45, entry + TAU + 0.45],
    pitchAuthority: 0.5,
    rollAuthority: 0.5,
    turnBonus: 1,
    speedBleed: 0,
    gLimit: 9.6,
    decoyChance: 0.65,
    profile: {
      pitchTarget: (t, entry) => entry + TAU * easeInOut(span(t, 0, 0.88)),
      rollRate: () => 0,
      yawRate: () => 0,
      speedBias: (t) => -176 * (1 - 0.32 * t),
      gTarget: (t) => 3.2 + 6.2 * Math.sin(Math.PI * span(t, 0.05, 0.9)),
      velocityLock: (t) => 0.62 * (1 - smoothstep(span(t, 0.5, 1))),
      speedFloor: 106,
    },
  },
};

export const MANEUVER_ORDER: ManeuverId[] = [
  'highG',
  'airbrake',
  'cobra',
  'barrelRoll',
  'splitS',
  'immelmann',
  'kulbit',
];

export function isManeuverId(value: unknown): value is ManeuverId {
  return typeof value === 'string' && value in MANEUVERS;
}

export interface ManeuverAvailability {
  available: boolean;
  blocked: string | null;
}

/** Shared entry gate so the HUD and the engine never disagree. */
export function checkManeuverAvailability(
  id: ManeuverId,
  state: { speed: number; altitude: number; activeManeuver: ManeuverId | null },
): ManeuverAvailability {
  const definition = MANEUVERS[id];
  if (state.activeManeuver === id) return { available: true, blocked: null };
  if (state.activeManeuver && MANEUVERS[state.activeManeuver].kind === 'scripted') {
    return { available: false, blocked: '机动进行中' };
  }
  if (state.speed < definition.minSpeed) {
    return { available: false, blocked: `速度不足 ${Math.round(definition.minSpeed)} m/s` };
  }
  if (state.altitude < definition.minAltitude) {
    return { available: false, blocked: `高度不足 ${Math.round(definition.minAltitude)} m` };
  }
  return { available: true, blocked: null };
}

export function buildManeuverStatus(
  state: {
    speed: number;
    altitude: number;
    activeManeuver: ManeuverId | null;
    progress: number;
  },
): ManeuverStatus[] {
  return MANEUVER_ORDER.map((id) => {
    const definition = MANEUVERS[id];
    const gate = checkManeuverAvailability(id, state);
    const active = state.activeManeuver === id;
    return {
      id,
      kind: definition.kind,
      labelEn: definition.labelEn,
      labelZh: definition.labelZh,
      shortZh: definition.shortZh,
      code: definition.code,
      key: definition.keyLabel,
      hint: definition.hint,
      active,
      available: gate.available,
      blocked: gate.blocked,
      progress: active && definition.kind === 'scripted' ? clamp(state.progress, 0, 1) : 0,
    };
  });
}
