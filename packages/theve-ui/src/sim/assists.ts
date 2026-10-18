import { clamp, wrapRadians } from './math';
import type { AssistId, AssistSettings, AssistStatus, ControlInput } from './types';

export interface AssistDefinition {
  id: AssistId;
  labelEn: string;
  labelZh: string;
  code: string;
  hint: string;
}

export const ASSISTS: Record<AssistId, AssistDefinition> = {
  attitude: {
    id: 'attitude',
    labelEn: 'ATTITUDE',
    labelZh: '姿态辅助',
    code: 'ATT',
    hint: '松杆时自动消除滚转漂移；接近平飞时把机翼摆正',
  },
  steering: {
    id: 'steering',
    labelEn: 'TGT STEER',
    labelZh: '目标引导',
    code: 'STG',
    hint: '锁定目标在机头前方时轻微带杆，把敌机送进锁定锥',
  },
  throttle: {
    id: 'throttle',
    labelEn: 'AUTO THR',
    labelZh: '自动油门',
    code: 'THR',
    hint: '松手后自动保持交战速度，一推杆立刻交还控制',
  },
  terrain: {
    id: 'terrain',
    labelEn: 'LOW ALT',
    labelZh: '低空保护',
    code: 'ALT',
    hint: '低空自动提醒并在触地前柔和拉起',
  },
};

export const ASSIST_ORDER: AssistId[] = ['attitude', 'steering', 'throttle', 'terrain'];

export const DEFAULT_ASSISTS: AssistSettings = {
  attitude: true,
  steering: true,
  throttle: true,
  terrain: true,
};

