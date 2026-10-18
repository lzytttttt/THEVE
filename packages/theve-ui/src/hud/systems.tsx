import type { CSSProperties } from 'react';
import { cx, Keycap, Meter } from '../primitives';
import { IconCrosshair, IconMissile, IconPlane, IconShield, IconWarning } from '../icons';
import { formatClock, formatInt, formatRange } from './format';
import type {
  BossHud,
  CockpitSnapshot,
  CommsMessage,
  LockState,
  MissionPhase,
  RadarContact,
  WingmanHud,
} from '../sim/types';

export interface RadarScopeProps {
  contacts: RadarContact[];
  heading: number;
  className?: string;
}

export function RadarScope({ contacts, heading, className }: RadarScopeProps) {
  const hostiles = contacts.filter((contact) => contact.team === 'hostile').length;
  return (
    <div
      className={cx('tv-radar', className)}
      role="img"
      aria-label={`雷达，${hostiles} 个敌方接触，航向 ${Math.round(heading)} 度`}
    >
      <div className="tv-radar__head">
        <span className="tv-radar__title">TACTICAL RADAR</span>
        <span className="tv-radar__range tv-mono">9 KM</span>
      </div>
      <div className="tv-radar__scope">
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <defs>
            <radialGradient id="tv-radar-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(99,243,255,0.12)" />
              <stop offset="100%" stopColor="rgba(99,243,255,0)" />
            </radialGradient>
            <linearGradient id="tv-radar-sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(99,243,255,0.3)" />
              <stop offset="100%" stopColor="rgba(99,243,255,0)" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="220" height="220" fill="url(#tv-radar-glow)" />
          <g className="tv-radar__grid">
            <circle cx="110" cy="110" r="96" />
            <circle cx="110" cy="110" r="64" />
            <circle cx="110" cy="110" r="32" />
            <path d="M110 14v192M14 110h192" />
            <path d="m42 42 136 136M178 42 42 178" className="tv-radar__diag" />
            <path d="M110 14v10M110 196v10M14 110h10M196 110h10" />
          </g>
          <g className="tv-radar__sweep">
            <path d="M110 110 110 16a94 94 0 0 1 58 20Z" fill="url(#tv-radar-sweep)" />
            <path d="M110 110 110 16" />
          </g>
          <g className="tv-radar__cardinals">
            <text x="110" y="9">N</text>
            <text x="215" y="114">E</text>
            <text x="110" y="218">S</text>
            <text x="5" y="114">W</text>
          </g>
          <g transform={`rotate(${heading} 110 110)`} className="tv-radar__own">
            <path d="M110 94 118 120 110 114 102 120Z" />
          </g>
          {contacts.map((contact) => (
            <RadarContactMark key={contact.id} contact={contact} />
          ))}
        </svg>
        <span className="tv-radar__ring-label tv-mono">R 030</span>
      </div>
      <div className="tv-radar__foot">
        <span className="tv-status-lamp tv-status-lamp--nominal">
          <span className="tv-status-lamp__dot" aria-hidden="true" />
          LINK OK
        </span>
        <span className="tv-mono">{contacts.length} TRACKS</span>
      </div>
    </div>
  );
}

function RadarContactMark({ contact }: { contact: RadarContact }) {
  const markX = 110 + contact.x * 84;
  const markY = 110 + contact.y * 84;
  const color = contact.team === 'ally' ? 'tv-radar__contact--ally' : 'tv-radar__contact--hostile';
  const kind = contact.kind === 'weakpoint' ? 'tv-radar__contact--weakpoint' : '';
  return (
    <g className={cx('tv-radar__contact', color, kind, contact.selected && 'is-selected')}>
      <circle
        cx={markX}
        cy={markY}
        r={contact.selected ? 7 : 4.5}
        className="tv-radar__contact-ring"
      />
      {contact.kind === 'fighter' && (
        <path
          d={`M${markX} ${markY - 4.5} L${markX + 4} ${markY + 3.5} L${markX} ${markY + 1.5} L${markX - 4} ${markY + 3.5} Z`}
        />
      )}
      {contact.kind === 'wingman' && (
        <rect
          x={markX - 3}
          y={markY - 3}
          width="6"
          height="6"
          transform={`rotate(45 ${markX} ${markY})`}
        />
      )}
      {contact.kind === 'weakpoint' && (
        <path
          d={`M${markX} ${markY - 5} L${markX + 5} ${markY} L${markX} ${markY + 5} L${markX - 5} ${markY} Z`}
        />
      )}
    </g>
  );
}

