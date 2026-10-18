import { useCockpit, useCockpitActions, useAudio } from '../sim/CockpitProvider';
import { cx, IconButton, Keycap } from '../primitives';
import {
  IconFlame,
  IconMissile,
  IconScan,
  IconSoundOff,
  IconSoundOn,
  IconTarget,
  IconWarning,
} from '../icons';
import { AssistRail, ManeuverRail } from './maneuvers';
import { AutoPilotButton } from './autopilot';

export interface CockpitControlsProps {
  className?: string;
}

/**
 * Physical-feeling command deck. Every action is also keyboard-accessible; the
 * deck keeps the experience playable with mouse or touch only.
 */
export function CockpitControls({ className }: CockpitControlsProps) {
  const snapshot = useCockpit();
  const actions = useCockpitActions();
  const audio = useAudio();
  const { weapons, lock, flight, maneuver, assist } = snapshot;
  const throttlePercent = Math.round(flight.throttle * 100);
  const afterburner = flight.throttle > 0.88;
  const activeManeuver = maneuver.list.find((item) => item.active) ?? null;

  const fire = () => {
    if (weapons.selected === 'gun') actions.startGun();
    else actions.fire();
  };

  return (
    <div className={cx('tv-controls', className)} data-tv-ui="true">
      <div className="tv-controls__module tv-controls__throttle">
        <div className="tv-controls__module-head">
          <span>THROTTLE</span>
          <span className={cx('tv-mono', afterburner && 'tv-amber')}>
            {flight.airbrake ? 'BRAKE' : afterburner ? 'AFTERBURNER' : 'MIL POWER'}
          </span>
        </div>
        <div className="tv-throttle">
          <button
            type="button"
            className="tv-throttle__step"
            aria-label="降低油门"
            onClick={() => actions.adjustThrottle(-0.05)}
          >
            −
          </button>
          <div className="tv-throttle__fader">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={throttlePercent}
              onChange={(event) => actions.setThrottle(Number(event.currentTarget.value) / 100)}
              aria-label="油门"
              aria-valuetext={`${throttlePercent}%`}
              className="tv-throttle__range"
            />
            <span className="tv-throttle__ticks" aria-hidden="true" />
          </div>
          <button
            type="button"
            className="tv-throttle__step"
            aria-label="增加油门"
            onClick={() => actions.adjustThrottle(0.05)}
          >
            +
          </button>
          <span className="tv-throttle__value tv-mono">
            {throttlePercent}
            <small>%</small>
          </span>
        </div>
      </div>

      <div className="tv-controls__module tv-controls__arms">
        <div className="tv-controls__module-head">
          <span>ARMAMENT</span>
          <span className="tv-mono">{lock.state === 'locked' ? 'LOCK' : 'SAFE'}</span>
        </div>
        <div className="tv-arms">
          <button
            type="button"
            className={cx('tv-arms__item', weapons.selected === 'aam' && 'is-active')}
            aria-pressed={weapons.selected === 'aam'}
            onClick={() => actions.selectWeapon('aam')}
          >
            <IconMissile size={16} />
            <span>AAM</span>
            <b className="tv-mono">×{weapons.missiles}</b>
            <Keycap>1</Keycap>
          </button>
          <button
            type="button"
            className={cx('tv-arms__item', weapons.selected === 'gun' && 'is-active')}
            aria-pressed={weapons.selected === 'gun'}
            onClick={() => actions.selectWeapon('gun')}
          >
            <IconWarning size={15} />
            <span>GUN</span>
            <b className="tv-mono">{weapons.gunAmmo}</b>
            <Keycap>2</Keycap>
          </button>
        </div>
        <div className="tv-arms__lock">
          <span className="tv-arms__lock-bar" aria-hidden="true">
            <i style={{ width: `${lock.progress * 100}%` }} />
          </span>
          <span className="tv-mono">{lock.callsign ?? 'NO TARGET'}</span>
        </div>
      </div>

      <div className="tv-controls__module tv-controls__maneuver">
        <div className="tv-controls__module-head">
          <span>MANOEUVRE</span>
          <span className="tv-mono">
            {activeManeuver ? activeManeuver.code : flight.postStall ? 'POST STALL' : 'READY'}
          </span>
        </div>
        <ManeuverRail compact />
      </div>

      <div className="tv-controls__module tv-controls__aids">
        <div className="tv-controls__module-head">
          <span>FLIGHT AIDS</span>
          <span className={cx('tv-mono', assist.engaged.length > 0 && 'tv-cyan')}>
            {assist.master ? `${assist.engaged.length} ACTIVE` : 'OFF'}
          </span>
        </div>
        <AssistRail compact />
      </div>

      <div className="tv-controls__module tv-controls__auto">
        <div className="tv-controls__module-head">
          <span>AUTO PILOT</span>
          <span className={cx('tv-mono', snapshot.auto.engaged && 'tv-cyan')}>
            {snapshot.auto.engaged ? snapshot.auto.code : 'MANUAL'}
          </span>
        </div>
        <AutoPilotButton />
      </div>

      <div className="tv-controls__module tv-controls__trigger">
        <div className="tv-controls__module-head">
          <span>WEAPON RELEASE</span>
          <span className="tv-mono">MASTER ARM</span>
        </div>
        <div className="tv-trigger">
          <button
            type="button"
            className={cx('tv-fire', lock.state === 'locked' && 'is-locked')}
            style={{ ['--tv-lock' as string]: `${Math.round(lock.progress * 100)}%` }}
            onPointerDown={fire}
            onPointerUp={() => actions.stopGun()}
            onPointerLeave={() => actions.stopGun()}
            onPointerCancel={() => actions.stopGun()}
            onClick={(event) => {
              if (event.detail === 0) actions.fire();
            }}
            aria-label={`发射当前武器（${weapons.selected === 'aam' ? '导弹' : '机炮'}）`}
          >
            <span className="tv-fire__ring" aria-hidden="true" />
            <span className="tv-fire__label">FIRE</span>
            <span className="tv-fire__sub tv-mono">{weapons.selected === 'aam' ? 'AAM' : 'GUN'}</span>
            <Keycap>SPACE</Keycap>
          </button>
          <div className="tv-trigger__aux">
            <button type="button" className="tv-aux" onClick={() => actions.flare()}>
              <IconFlame size={17} />
              <span>FLARE</span>
              <b className="tv-mono">{weapons.flares}</b>
              <Keycap>F</Keycap>
            </button>
            <button type="button" className="tv-aux" onClick={() => actions.cycleTarget()}>
              <IconTarget size={17} />
              <span>TARGET</span>
              <b className="tv-mono">TAB</b>
            </button>
          </div>
        </div>
      </div>

      <div className="tv-controls__utility">
        <IconButton
          label={assist.master ? '关闭辅助驾驶' : '开启辅助驾驶'}
          onClick={() => actions.toggleAssists()}
          className={cx('tv-controls__assist', assist.master && 'is-on')}
        >
          <IconScan size={15} />
        </IconButton>
        <IconButton
          label={audio.muted ? '取消静音' : '静音'}
          onClick={audio.toggleMute}
          className="tv-controls__audio"
        >
          {audio.muted ? <IconSoundOff size={15} /> : <IconSoundOn size={15} />}
        </IconButton>
      </div>
    </div>
  );
}
