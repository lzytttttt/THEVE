import { useCockpit, useCockpitActions } from '../sim/CockpitProvider';
import { cx } from '../primitives';
import { AltitudeTape, FlightPathMarker, HeadingTape, PitchLadder, SpeedTape } from './instruments';
import { DamageOverlay, LockReticle, MissileWarning, TargetMarker } from './targets';
import {
  BossBar,
  CommsFeed,
  ObjectiveTracker,
  RadarScope,
  ScoreTicker,
  WeaponRack,
  WingmanStatus,
} from './systems';
import {
  FlightAidStrip,
  GLoadMeter,
  LockSteeringCue,
  ManeuverBanner,
  StartupChecklist,
} from './maneuvers';

export interface CockpitHudProps {
  className?: string;
  showComms?: boolean;
  showWeaponRack?: boolean;
  /** The v0.2 first-flight checklist. On by default. */
  showChecklist?: boolean;
  showAidStrip?: boolean;
}

/**
 * The composed HUD. All readouts are driven by the 30 Hz snapshot; individual
 * instruments are also exported separately for custom layouts.
 */
export function CockpitHud({
  className,
  showComms = true,
  showWeaponRack = true,
  showChecklist = true,
  showAidStrip = true,
}: CockpitHudProps) {
  const snapshot = useCockpit();
  const actions = useCockpitActions();
  const {
    flight,
    lock,
    weapons,
    targets,
    radar,
    warnings,
    comms,
    wingman,
    boss,
    mission,
    phase,
  } = snapshot;

  const selected = targets.find((target) => target.selected && target.lockable) ?? null;
  const visibleTargets = targets.filter(
    (target) => target.screen.onScreen || target.selected,
  );

  return (
    <div className={cx('tv-hud', `tv-hud--${phase}`, className)}>
      <div className="tv-hud__heading">
        <HeadingTape heading={flight.heading} />
        <div className="tv-hud__heading-meta tv-mono">
          <span>{snapshot.operation}</span>
          <span>{Math.round(flight.altitude)} M</span>
        </div>
      </div>

      <div className="tv-hud__objective">
        <ObjectiveTracker phase={phase} mission={mission} />
      </div>

      <div className="tv-hud__score">
        <ScoreTicker score={mission.score} stats={mission.stats} />
      </div>

      <div className="tv-hud__speed">
        <SpeedTape
          knots={flight.knots}
          mach={flight.mach}
          afterburner={flight.afterburner}
        />
      </div>
      <div className="tv-hud__altitude">
        <AltitudeTape altitude={flight.altitude} verticalSpeed={flight.verticalSpeed} />
      </div>

      <div className="tv-hud__center">
        <PitchLadder pitch={flight.pitch} roll={flight.roll} />
        <FlightPathMarker />
        {visibleTargets.map((target) => (
          <TargetMarker
            key={target.id}
            target={target}
            onSelect={target.lockable ? actions.selectTarget : undefined}
          />
        ))}
        <LockReticle target={selected} />
        <LockSteeringCue />
      </div>

      {showAidStrip && (
        <div className="tv-hud__aid">
          <FlightAidStrip />
          <GLoadMeter />
        </div>
      )}

      <div className="tv-hud__maneuver">
        <ManeuverBanner />
      </div>

      <MissileWarning warnings={warnings} />

      {showWeaponRack && (
        <div className="tv-hud__weapons">
          <WeaponRack
            weapons={weapons}
            lock={lock}
            onSelect={actions.selectWeapon}
            onFlare={actions.flare}
          />
        </div>
      )}

      <div className="tv-hud__radar">
        <RadarScope contacts={radar} heading={flight.heading} />
      </div>

      <div className="tv-hud__comms">
        {showComms && <CommsFeed messages={comms} />}
        <WingmanStatus wingman={wingman} />
      </div>

      {boss && <BossBar boss={boss} className="tv-hud__boss" />}

      {showChecklist && (
        <div className="tv-hud__tutorial">
          <StartupChecklist />
        </div>
      )}

      <div className="tv-hud__footer tv-mono" aria-hidden="true">
        <span>THEVE // TACS-8 · FCS {flight.airbrake ? 'BRAKE' : flight.highG ? 'HIGH-G' : 'NOMINAL'}</span>
        <span>IFF ONLINE · LINK 08</span>
        <span>HDG {Math.round(flight.heading).toString().padStart(3, '0')} · G {flight.gLoad.toFixed(1)}</span>
      </div>

      <DamageOverlay
        hpRatio={flight.hp / flight.maxHp}
        warnings={warnings}
        phase={phase}
      />
    </div>
  );
}