export interface CommsFeedProps {
  messages: CommsMessage[];
  className?: string;
}

export function CommsFeed({ messages, className }: CommsFeedProps) {
  return (
    <div className={cx('tv-comms', className)} role="log" aria-live="polite" aria-relevant="additions">
      <div className="tv-comms__head">
        <span className="tv-comms__title">TACTICAL COMMS</span>
        <span className="tv-comms__channel tv-mono">CH 08 · SECURE</span>
      </div>
      <ol className="tv-comms__list">
        {messages.slice(-4).map((message) => (
          <li key={message.id} className={cx('tv-comms__item', `tv-comms__item--${message.role}`)}>
            <span className="tv-comms__from tv-mono">{message.from}</span>
            <span className="tv-comms__time tv-mono">{formatClock(message.at)}</span>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface WingmanStatusProps {
  wingman: WingmanHud | null;
  className?: string;
}

export function WingmanStatus({ wingman, className }: WingmanStatusProps) {
  if (!wingman) return null;
  return (
    <div className={cx('tv-wingman', className)}>
      <span className="tv-wingman__icon">
        <IconPlane size={14} />
      </span>
      <div className="tv-wingman__body">
        <div className="tv-wingman__head">
          <strong className="tv-mono">{wingman.callsign}</strong>
          <span className="tv-wingman__state">{wingman.state}</span>
        </div>
        <div className="tv-wingman__meta tv-mono">
          <span>RNG {formatRange(wingman.distance)}</span>
          <span>HULL {Math.round((wingman.hp / wingman.maxHp) * 100)}%</span>
        </div>
        <Meter
          value={wingman.hp}
          max={wingman.maxHp}
          segments={10}
          tone="green"
          ariaLabel="僚机机体完整度"
          className="tv-wingman__meter"
        />
      </div>
    </div>
  );
}

export interface WeaponRackProps {
  weapons: CockpitSnapshot['weapons'];
  lock: LockState;
  onSelect?: (weapon: 'aam' | 'gun') => void;
  onFlare?: () => void;
  className?: string;
}

export function WeaponRack({ weapons, lock, onSelect, onFlare, className }: WeaponRackProps) {
  return (
    <div className={cx('tv-weapons', className)} data-tv-ui="true">
      <div className="tv-weapons__head">
        <span className="tv-weapons__title">ARMAMENT</span>
        <span className="tv-weapons__lockstate tv-mono">
          <i className={cx('tv-weapons__lamp', lock.state === 'locked' && 'is-locked')} />
          {lock.state === 'locked' ? 'LOCK' : lock.state === 'searching' ? 'SEEK' : 'SAFE'}
        </span>
      </div>
      <button
        type="button"
        className={cx('tv-weapon', weapons.selected === 'aam' && 'is-active')}
        aria-pressed={weapons.selected === 'aam'}
        onClick={() => onSelect?.('aam')}
      >
        <span className="tv-weapon__icon"><IconMissile size={16} /></span>
        <span className="tv-weapon__main">
          <strong>AAM</strong>
          <span className="tv-mono">AIM-118 · ×{weapons.missiles}</span>
        </span>
        <span className="tv-weapon__pips" aria-hidden="true">
          {Array.from({ length: weapons.maxMissiles }, (_, index) => (
            <i key={index} className={index < weapons.missiles ? 'is-on' : ''} />
          ))}
        </span>
        <Keycap>1</Keycap>
      </button>
      <button
        type="button"
        className={cx('tv-weapon', weapons.selected === 'gun' && 'is-active')}
        aria-pressed={weapons.selected === 'gun'}
        onClick={() => onSelect?.('gun')}
      >
        <span className="tv-weapon__icon"><IconCrosshair size={16} /></span>
        <span className="tv-weapon__main">
          <strong>GUN</strong>
          <span className="tv-mono">20 MM · {weapons.gunAmmo}</span>
        </span>
        <span className="tv-weapon__gauge">
          <i style={{ width: `${(weapons.gunAmmo / weapons.gunMax) * 100}%` }} />
        </span>
        <Keycap>2</Keycap>
      </button>
      <button type="button" className="tv-weapon tv-weapon--flare" onClick={onFlare}>
        <span className="tv-weapon__icon"><IconShield size={16} /></span>
        <span className="tv-weapon__main">
          <strong>FLARE</strong>
          <span className="tv-mono">×{weapons.flares}</span>
        </span>
        <Keycap>F</Keycap>
      </button>
      <div className="tv-weapons__target">
        <span>TGT</span>
        <strong className="tv-mono">{lock.callsign ?? '--- ---'}</strong>
        <span className="tv-mono">{lock.targetId ? formatRange(lock.distance) : 'NO CONTACT'}</span>
      </div>
    </div>
  );
}

export interface BossBarProps {
  boss: BossHud;
  className?: string;
}

export function BossBar({ boss, className }: BossBarProps) {
  const ratio = boss.maxHp > 0 ? Math.max(0, boss.hp / boss.maxHp) : 0;
  const stageLabel =
    boss.hp <= 0 ? 'DESTROYED' : boss.stage === 3 ? 'CORE EXPOSED' : boss.stage === 2 ? 'SHIELD FAILURE' : 'SHIELD LAYER';
  const attack = boss.hp > 0 ? boss.attack : null;
  return (
    <div
      className={cx(
        'tv-boss',
        boss.hp <= 0 && 'is-destroyed',
        attack && `is-attacking is-${attack.phase}`,
        className,
      )}
      data-stage={boss.stage}
    >
      <div className="tv-boss__head">
        <span className="tv-boss__warning">
          <IconWarning size={12} /> MASSIVE CONTACT
        </span>
        <span className="tv-boss__stage tv-mono">
          {boss.stageCode} · {boss.distance < 1000 ? `${Math.round(boss.distance)}m` : formatRange(boss.distance)}
        </span>
      </div>
      <div className="tv-boss__name">
        <strong>{boss.nameEn}</strong>
        <span>{boss.nameZh}</span>
        <em className="tv-mono">{boss.callsign}</em>
        <span className={cx('tv-boss__condition', boss.tooClose && 'is-close')}>
          {boss.hp <= 0 ? stageLabel : boss.tooClose ? '护盾电容充能中' : boss.stageLabel}
        </span>
      </div>
      <div
        className="tv-boss__bar"
        role="meter"
        aria-label="战争巨兽结构完整度"
        aria-valuemin={0}
        aria-valuemax={boss.maxHp}
        aria-valuenow={Math.round(boss.hp)}
      >
        <span className="tv-boss__fill" style={{ width: `${ratio * 100}%` }} />
        <span className="tv-boss__ticks" aria-hidden="true" />
        <span className="tv-boss__pct tv-mono">{Math.round(ratio * 100)}%</span>
      </div>
      {attack ? (
        <div
          className={cx('tv-boss__attack', `is-${attack.severity}`)}
          role="status"
          aria-live="polite"
        >
          <div className="tv-boss__attack-head">
            <span className="tv-boss__attack-code tv-mono">{attack.code}</span>
            <strong>{attack.labelZh}</strong>
            <span className="tv-boss__attack-en tv-mono">{attack.labelEn}</span>
            <em className="tv-mono">
              {attack.phase === 'telegraph'
                ? `T-${attack.remaining.toFixed(1)}`
                : attack.phase === 'active'
                  ? 'LIVE'
                  : 'CLEAR'}
            </em>
          </div>
          <span className="tv-boss__attack-bar" aria-hidden="true">
            <i
              className={cx('tv-boss__attack-progress', `is-${attack.phase}`)}
              style={{ width: `${Math.round(attack.progress * 100)}%` }}
            />
          </span>
          <div className="tv-boss__attack-counter">
            <span className="tv-mono">
              {attack.counterCode ? `${attack.counterCode} · ` : ''}
              应对
            </span>
            <p>{attack.counterZh}</p>
          </div>
        </div>
      ) : boss.nextIn !== null && boss.hp > 0 && boss.nextIn < 6 ? (
        <p className="tv-boss__standby tv-mono">NEXT ATTACK IN {boss.nextIn.toFixed(1)}s</p>
      ) : null}
      <div className="tv-boss__weakpoints">
        {boss.weakpoints.map((weakpoint) => (
          <span
            key={weakpoint.key}
            className={cx(
              'tv-boss__weakpoint',
              weakpoint.destroyed && 'is-destroyed',
              weakpoint.targetable && 'is-targetable',
            )}
          >
            <i aria-hidden="true" />
            {weakpoint.label}
            <em className="tv-mono">
              {weakpoint.destroyed ? 'DOWN' : weakpoint.targetable ? 'OPEN' : 'SHIELDED'}
            </em>
          </span>
        ))}
      </div>
    </div>
  );
}

export interface ObjectiveTrackerProps {
  phase: MissionPhase;
  mission: CockpitSnapshot['mission'];
  className?: string;
}

export function ObjectiveTracker({ phase, mission, className }: ObjectiveTrackerProps) {
  const kills = Math.min(mission.kills, mission.requiredKills);
  return (
    <div className={cx('tv-objective', className)}>
      <div className="tv-objective__head">
        <span className="tv-objective__eyebrow">
          <i /> PRIMARY OBJECTIVE
        </span>
        <span className="tv-objective__phase tv-mono">{phase.toUpperCase()}</span>
      </div>
      <strong className="tv-objective__value" role="status" aria-live="polite">
        {mission.objectiveZh}
      </strong>
      <span className="tv-objective__en tv-mono">{mission.objective}</span>
      <div className="tv-objective__kills">
        <span className="tv-objective__kills-label">KILLS</span>
        <span className="tv-objective__pips" aria-hidden="true">
          {Array.from({ length: mission.requiredKills }, (_, index) => (
            <i key={index} className={index < kills ? 'is-on' : ''} />
          ))}
        </span>
        <span className="tv-mono">
          {kills}/{mission.requiredKills}
        </span>
      </div>
      <p className="tv-objective__hint">
        <span className="tv-mono">▸</span> {mission.hint}
      </p>
    </div>
  );
}

export interface ScoreTickerProps {
  score: number;
  stats: CockpitSnapshot['mission']['stats'];
  className?: string;
}

export function ScoreTicker({ score, stats, className }: ScoreTickerProps) {
  const accuracy =
    stats.missilesFired > 0 ? Math.round((stats.missilesHit / stats.missilesFired) * 100) : 0;
  return (
    <div className={cx('tv-score', className)}>
      <div className="tv-score__main">
        <span className="tv-score__label">SCORE</span>
        <strong className="tv-score__value tv-mono">{formatInt(score).padStart(6, '0')}</strong>
      </div>
      <div className="tv-score__row">
        <span>KILLS <b className="tv-mono">{stats.kills}</b></span>
        <span>ACC <b className="tv-mono">{accuracy}%</b></span>
        <span>DMG <b className="tv-mono">{stats.damageTaken}</b></span>
      </div>
    </div>
  );
}

export interface ThreatReadoutProps {
  warnings: CockpitSnapshot['warnings'];
  className?: string;
}

export function ThreatReadout({ warnings, className }: ThreatReadoutProps) {
  const warning = warnings[0];
  return (
    <div className={cx('tv-threat', warning && 'is-active', className)}>
      <span className="tv-threat__label">THREAT</span>
      <span className="tv-threat__light" aria-hidden="true" />
      <span className="tv-threat__value tv-mono">
        {warning ? warning.message : 'CLEAR'}
      </span>
    </div>
  );
}

export interface GForceReadoutProps {
  gLoad: number;
  style?: CSSProperties;
}

export function GForceReadout({ gLoad, style }: GForceReadoutProps) {
  return (
    <div className={cx('tv-gforce', gLoad > 7 && 'is-high')} style={style}>
      <span>G</span>
      <strong className="tv-mono">{gLoad.toFixed(1)}</strong>
    </div>
  );
}
