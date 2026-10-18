export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatNumber(value: number, digits = 0): string {
  return value.toFixed(digits);
}

export function formatRange(meters: number): string {
  if (!Number.isFinite(meters)) return '---';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} KM`;
  return `${Math.round(meters)} M`;
}

export function formatSpeed(knots: number): string {
  return Math.round(knots).toString();
}

export function formatMach(mach: number): string {
  return mach.toFixed(2);
}

export function formatAltitude(meters: number): string {
  return formatInt(meters);
}

export function formatVertical(metersPerSecond: number): string {
  const rounded = Math.round(metersPerSecond);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded} M/S`;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const rest = (safe % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

export function formatHeading(heading: number): string {
  return Math.round(((heading % 360) + 360) % 360)
    .toString()
    .padStart(3, '0');
}

export function formatSigned(value: number, digits = 0): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}