export function normalizeAssists(value: unknown): AssistSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ASSISTS };
  const source = value as Partial<Record<AssistId, unknown>>;
  const next = { ...DEFAULT_ASSISTS };
  for (const id of ASSIST_ORDER) {
    if (typeof source[id] === 'boolean') next[id] = source[id] as boolean;
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* budgets — what each aid is allowed to add on top of the pilot       */
/* ------------------------------------------------------------------ */

const ATTITUDE_ROLL_BUDGET = 0.4;
const ATTITUDE_RATE_BUDGET = 0.3;
const ATTITUDE_LEVEL_BAND = 0.22;
const STEER_YAW_BUDGET = 0.34;
const STEER_PITCH_BUDGET = 0.26;
const STEER_MAX_ANGLE = 74;
const TERRAIN_CAUTION = 1300;
const TERRAIN_WARNING = 820;
const TERRAIN_PULL_UP = 520;
const TERRAIN_PITCH_BUDGET = 0.62;

export interface AssistTarget {
  /** Absolute yaw the nose should point at. */
  yaw: number;
  /** Absolute pitch the nose should point at. */
  pitch: number;
  distance: number;
  /** Angle between the nose and the target in degrees. */
  angle: number;
  lockable: boolean;
}

export interface AssistContext {
  settings: AssistSettings;
  master: boolean;
  /** Frame time so every aid works at a constant rate, not per frame. */
  dt: number;
  input: ControlInput;
  roll: number;
  rollRate: number;
  pitch: number;
  yaw: number;
  speed: number;
  altitude: number;
  throttle: number;
  /** The throttle the pilot last commanded — the aid never drops below it. */
  pilotThrottle: number;
  /** Seconds since the pilot last touched the throttle. */
  throttleIdle: number;
  target: AssistTarget | null;
  /** Scripted manoeuvres own the airframe; aids stand down. */
  maneuverActive: boolean;
  active: boolean;
}

export interface AssistSolution {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number | null;
  engaged: AssistId[];
  authority: Record<AssistId, number>;
  terrainAlert: 'caution' | 'critical' | null;
  speedHold: number | null;
}

const EMPTY_AUTHORITY: Record<AssistId, number> = {
  attitude: 0,
  steering: 0,
  throttle: 0,
  terrain: 0,
};

/** How much of an axis the pilot has left free for the co-pilot. */
function freeAxis(pilot: number, deadzone: number): number {
  return 1 - clamp(Math.abs(pilot) / deadzone, 0, 1);
}

export function solveAssists(context: AssistContext): AssistSolution {
  const solution: AssistSolution = {
    roll: 0,
    pitch: 0,
    yaw: 0,
    throttle: null,
    engaged: [],
    authority: { ...EMPTY_AUTHORITY },
    terrainAlert: null,
    speedHold: null,
  };
  if (!context.master || !context.active) return solution;

  const { settings, input } = context;

  /* --- 1. attitude: calm the roll axis, level the wings near neutral ---- */
  if (settings.attitude && !context.maneuverActive) {
    const handle = freeAxis(input.roll, 0.26);
    let correction = 0;
    let authority = 0;
    if (handle > 0) {
      const damped = clamp(-context.rollRate * 0.24, -ATTITUDE_RATE_BUDGET, ATTITUDE_RATE_BUDGET);
      correction += damped * handle;
      authority = Math.abs(damped) / ATTITUDE_RATE_BUDGET;
      if (Math.abs(context.roll) < ATTITUDE_LEVEL_BAND) {
        const level =
          (-context.roll / ATTITUDE_LEVEL_BAND) * ATTITUDE_ROLL_BUDGET * (0.35 + 0.65 * handle);
        correction += level;
        authority = Math.max(authority, Math.abs(level) / ATTITUDE_ROLL_BUDGET);
      }
    }
    if (Math.abs(correction) > 1e-4) {
      solution.roll += clamp(correction, -ATTITUDE_ROLL_BUDGET, ATTITUDE_ROLL_BUDGET);
      solution.authority.attitude = clamp(authority, 0, 1);
      solution.engaged.push('attitude');
    }
  }

  /* --- 2. steering: nudge the nose onto the selected bandit ------------ */
  if (settings.steering && !context.maneuverActive && context.target) {
    const target = context.target;
    const angleFalloff = clamp((STEER_MAX_ANGLE - target.angle) / 34, 0, 1);
    if (angleFalloff > 0.02) {
      const yawHandle = freeAxis(input.yaw, 0.34);
      const pitchHandle = freeAxis(input.pitch, 0.3);
      const yawError = wrapRadians(target.yaw - context.yaw);
      const pitchError = wrapRadians(target.pitch - context.pitch);
      const yawGain = clamp(yawError * 0.9, -1, 1) * STEER_YAW_BUDGET * angleFalloff;
      const pitchGain = clamp(pitchError * 0.95, -1, 1) * STEER_PITCH_BUDGET * angleFalloff;
      const yaw = yawGain * yawHandle;
      const pitch = pitchGain * pitchHandle;
      if (Math.abs(yaw) > 1e-4 || Math.abs(pitch) > 1e-4) {
        solution.yaw += yaw;
        solution.pitch += pitch;
        solution.authority.steering = clamp(
          Math.max(Math.abs(yaw) / STEER_YAW_BUDGET, Math.abs(pitch) / STEER_PITCH_BUDGET),
          0,
          1,
        );
        solution.engaged.push('steering');
      }
    }
  }

  /* --- 3. auto throttle: hold an energy profile while hands are off ---- */
  if (settings.throttle && !context.maneuverActive && context.throttleIdle > 1.6) {
    let desired: number;
    if (context.target) {
      const range = context.target.distance;
      desired = range > 2800 ? 316 : range > 1600 ? 292 : range > 800 ? 246 : 214;
    } else {
      desired = 258;
    }
    const floor = Math.max(0.2, context.pilotThrottle);
    const error = desired - context.speed;
    // Only ever adds power above the pilot's own command, and always gives it
    // back afterwards — a full-throttle order is never overruled.
    const slew = 0.9 * context.dt;
    const step = clamp(error * 0.6 * context.dt, -slew, slew);
    const next = clamp(context.throttle + step, floor, 1);
    if (Math.abs(next - context.throttle) > 0.0004) {
      solution.throttle = next;
      solution.speedHold = desired;
      solution.authority.throttle = clamp(Math.abs(next - context.throttle) / 0.1, 0, 1);
      solution.engaged.push('throttle');
    }
  }

  /* --- 4. low altitude guard ------------------------------------------ */
  if (settings.terrain) {
    const altitude = context.altitude;
    if (altitude < TERRAIN_CAUTION) {
      solution.terrainAlert = altitude < TERRAIN_WARNING ? 'critical' : 'caution';
      const urgency = clamp((TERRAIN_WARNING - altitude) / (TERRAIN_WARNING - TERRAIN_PULL_UP), 0, 1);
      if (urgency > 0) {
        // Below the hard floor the guard stops asking and simply flies.
        const handle = Math.max(freeAxis(input.pitch, 0.4), urgency);
        const pull = urgency * TERRAIN_PITCH_BUDGET * handle;
        solution.pitch += pull;
        solution.authority.terrain = clamp(pull / TERRAIN_PITCH_BUDGET, 0, 1);
        solution.engaged.push('terrain');
      }
    }
  }

  solution.roll = clamp(solution.roll, -1, 1);
  solution.pitch = clamp(solution.pitch, -1, 1);
  solution.yaw = clamp(solution.yaw, -1, 1);
  solution.engaged = Array.from(new Set(solution.engaged));
  return solution;
}

export function buildAssistStatus(
  settings: AssistSettings,
  master: boolean,
  engaged: readonly AssistId[],
  authority: Record<AssistId, number>,
): AssistStatus[] {
  return ASSIST_ORDER.map((id) => {
    const definition = ASSISTS[id];
    const enabled = master && settings[id];
    return {
      id,
      labelEn: definition.labelEn,
      labelZh: definition.labelZh,
      code: definition.code,
      hint: definition.hint,
      enabled,
      engaged: enabled && engaged.includes(id),
      authority: enabled ? clamp(authority[id] ?? 0, 0, 1) : 0,
    };
  });
}
