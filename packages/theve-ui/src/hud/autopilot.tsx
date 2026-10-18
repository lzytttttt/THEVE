import { useAudio, useCockpit, useCockpitActions } from '../sim/CockpitProvider';
import { cx, Keycap } from '../primitives';
import { IconAuto, IconWave } from '../icons';
import { MANEUVER_ORDER } from '../sim/maneuvers';
import type { AutoPilotHud } from '../sim/types';

/* ------------------------------------------------------------------ */
/* the one-key switch                                                  */
/* ------------------------------------------------------------------ */

export interface AutoPilotButtonProps {
  className?: string;
  /** `deck` is the command-deck module, `solo` is the big briefing button. */
  variant?: 'deck' | 'solo';
  /**
   * Overrides the default toggle. The briefing needs this because engaging from
   * the briefing card must also dismiss the overlay.
   */
  onClick?: () => void;
  /** Documentation override — renders the button against a supplied state. */
  state?: Pick<AutoPilotHud, 'engaged' | 'code' | 'demonstrated' | 'total'>;
}

/**
 * Presentational half of the switch, so a documentation page can render it
 * without a live simulation behind it.
 */
export function AutoPilotButtonView({
  className,
  variant = 'deck',
  onClick,
  auto,
  audioReady = true,
  audioMuted = false,
}: {
  className?: string;
  variant?: 'deck' | 'solo';
  onClick?: () => void;
  auto: Pick<AutoPilotHud, 'engaged' | 'code' | 'demonstrated' | 'total'>;
  audioReady?: boolean;
  audioMuted?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        'tv-auto-btn',
        `tv-auto-btn--${variant}`,
        auto.engaged && 'is-on',
        className,
      )}
      aria-pressed={auto.engaged}
      aria-label={auto.engaged ? '关闭全自动皇牌模式' : '开启全自动皇牌模式，自动通关'}
      onClick={onClick}
      title="全自动皇牌模式（G）：飞控接管，自动通关并展示全部战斗机机动"
    >
      <span className="tv-auto-btn__mark" aria-hidden="true">
        <IconAuto size={variant === 'solo' ? 26 : 16} />
      </span>
      <span className="tv-auto-btn__text">
        <b>
          {variant === 'solo' ? '全自动皇牌模式' : '全自动皇牌'}
          <em className="tv-mono">AUTO ACE</em>
        </b>
        <span className="tv-auto-btn__sub tv-mono">
          {auto.engaged
            ? `${auto.code} · 已展示 ${auto.demonstrated}/${auto.total} 种机动`
            : variant === 'solo'
              ? 'ONE KEY CLEAR · 一键自动通关'
              : 'ONE KEY CLEAR'}
        </span>
      </span>
      {variant === 'solo' ? (
        <span className="tv-auto-btn__cta tv-mono">{auto.engaged ? 'STOP' : 'ENGAGE'}</span>
      ) : (
        <Keycap>G</Keycap>
      )}
      {variant === 'solo' && !audioReady && !audioMuted && (
        <span className="tv-auto-btn__hint tv-mono">按下后同时启动音频 · AUDIO STARTS TOO</span>
      )}
    </button>
  );
}

/**
 * v0.4's headline control: one press hands the aircraft to the performer, and
 * the performer finishes the mission. Everything it does from then on is a
 * normal input through the normal flight model.
 */
export function AutoPilotButton({ className, variant = 'deck', onClick, state }: AutoPilotButtonProps) {
  const { auto } = useCockpit();
  const actions = useCockpitActions();
  const audio = useAudio();

  const toggle = () => {
    if (onClick) onClick();
    else actions.toggleAutoPilot();
  };

  return (
    <AutoPilotButtonView
      className={className}
      variant={variant}
      onClick={state ? undefined : toggle}
      auto={state ?? auto}
      audioReady={audio.started}
      audioMuted={audio.muted}
    />
  );
}

/* ------------------------------------------------------------------ */
/* the performer's own rail                                            */
/* ------------------------------------------------------------------ */

/** Drawn as a seven-segment reel so the audience can see the run sheet fill. */
function DemoReel({ auto }: { auto: AutoPilotHud }) {
  return (
    <span className="tv-auto__reel" aria-hidden="true">
      {MANEUVER_ORDER.map((id) => (
        <i
          key={id}
          className={cx(
            'tv-auto__reel-cell',
            auto.shown.includes(id) && 'is-shown',
            auto.shown[auto.shown.length - 1] === id && 'is-latest',
          )}
        />
      ))}
    </span>
  );
}

export interface AutoPilotRailProps {
  className?: string;
  /** Documentation override — renders the rail against a supplied state. */
  state?: AutoPilotHud;
}

/**
 * Presentational half of the rail, so a documentation page can render it
 * without a live simulation behind it.
 */
