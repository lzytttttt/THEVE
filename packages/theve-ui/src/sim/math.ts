import type { Vec3 } from './types';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function wrapRadians(value: number): number {
  const full = Math.PI * 2;
  return ((((value + Math.PI) % full) + full) % full) - Math.PI;
}

export function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, factor: number): Vec3 {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-6) return vec3(0, 0, -1);
  return scale(a, 1 / len);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function approach(current: number, target: number, delta: number): number {
  if (current < target) return Math.min(current + delta, target);
  if (current > target) return Math.max(current - delta, target);
  return current;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Forward vector for a yaw/pitch pair where 0,0 looks toward -Z. */
export function forwardFromAngles(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

/** Right vector for a yaw angle. */
export function rightFromYaw(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

export function upFromAngles(yaw: number, pitch: number, roll: number): Vec3 {
  // Rotate the world up vector through the aircraft's YXZ orientation.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return {
    x: sy * sp * cr + cy * sr,
    y: cp * cr,
    z: cy * sp * cr - sy * sr,
  };
}

export function yawPitchFromDirection(direction: Vec3): { yaw: number; pitch: number } {
  const dir = normalize(direction);
  return {
    yaw: Math.atan2(-dir.x, -dir.z),
    pitch: Math.asin(clamp(dir.y, -1, 1)),
  };
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const denominator = length(a) * length(b);
  if (denominator < 1e-6) return 0;
  return Math.acos(clamp(dot(a, b) / denominator, -1, 1));
}

/**
 * Bearing of a world point relative to the aircraft nose, in degrees clockwise
 * from dead ahead. Used by the v0.3 damage indicator and the audio panner.
 */
export function bearingDegrees(yaw: number, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 0;
  const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return (Math.atan2(right, forward) * RAD + 360) % 360;
}

export function headingFromYaw(yaw: number): number {
  return wrapDegrees(-yaw * RAD);
}

export function yawFromHeading(heading: number): number {
  return -heading * DEG;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const ss = (safe % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatHeading(value: number): string {
  return Math.round(wrapDegrees(value)).toString().padStart(3, '0');
}

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function uid(prefix: string, counter: number): string {
  return `${prefix}-${counter}`;
}
