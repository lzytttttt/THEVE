import type { CSSProperties } from 'react';
import { cx } from '../primitives';
import type { CombatFeedback, HitMarker, IncomingHit, KillFeedEntry } from '../sim/types';

/**
 * v0.3 impact layer.
 *
 * Everything here is a pure function of the snapshot: the simulation stamps each
 * event with an `age`, and these components turn that age into scale and
 * opacity. Nothing animates on its own clock, so pausing the game freezes the
 * feedback exactly where it was, and a dropped frame cannot desynchronise the
 * marker from the shot that caused it.
 */

function progressOf(age: number, duration: number): number {
  return Math.min(1, Math.max(0, age / Math.max(0.001, duration)));
}

export interface HitConfirmProps {
  hit: HitMarker | null;
  /** Rolling hits in the last two seconds — shown once it is worth bragging about. */
  combo?: number;
  className?: string;
}

/**
 * The hit marker. Sits on the gun reticle at the centre of the HUD: four
 * diagonal ticks that pop outward on impact and fade, going amber and growing a
 * ring when the shot was the one that killed.
 */
export function HitConfirm({ hit, combo = 0, className }: HitConfirmProps) {
  if (!hit) return null;
  const progress = progressOf(hit.age, hit.duration);
  // Fast attack, slow release: 0.6 → 1.15 in the first fifth, then settle.
  const scale =
    progress < 0.18 ? 0.6 + (progress / 0.18) * 0.55 : Math.max(1, 1.15 - ((progress - 0.18) / 0.82) * 0.15);
  const opacity = progress < 0.68 ? 1 : Math.max(0, 1 - (progress - 0.68) / 0.32);
  const style = {
    '--tv-hit-scale': scale.toFixed(3),
    '--tv-hit-opacity': opacity.toFixed(3),
  } as CSSProperties;
  return (
    <div
      className={cx(
        'tv-hitconfirm',
        hit.kind === 'weakpoint' && 'is-weakpoint',
        hit.kill && 'is-kill',
        className,
      )}
      style={style}
      aria-hidden="true"
    >
      <span className="tv-hitconfirm__ticks">
        <i className="tv-hitconfirm__tick tv-hitconfirm__tick--tl" />
        <i className="tv-hitconfirm__tick tv-hitconfirm__tick--tr" />
        <i className="tv-hitconfirm__tick tv-hitconfirm__tick--bl" />
        <i className="tv-hitconfirm__tick tv-hitconfirm__tick--br" />
      </span>
      {hit.kill && <span className="tv-hitconfirm__ring" />}
      <span className="tv-hitconfirm__damage tv-mono">{Math.round(hit.damage)}</span>
      {combo > 2 && <span className="tv-hitconfirm__combo tv-mono">×{combo}</span>}
    </div>
  );
}

export interface DamageDirectionProps {
  hits: IncomingHit[];
  className?: string;
}

/**
 * Damage bearing. A wedge on a ring around the reticle pointing at whatever hit
 * you; the severity sets the tone, and the wedge collapses inward as it expires
 * so a burst of hits reads as a wave rather than a pile of separate icons.
 */
export function DamageDirection({ hits, className }: DamageDirectionProps) {
  if (hits.length === 0) return null;
  return (
    <div className={cx('tv-incoming', className)} aria-hidden="true">
      {hits.map((hit) => {
        const progress = progressOf(hit.age, hit.duration);
        const style = {
          '--tv-bearing': `${hit.bearing.toFixed(1)}deg`,
          '--tv-incoming-opacity': Math.max(0, 1 - progress * progress).toFixed(3),
          '--tv-incoming-spread': (1 + progress * 0.34).toFixed(3),
        } as CSSProperties;
        return (
          <span
            key={hit.id}
            className={cx('tv-incoming__wedge', `tv-incoming__wedge--${hit.severity}`)}
            style={style}
          />
        );
      })}
    </div>
  );
}

export interface KillTickerProps {
  entries: KillFeedEntry[];
  className?: string;
}

/**
 * Confirmed kills, newest first.
 *
 * This is the only combat feedback that is announced: a gun burst connects a
 * dozen times a second, so the hit marker stays purely visual and the kill
 * ticker carries the narration.
 */
export function KillTicker({ entries, className }: KillTickerProps) {
  if (entries.length === 0) return null;
  return (
    <div className={cx('tv-kills', className)} role="log" aria-label="击坠记录">
      {entries.map((entry) => {
        const progress = progressOf(entry.age, entry.duration);
        const style = {
          '--tv-kill-opacity': Math.max(0, Math.min(1, (1 - progress) * 2.4)).toFixed(3),
          '--tv-kill-shift': `${(-12 * progress).toFixed(1)}px`,
        } as CSSProperties;
        return (
          <p
            key={entry.id}
            className={cx(
              'tv-kills__row',
              entry.ace && 'is-ace',
              entry.weakpoint && 'is-weakpoint',
            )}
            style={style}
          >
            <span className="tv-kills__tag tv-mono">
              {entry.weakpoint ? 'NODE DOWN' : entry.ace ? 'ACE SPLASH' : 'SPLASH'}
            </span>
            <span className="tv-kills__name">{entry.callsign}</span>
            <span className="tv-kills__meta tv-mono">{entry.label}</span>
            <span className="tv-kills__points tv-mono">+{entry.points}</span>
          </p>
        );
      })}
    </div>
  );
}

export interface CombatFeedbackLayerProps {
  combat: CombatFeedback;
}

/** Convenience wrapper so a custom HUD can drop the whole impact layer in. */
export function CombatFeedbackLayer({ combat }: CombatFeedbackLayerProps) {
  return (
    <>
      <DamageDirection hits={combat.incoming} />
      <HitConfirm key={combat.hit?.id ?? 'idle'} hit={combat.hit} combo={combat.combo} />
      <KillTicker entries={combat.kills} />
    </>
  );
}
