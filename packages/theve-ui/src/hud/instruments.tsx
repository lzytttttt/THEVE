import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../primitives';
import {
  formatAltitude,
  formatHeading,
  formatMach,
  formatSpeed,
  formatVertical,
} from './format';

const CARDINALS: Record<number, string> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

export interface HeadingTapeProps {
  heading: number;
  className?: string;
}

export function HeadingTape({ heading, className }: HeadingTapeProps) {
  const base = Math.round(heading / 5) * 5;
  const marks = Array.from({ length: 25 }, (_, index) => base - 60 + index * 5).map((value) => {
    const normalized = ((value % 360) + 360) % 360;
    return { value: normalized, delta: value - base };
  });
  return (
    <div className={cx('tv-heading', className)}>
      <span className="tv-sr-only">当前航向 {formatHeading(heading)} 度</span>
      <div className="tv-heading__track" aria-hidden="true">
        {marks.map((mark) => {
          const major = mark.value % 10 === 0;
          const cardinal = CARDINALS[mark.value];
          return (
            <span
              key={`${mark.value}-${mark.delta}`}
              className={cx(
                'tv-heading__mark',
                major && 'is-major',
                cardinal && 'is-cardinal',
              )}
              style={
                {
                  '--tv-hdg-offset': `${mark.delta * 0.72}%`,
                } as CSSProperties
              }
            >
              {cardinal ?? (major ? formatHeading(mark.value) : '')}
            </span>
          );
        })}
      </div>
      <div className="tv-heading__center" aria-hidden="true" />
      <div className="tv-heading__readout tv-mono" aria-hidden="true">
        {formatHeading(heading)}
        <span>HDG</span>
      </div>
      <span className="tv-heading__tick tv-heading__tick--left" aria-hidden="true" />
      <span className="tv-heading__tick tv-heading__tick--right" aria-hidden="true" />
    </div>
  );
}

export interface PitchLadderProps {
  pitch: number;
  roll: number;
  className?: string;
}

export function PitchLadder({ pitch, roll, className }: PitchLadderProps) {
  const marks = [-30, -20, -10, 0, 10, 20, 30];
  return (
    <div className={cx('tv-pitch-ladder', className)} aria-hidden="true">
      <div
        className="tv-pitch-ladder__rotor"
        style={{ transform: `translate(-50%, -50%) rotate(${-roll}deg)` }}
      >
        {marks.map((mark) => {
          const offset = (pitch - mark) * 4.4;
          const isHorizon = mark === 0;
          return (
            <div
              key={mark}
              className={cx('tv-pitch-ladder__mark', isHorizon && 'is-horizon')}
              style={{ transform: `translate(-50%, calc(-50% + ${offset}px))` }}
            >
              <span className="tv-pitch-ladder__wing" />
              <span className="tv-pitch-ladder__label tv-mono">
                {mark > 0 ? `+${mark}` : mark}
              </span>
              <span className="tv-pitch-ladder__wing" />
            </div>
          );
        })}
      </div>
      <div className="tv-pitch-ladder__bank">
        <span className="tv-mono">BANK {Math.round(Math.abs(roll)).toString().padStart(2, '0')}</span>
      </div>
    </div>
  );
}

export function FlightPathMarker() {
  return (
    <div className="tv-fpm" aria-hidden="true">
      <span className="tv-fpm__ring" />
      <span className="tv-fpm__wing tv-fpm__wing--left" />
      <span className="tv-fpm__wing tv-fpm__wing--right" />
      <span className="tv-fpm__tail" />
    </div>
  );
}

export interface SpeedTapeProps {
  knots: number;
  mach: number;
  afterburner?: boolean;
  className?: string;
}

export function SpeedTape({ knots, mach, afterburner, className }: SpeedTapeProps) {
  return (
    <VerticalTape
      className={cx('tv-speed-tape', className)}
      side="left"
      label="IAS"
      value={knots}
      step={20}
      unit="KT"
      readout={formatSpeed(knots)}
      hint={`MACH ${formatMach(mach)}`}
      badge={afterburner ? 'AB' : undefined}
    />
  );
}

export interface AltitudeTapeProps {
  altitude: number;
  verticalSpeed: number;
  className?: string;
}

export function AltitudeTape({
  altitude,
  verticalSpeed,
  className,
}: AltitudeTapeProps) {
  return (
    <VerticalTape
      className={cx('tv-alt-tape', className)}
      side="right"
      label="ALT"
      value={altitude}
      step={200}
      unit="M"
      readout={formatAltitude(altitude)}
      hint={formatVertical(verticalSpeed)}
      digits={0}
    />
  );
}

interface VerticalTapeProps {
  className?: string;
  side: 'left' | 'right';
  label: string;
  unit: string;
  value: number;
  step: number;
  readout: string;
  hint?: string;
  badge?: string;
  digits?: number;
}

function VerticalTape({
  className,
  side,
  label,
  unit,
  value,
  step,
  readout,
  hint,
  badge,
  digits = 0,
}: VerticalTapeProps) {
  const anchor = Math.round(value / step) * step;
  const marks = Array.from({ length: 11 }, (_, index) => anchor + (index - 5) * step);
  return (
    <div className={cx('tv-tape', `tv-tape--${side}`, className)}>
      <span className="tv-sr-only">
        {label} {value.toFixed(digits)} {unit}
      </span>
      <div className="tv-tape__head">
        <span>{label}</span>
        {badge && <span className="tv-tape__badge">{badge}</span>}
      </div>
      <div className="tv-tape__rail" aria-hidden="true">
        <div className="tv-tape__marks">
          {marks.map((mark) => {
            const offset = ((value - mark) / step) * 19;
            const major = Math.abs(mark % (step * 2)) < 0.001;
            return (
              <span
                key={mark}
                className={cx('tv-tape__mark', major && 'is-major')}
                style={{ top: `calc(50% + ${offset}px)` }}
              >
                <span className="tv-tape__mark-line" />
                {major && <span className="tv-tape__mark-text tv-mono">{mark.toFixed(digits)}</span>}
              </span>
            );
          })}
        </div>
        <div className="tv-tape__needle" />
      </div>
      <div className="tv-tape__readout" aria-hidden="true">
        <span className="tv-tape__value tv-mono">{readout}</span>
        <span className="tv-tape__unit">{unit}</span>
        {hint && <span className="tv-tape__hint tv-mono">{hint}</span>}
      </div>
    </div>
  );
}

export interface ReadoutChipProps {
  label: ReactNode;
  value: ReactNode;
  tone?: 'cyan' | 'amber' | 'red' | 'green';
}

export function ReadoutChip({ label, value, tone = 'cyan' }: ReadoutChipProps) {
  return (
    <div className={cx('tv-chip', `tv-chip--${tone}`)}>
      <span>{label}</span>
      <strong className="tv-mono">{value}</strong>
    </div>
  );
}
