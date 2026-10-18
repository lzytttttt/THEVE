import type { CSSProperties } from 'react';
import { cx } from '../primitives';
import { formatInt, formatRange } from './format';
import type { HudTarget, WarningState } from '../sim/types';

export interface TargetMarkerProps {
  target: HudTarget;
  onSelect?: (id: string) => void;
}

export function TargetMarker({ target, onSelect }: TargetMarkerProps) {
  const offscreen = !target.screen.onScreen;
  if (offscreen && !target.selected) return null;
  const interactive = target.lockable && typeof onSelect === 'function';
  const baseSize = target.kind === 'weakpoint' ? 42 : 44;
  const size = Math.round(baseSize + Math.min(1.7, target.screen.scale) * 14);
  const edgeAngle =
    (Math.atan2(target.screen.y - 0.5, target.screen.x - 0.5) * 180) / Math.PI + 90;
  const style = {
    left: `${target.screen.x * 100}%`,
    top: `${target.screen.y * 100}%`,
    width: `${size}px`,
    height: `${size}px`,
    '--tv-edge-angle': `${edgeAngle}deg`,
  } as CSSProperties;
  const className = cx(
    'tv-target',
    `tv-target--${target.team}`,
    target.kind === 'weakpoint' && 'tv-target--weakpoint',
    target.variant === 'ace' && 'tv-target--ace',
    target.selected && 'is-selected',
    target.locked && 'is-locked',
    offscreen && 'is-offscreen',
  );
  const ariaLabel = `${target.team === 'ally' ? '僚机' : '目标'} ${target.callsign} ${target.label}，距离 ${formatRange(target.distance)}`;
  const showLabel = target.selected || target.team === 'ally';
  const content = (
    <>
      <span className="tv-target__corner tv-target__corner--tl" aria-hidden="true" />
      <span className="tv-target__corner tv-target__corner--tr" aria-hidden="true" />
      <span className="tv-target__corner tv-target__corner--bl" aria-hidden="true" />
      <span className="tv-target__corner tv-target__corner--br" aria-hidden="true" />
      <span className="tv-target__core" aria-hidden="true" />
      {showLabel && (
        <span className="tv-target__label">
          <span className="tv-target__name">
            {target.kind === 'weakpoint' ? target.label : target.callsign}
          </span>
          <span className="tv-target__meta tv-mono">
            {target.kind === 'weakpoint' ? 'WEAK POINT' : target.team === 'ally' ? 'ALLY' : 'HOSTILE'}
            <em>{formatRange(target.distance)}</em>
          </span>
          {target.kind === 'weakpoint' && (
            <span className="tv-target__hp" aria-hidden="true">
              <i style={{ width: `${(target.hp / Math.max(1, target.maxHp)) * 100}%` }} />
            </span>
          )}
          {target.locked && <span className="tv-target__locked">LOCK</span>}
        </span>
      )}
      {offscreen && (
        <>
          <span className="tv-target__edge-arrow" aria-hidden="true" />
          <span className="tv-target__edge tv-mono">OFF</span>
        </>
      )}
    </>
  );
  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        data-tv-ui="true"
        tabIndex={-1}
        aria-label={ariaLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onSelect?.(target.id)}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={className} style={style} aria-hidden="true">
      {content}
    </div>
  );
}

export interface LockReticleProps {
  target: HudTarget | null;
  className?: string;
}

export function LockReticle({ target, className }: LockReticleProps) {
  if (!target || !target.screen.onScreen) return null;
  const progress = Math.min(1, Math.max(0, target.lockProgress));
  return (
    <div
      className={cx('tv-lock', target.locked && 'is-locked', className)}
      style={{ left: `${target.screen.x * 100}%`, top: `${target.screen.y * 100}%` }}
      aria-hidden="true"
    >
      <span className="tv-lock__diamond" />
      <span className="tv-lock__arcs" />
      <span className="tv-lock__brackets tv-lock__brackets--tl" />
      <span className="tv-lock__brackets tv-lock__brackets--br" />
      <span className="tv-lock__caption tv-mono">
        {target.locked ? 'LOCK' : progress > 0.02 ? 'SEEK' : 'ID'}
      </span>
      <span className="tv-lock__bar">
        <i style={{ width: `${progress * 100}%` }} />
      </span>
    </div>
  );
}

export interface MissileWarningProps {
  warnings: WarningState[];
}

export function MissileWarning({ warnings }: MissileWarningProps) {
  const warning =
    warnings.find((item) => item.kind === 'missile') ??
    warnings.find((item) => item.severity === 'critical') ??
    warnings[0];
  if (!warning) return null;
  return (
    <div
      className={cx('tv-alert', `tv-alert--${warning.severity}`)}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span
        className="tv-alert__direction"
        style={{ transform: `rotate(${warning.direction}deg)` }}
        aria-hidden="true"
      >
        <span className="tv-alert__chevron" />
      </span>
      <span className="tv-alert__body">
        <strong className="tv-alert__title">{warning.message}</strong>
        <span className="tv-alert__detail">{warning.detail}</span>
      </span>
      <span className="tv-alert__stripes" aria-hidden="true" />
    </div>
  );
}

export interface DamageOverlayProps {
  hpRatio: number;
  warnings: WarningState[];
  phase: string;
}

export function DamageOverlay({ hpRatio, warnings, phase }: DamageOverlayProps) {
  const critical = hpRatio <= 0.3;
  const damaged = hpRatio < 0.72;
  const hit = warnings.some((warning) => warning.kind === 'damage');
  const failed = phase === 'failed';
  return (
    <div
      className={cx(
        'tv-damage',
        damaged && 'is-damaged',
        critical && 'is-critical',
        hit && 'is-hit',
        failed && 'is-failed',
      )}
      style={{ '--tv-hp': Math.max(0, hpRatio) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="tv-damage__vignette" />
      <span className="tv-damage__scan" />
      <span className="tv-damage__frame" />
    </div>
  );
}

export function TargetLockReadout({
  target,
  count,
}: {
  target: HudTarget | null;
  count: number;
}) {
  return (
    <div className="tv-lock-readout" aria-hidden="true">
      <span className="tv-lock-readout__label">TGT</span>
      <span className="tv-lock-readout__value tv-mono">
        {target ? target.callsign : '---'}
      </span>
      <span className="tv-lock-readout__meta tv-mono">
        {target ? `${formatInt(target.distance)} M` : `${count} CONTACTS`}
      </span>
    </div>
  );
}
