import { useCockpit, useCockpitActions } from '../sim/CockpitProvider';
import { cx, Keycap, StatusLamp } from '../primitives';
import { IconBolt, IconCheck, IconClose, IconCrosshair, IconGear, IconTarget } from '../icons';
import type {
  AssistId,
  ManeuverStatus,
  TutorialState,
} from '../sim/types';

/* ------------------------------------------------------------------ */
/* Manoeuvre timeline banner                                           */
/* ------------------------------------------------------------------ */

export interface ManeuverBannerProps {
  className?: string;
}

/**
 * Names the manoeuvre currently owning the airframe and shows its timeline.
 * Purely informational — it never steals pointer events from the cockpit.
 */
export function ManeuverBanner({ className }: ManeuverBannerProps) {
  const { maneuver } = useCockpit();
  if (!maneuver.active) return null;
  const scripted = maneuver.progress > 0;
  return (
    <div
      className={cx('tv-maneuver-banner', scripted && 'is-scripted', className)}
      role="status"
      aria-live="polite"
    >
      <span className="tv-maneuver-banner__code tv-mono">{maneuver.activeCode}</span>
      <span className="tv-maneuver-banner__name">
        {maneuver.activeLabelZh}
        <em className="tv-mono">{maneuver.activeLabelEn}</em>
      </span>
      {scripted && (
        <span className="tv-maneuver-banner__track" aria-hidden="true">
          <i style={{ width: `${Math.round(maneuver.progress * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status strip: active manoeuvre + flight aids                        */
/* ------------------------------------------------------------------ */

export interface FlightAidStripProps {
  className?: string;
}

/**
 * The always-on readout for v0.2 handling: which aid is flying right now and
 * how much authority it is using. Lives on the left rail under the objective.
 */
export function FlightAidStrip({ className }: FlightAidStripProps) {
  const { assist, flight, maneuver } = useCockpit();
  const activeManeuver = maneuver.list.find((item) => item.active) ?? null;
  return (
    <div className={cx('tv-aid', className)} aria-live="off">
      <div className="tv-aid__row">
        <span className="tv-aid__label tv-mono">MODE</span>
        <span
          className={cx(
            'tv-aid__mode tv-mono',
            activeManeuver && 'is-active',
            flight.airbrake && 'is-brake',
            flight.highG && 'is-highg',
          )}
        >
          {activeManeuver
            ? `${activeManeuver.code} · ${activeManeuver.labelZh}`
            : flight.afterburner
              ? 'AB · 全加力'
              : 'MANUAL · 手动'}
        </span>
      </div>
      <div className="tv-aid__row">
        <span className="tv-aid__label tv-mono">ASSIST</span>
        <span className="tv-aid__lamps">
          {assist.list.map((item) => (
            <span
              key={item.id}
              className={cx(
                'tv-aid__lamp',
                item.enabled && 'is-on',
                item.engaged && 'is-engaged',
              )}
              title={`${item.labelZh} · ${item.hint}`}
            >
              <i aria-hidden="true" />
              <b className="tv-mono">{item.code}</b>
            </span>
          ))}
          {assist.engaged.length > 0 && (
            <em className="tv-aid__count tv-mono">
              {assist.engaged.length} ACTIVE
            </em>
          )}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lock steering cue                                                   */
/* ------------------------------------------------------------------ */

export interface LockSteeringCueProps {
  className?: string;
}

/**
 * A small azimuth/elevation bug that shows which way to pull to put the bandit
 * inside the lock cone. Visible whenever a target is selected but not locked.
 */
export function LockSteeringCue({ className }: LockSteeringCueProps) {
  const { lock } = useCockpit();
  if (!lock.targetId || lock.state === 'locked') return null;
  const range = 26;
  // A positive yaw error means the bandit sits off the left wing, so the bug
  // travels the opposite way on screen; elevation is already nose-relative.
  const x = Math.max(-1, Math.min(1, -lock.steering / range));
  const y = Math.max(-1, Math.min(1, -lock.elevation / range));
  return (
    <div
      className={cx('tv-steer', lock.assisted && 'is-assisted', className)}
      role="img"
      aria-label={`目标引导：方位 ${Math.round(lock.steering)} 度，俯仰 ${Math.round(lock.elevation)} 度`}
    >
      <span className="tv-steer__frame" aria-hidden="true" />
      <span
        className="tv-steer__bug"
        style={{ transform: `translate(calc(-50% + ${x * 17}px), calc(-50% + ${y * 17}px))` }}
        aria-hidden="true"
      />
      <span className="tv-steer__label tv-mono">
        {lock.assisted ? 'STEER · 引导中' : 'STEER'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Manoeuvre rail (deck module)                                        */
/* ------------------------------------------------------------------ */

export interface ManeuverRailProps {
  className?: string;
  compact?: boolean;
}

/**
 * Seven fighter manoeuvres, press-and-hold for the sustained pair. Doubles as
 * the touch surface for `C / X / Z / V / B / N / K`.
 */
export function ManeuverRail({ className, compact = false }: ManeuverRailProps) {
  const { maneuver } = useCockpit();
  const actions = useCockpitActions();

  const press = (item: ManeuverStatus) => {
    if (!item.available && !item.active) return;
    actions.startManeuver(item.id);
  };
  const release = (item: ManeuverStatus) => {
    if (item.kind === 'sustained') actions.endManeuver(item.id);
  };

  return (
    <div className={cx('tv-maneuvers', compact && 'tv-maneuvers--compact', className)}>
      <div className="tv-maneuvers__grid">
        {maneuver.list.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cx(
              'tv-maneuver',
              item.active && 'is-active',
              !item.available && !item.active && 'is-blocked',
              item.kind === 'scripted' && 'is-scripted',
            )}
            title={item.available ? item.hint : item.blocked ?? item.hint}
            aria-pressed={item.active}
            aria-label={`${item.labelZh} ${item.labelEn}（${item.key}）`}
            onPointerDown={(event) => {
              event.preventDefault();
              press(item);
            }}
            onPointerUp={() => release(item)}
            onPointerLeave={() => release(item)}
            onPointerCancel={() => release(item)}
            onClick={(event) => {
              // Keyboard activation only; pointer presses are handled above.
              if (event.detail === 0) actions.startManeuver(item.id);
            }}
          >
            <b className="tv-maneuver__code tv-mono">{item.code}</b>
            <span className="tv-maneuver__zh">{item.shortZh}</span>
            <Keycap>{item.key}</Keycap>
            {item.active && item.kind === 'scripted' && (
              <span className="tv-maneuver__track" aria-hidden="true">
                <i style={{ width: `${Math.round(item.progress * 100)}%` }} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assist toggles                                                      */
/* ------------------------------------------------------------------ */

const ASSIST_ICON: Record<AssistId, typeof IconGear> = {
  attitude: IconCrosshair,
  steering: IconTarget,
  throttle: IconBolt,
  terrain: IconGear,
};

export interface AssistRailProps {
  className?: string;
  compact?: boolean;
}

/** Master switch plus the four flight aids, mirroring the `Y` shortcut. */
export function AssistRail({ className, compact = false }: AssistRailProps) {
  const { assist } = useCockpit();
  const actions = useCockpitActions();

  return (
    <div className={cx('tv-assists', compact && 'tv-assists--compact', className)}>
      <div className="tv-assists__grid">
        {assist.list.map((item) => {
          const Icon = ASSIST_ICON[item.id];
          return (
            <button
              key={item.id}
              type="button"
              className={cx(
                'tv-assist',
                item.enabled && 'is-on',
                item.engaged && 'is-engaged',
              )}
              aria-pressed={item.enabled}
              title={item.hint}
              aria-label={`${item.labelZh} ${item.labelEn}`}
              onClick={() => actions.setAssist(item.id, !item.enabled)}
            >
              <Icon size={12} />
              <b className="tv-mono">{item.code}</b>
              <i className="tv-assist__dot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={cx('tv-assists__master', assist.master && 'is-on')}
        aria-pressed={assist.master}
        onClick={() => actions.toggleAssists()}
        title="辅助驾驶总开关（Y）"
      >
        <span className="tv-assists__master-label">
          辅助驾驶
          <em className="tv-mono">FLIGHT AIDS</em>
        </span>
        <span className="tv-assists__master-state tv-mono">
          {assist.master ? 'ON' : 'OFF'}
          <Keycap>Y</Keycap>
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Startup checklist                                                   */
/* ------------------------------------------------------------------ */

export interface StartupChecklistProps {
  className?: string;
  tutorial?: TutorialState;
}

/**
 * The brief that appears the moment the mission starts: seven tickable lines
 * that complete themselves as the pilot actually performs each action.
 */
export function StartupChecklist({ className, tutorial }: StartupChecklistProps) {
  const snapshot = useCockpit();
  const actions = useCockpitActions();
  const state = tutorial ?? snapshot.tutorial;
  if (!state.visible) return null;
  const ratio = state.total > 0 ? state.completed / state.total : 0;
  return (
    <section
      className={cx('tv-tutorial', state.completed >= state.total && 'is-complete', className)}
      aria-label="起飞操作说明"
      data-tv-ui="true"
    >
      <header className="tv-tutorial__head">
        <span className="tv-tutorial__eyebrow">
          <i aria-hidden="true" />
          FIRST FLIGHT CHECK / 简要操作说明
        </span>
        <span className="tv-tutorial__count tv-mono">
          {state.completed}/{state.total}
          <button
            type="button"
            className="tv-tutorial__close"
            aria-label="关闭操作说明"
            onClick={actions.dismissTutorial}
          >
            <IconClose size={11} />
          </button>
        </span>
      </header>
      <ol className="tv-tutorial__list">
        {state.steps.map((step) => (
          <li key={step.id} className={cx('tv-tutorial__step', step.done && 'is-done')}>
            <span className="tv-tutorial__tick" aria-hidden="true">
              {step.done ? <IconCheck size={10} /> : null}
            </span>
            <span className="tv-tutorial__keys">
              {step.keys.map((key) => (
                <Keycap key={key}>{key}</Keycap>
              ))}
            </span>
            <span className="tv-tutorial__text">
              {step.labelZh}
              <em className="tv-mono">{step.labelEn}</em>
            </span>
          </li>
        ))}
      </ol>
      <footer className="tv-tutorial__foot">
        <span className="tv-tutorial__bar" aria-hidden="true">
          <i style={{ width: `${Math.round(ratio * 100)}%` }} />
        </span>
        <span className="tv-mono">
          {state.completed >= state.total ? '检查单完成 · 自由交战' : 'H 呼出飞行手册 · Y 切换辅助驾驶'}
        </span>
      </footer>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* G readout with buffet warning                                       */
/* ------------------------------------------------------------------ */

export interface GLoadMeterProps {
  className?: string;
}

export function GLoadMeter({ className }: GLoadMeterProps) {
  const { flight } = useCockpit();
  const g = flight.gLoad;
  const tone = g >= 8.5 ? 'red' : g >= 6.5 ? 'amber' : 'cyan';
  return (
    <div className={cx('tv-gmeter', `tv-gmeter--${tone}`, className)}>
      <span className="tv-gmeter__label tv-mono">G</span>
      <strong className="tv-gmeter__value tv-mono">{g.toFixed(1)}</strong>
      <span className="tv-gmeter__track" aria-hidden="true">
        <i style={{ width: `${Math.min(100, ((g - 1) / 8.8) * 100)}%` }} />
      </span>
      {flight.postStall && (
        <StatusLamp tone="caution" label="POST STALL" className="tv-gmeter__flag" />
      )}
    </div>
  );
}