export function AutoPilotRailView({ auto, className }: { auto: AutoPilotHud; className?: string }) {
  if (!auto.engaged) return null;
  const condition = Math.round(auto.condition * 100);
  return (
    <div
      className={cx('tv-auto', `tv-auto--${auto.mode}`, className)}
      role="status"
      aria-live="polite"
    >
      <div className="tv-auto__head">
        <span className="tv-auto__badge tv-mono">
          <IconAuto size={12} />
          {auto.code}
        </span>
        <span className="tv-auto__mode">
          {auto.labelZh}
          <em className="tv-mono">{auto.labelEn}</em>
        </span>
      </div>

      {auto.callout && (
        <div className="tv-auto__callout">
          <span className="tv-auto__callout-text">{auto.callout}</span>
          {auto.progress > 0 && (
            <span className="tv-auto__track" aria-hidden="true">
              <i style={{ width: `${Math.round(auto.progress * 100)}%` }} />
            </span>
          )}
        </div>
      )}

      <div className="tv-auto__row">
        <span className="tv-auto__label tv-mono">DEMO</span>
        <DemoReel auto={auto} />
        <span className="tv-auto__count tv-mono">
          {auto.demonstrated}/{auto.total}
          <small>· {auto.plays} PLAYS</small>
        </span>
      </div>

      <div className="tv-auto__row">
        <span className="tv-auto__label tv-mono">COND</span>
        <span className="tv-auto__bar" aria-hidden="true">
          <i style={{ width: `${condition}%` }} />
        </span>
        <span className="tv-auto__count tv-mono">{condition}%</span>
      </div>

      {auto.retryIn !== null && (
        <div className="tv-auto__retry tv-mono">
          跳伞重来 · RE-ENGAGING IN {Math.ceil(auto.retryIn)}s
        </div>
      )}
      {auto.targetCallsign && auto.retryIn === null && (
        <div className="tv-auto__target tv-mono">
          目标 <b>{auto.targetCallsign}</b>
        </div>
      )}
    </div>
  );
}

/**
 * The performer's heads-up: what it is doing, which move it is flying, and how
 * much of the demonstration reel it has already shown.
 */
export function AutoPilotRail({ className, state }: AutoPilotRailProps) {
  const { auto } = useCockpit();
  return <AutoPilotRailView auto={state ?? auto} className={className} />;
}

/* ------------------------------------------------------------------ */
/* the stage                                                           */
/* ------------------------------------------------------------------ */

export interface WaveTrackerProps {
  className?: string;
}

/**
 * v0.4 stage readout: which wave is on, what is still airborne, and what the
 * squadron has left in the locker. Reads the roster the mission was built from,
 * so the threat database and the fight never disagree.
 */
export function WaveTracker({ className }: WaveTrackerProps) {
  const { wave, phase } = useCockpit();
  if (phase === 'idle') return null;
  const inbound = wave.inbound;
  return (
    <div className={cx('tv-wave', inbound && 'is-inbound', className)}>
      <div className="tv-wave__head">
        <span className="tv-wave__code tv-mono">
          <IconWave size={12} />
          {wave.code}
          <small>
            {wave.index}/{wave.total}
          </small>
        </span>
        <span className="tv-wave__label">{wave.labelZh}</span>
        <span className="tv-wave__hostiles tv-mono">{wave.hostiles} AIRBORNE</span>
      </div>
      <ul className="tv-wave__roster">
        {wave.roster.map((entry) => (
          <li
            key={entry.enemyId}
            className={cx(
              'tv-wave__unit',
              entry.alive > 0 && 'is-live',
              entry.alive === 0 && entry.down > 0 && 'is-clear',
            )}
            title={`${entry.labelZh} · ${entry.labelEn}`}
          >
            <b className="tv-mono">{entry.code}</b>
            <span className="tv-wave__pips" aria-hidden="true">
              {Array.from({ length: entry.total }, (_, index) => (
                <i
                  key={index}
                  className={cx(
                    'tv-wave__pip',
                    index < entry.down && 'is-down',
                    index >= entry.down && index < entry.down + entry.alive && 'is-live',
                    index >= entry.down + entry.alive && 'is-pending',
                  )}
                />
              ))}
            </span>
            <span className="tv-wave__tally tv-mono">
              {entry.alive > 0 ? `×${entry.alive}` : 'CLR'}
            </span>
          </li>
        ))}
      </ul>
      {wave.nextIn !== null && (
        <div className="tv-wave__next tv-mono">
          下一波 · NEXT WAVE IN {Math.ceil(Math.max(0, wave.nextIn))}s
        </div>
      )}
      {inbound && <div className="tv-wave__flash tv-mono">REINFORCEMENTS INBOUND</div>}
    </div>
  );
}
