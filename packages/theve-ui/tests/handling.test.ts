import { describe, expect, it } from 'vitest';
import { CockpitEngine } from '../src/sim/engine';
import { createDemoScenario } from '../src/sim/scenario';
import { MANEUVERS } from '../src/sim/maneuvers';
import { RAD } from '../src/sim/math';
import type { ManeuverId, SimEntity } from '../src/sim/types';

function advance(engine: CockpitEngine, seconds: number, dt = 1 / 60): void {
  const steps = Math.ceil(seconds / dt);
  for (let index = 0; index < steps; index += 1) engine.update(dt);
}

function startCombat(overrides: Parameters<typeof createDemoScenario>[0] = {}): CockpitEngine {
  const engine = new CockpitEngine(
    createDemoScenario({ enemies: [], requiredKills: 2, bossTriggerAt: 600, ...overrides }),
  );
  engine.launch();
  engine.skipBoot();
  return engine;
}

function headingDelta(from: number, to: number): number {
  const diff = Math.abs(to - from) % 360;
  return diff > 180 ? 360 - diff : diff;
}

describe('v0.2 flight feel', () => {
  it('spools roll rate up and back down instead of snapping between angles', () => {
    const engine = startCombat();
    engine.setInput({ roll: 1 });
    advance(engine, 0.1);
    const early = Math.abs(engine.flight.rollRate);
    advance(engine, 0.5);
    const settled = Math.abs(engine.flight.rollRate);
    expect(early).toBeGreaterThan(0.05);
    expect(settled).toBeGreaterThan(early);
    expect(settled).toBeLessThanOrEqual(3.7);

    engine.setInput({ roll: 0 });
    const bankAtRelease = engine.flight.roll;
    advance(engine, 1.2);
    expect(Math.abs(engine.flight.rollRate)).toBeLessThan(0.15);
    // Inertia carries the wing past the release point before it settles.
    expect(Math.abs(engine.flight.roll)).toBeGreaterThan(Math.abs(bankAtRelease));
  });

  it('bleeds speed climbing and gains it diving, without leaving the envelope', () => {
    const engine = startCombat();
    engine.setThrottle(0.75);
    engine.setInput({ pitch: 1 });
    advance(engine, 4);
    const climbSpeed = engine.flight.speed;

    engine.setInput({ pitch: -1 });
    advance(engine, 5);
    const diveSpeed = engine.flight.speed;

    expect(climbSpeed).toBeLessThan(diveSpeed);
    expect(diveSpeed).toBeLessThanOrEqual(330);
    expect(climbSpeed).toBeGreaterThanOrEqual(150);
  });

  it('scales control authority with airspeed', () => {
    const engine = startCombat();
    engine.setThrottle(0);
    engine.setInput({ pitch: 0 });
    advance(engine, 8);
    const slowSpeed = engine.flight.speed;

    engine.setInput({ roll: 1 });
    advance(engine, 1.2);
    const slowRollRate = Math.abs(engine.flight.rollRate);

    engine.setThrottle(1);
    advance(engine, 6);
    expect(engine.flight.speed).toBeGreaterThan(slowSpeed);
    const fastRollRate = Math.abs(engine.flight.rollRate);
    expect(fastRollRate).toBeGreaterThan(slowRollRate);
  });
});

describe('v0.2 fighter manoeuvres', () => {
  it('holds a high-G turn while the key is down and releases on let-go', () => {
    const engine = startCombat();
    expect(engine.startManeuver('highG')).toBe(true);
    engine.setInput({ pitch: 1 });
    advance(engine, 2);
    expect(engine.getSnapshot().maneuver.active).toBe('highG');
    expect(engine.flight.highG).toBe(true);
    expect(engine.flight.gLoad).toBeGreaterThan(6);

    engine.endManeuver('highG');
    advance(engine, 0.2);
    expect(engine.getSnapshot().maneuver.active).toBeNull();
    expect(engine.flight.highG).toBe(false);
  });

  it('refuses a high-G turn below its entry speed with a readable reason', () => {
    const engine = startCombat();
    engine.flight.speed = 120;
    expect(engine.startManeuver('highG')).toBe(false);
    const warning = engine.getSnapshot().warnings.find((item) => item.message === 'MANOEUVRE BLOCKED');
    expect(warning).toBeDefined();
    const highG = engine.getSnapshot().maneuver.list.find((item) => item.id === 'highG');
    expect(highG?.available).toBe(false);
    expect(highG?.blocked).toContain('速度');
  });

  it('pulls the airbrake to bleed speed quickly', () => {
    const engine = startCombat();
    engine.setThrottle(0.9);
    advance(engine, 3);
    const before = engine.flight.speed;
    engine.startManeuver('airbrake');
    advance(engine, 2.4);
    expect(engine.flight.airbrake).toBe(true);
    expect(before - engine.flight.speed).toBeGreaterThan(60);
    engine.endManeuver('airbrake');
    advance(engine, 0.1);
    expect(engine.flight.airbrake).toBe(false);
  });

  it('flies a cobra past the normal pitch envelope and recovers the attitude', () => {
    const engine = startCombat();
    expect(engine.flight.speed).toBeGreaterThan(MANEUVERS.cobra.minSpeed);
    expect(engine.startManeuver('cobra')).toBe(true);

    advance(engine, 0.85);
    expect(engine.flight.pitch).toBeGreaterThan(1.6);
    expect(engine.getSnapshot().flight.postStall).toBe(true);
    expect(engine.getSnapshot().flight.pitch).toBeLessThanOrEqual(90);

    advance(engine, MANEUVERS.cobra.duration);
    expect(engine.getSnapshot().maneuver.active).toBeNull();
    expect(Math.abs(engine.flight.pitch)).toBeLessThanOrEqual(1.35);
    const lowSpeed = engine.flight.speed;

    advance(engine, 3);
    expect(engine.flight.speed).toBeGreaterThan(lowSpeed);
  });

  it('breaks an incoming missile lock with a barrel roll', () => {
    const engine = startCombat({ enemies: [{ callsign: 'SEEKER', distance: 2600, side: 0, vertical: 0 }] });
    advance(engine, 6);
    engine.startManeuver('barrelRoll');
    engine.cancelManeuvers();
    const internal = engine as unknown as { fireEnemyMissile: (enemy: SimEntity) => void };
    const enemy = engine.getEntities().find((entity) => entity.kind === 'fighter');
    expect(enemy).toBeDefined();
    internal.fireEnemyMissile(enemy as SimEntity);

    const rollBefore = engine.flight.roll;
    expect(engine.startManeuver('barrelRoll')).toBe(true);
    advance(engine, MANEUVERS.barrelRoll.duration + 0.05);
    // A full 360° roll lands back on the entry bank angle.
    expect(Math.abs(engine.flight.roll - rollBefore)).toBeLessThan(0.25);
    expect(engine.getEntities().some((entity) => entity.kind === 'missile' && entity.alive)).toBe(false);
  });

  it('reverses heading downhill with a split-S and uphill with an immelmann', () => {
    const split = startCombat();
    const splitHeading = split.getSnapshot().flight.heading;
    const splitAltitude = split.flight.position.y;
    expect(split.startManeuver('splitS')).toBe(true);
    advance(split, MANEUVERS.splitS.duration + 0.1);
    expect(split.getSnapshot().maneuver.active).toBeNull();
    expect(headingDelta(splitHeading, split.getSnapshot().flight.heading)).toBeGreaterThan(150);
    expect(split.flight.position.y).toBeLessThan(splitAltitude);
    expect(Math.abs(split.flight.pitch)).toBeLessThanOrEqual(1.35);
    expect(split.flight.speed).toBeGreaterThan(MANEUVERS.splitS.minSpeed);

    const immelmann = startCombat();
    const immelmannHeading = immelmann.getSnapshot().flight.heading;
    const immelmannAltitude = immelmann.flight.position.y;
    expect(immelmann.startManeuver('immelmann')).toBe(true);
    advance(immelmann, MANEUVERS.immelmann.duration + 0.1);
    expect(immelmann.getSnapshot().maneuver.active).toBeNull();
    expect(headingDelta(immelmannHeading, immelmann.getSnapshot().flight.heading)).toBeGreaterThan(150);
    expect(immelmann.flight.position.y).toBeGreaterThan(immelmannAltitude);
    expect(Math.abs(immelmann.flight.pitch)).toBeLessThanOrEqual(1.35);
  });

  it('loops a full 360° with the kulbit and returns to the entry attitude', () => {
    const engine = startCombat();
    const entryPitch = engine.flight.pitch;
    const entryRoll = engine.flight.roll;
    expect(engine.startManeuver('kulbit')).toBe(true);
    advance(engine, 1.2);
    expect(Math.abs(engine.flight.pitch)).toBeGreaterThan(1.6);
    advance(engine, MANEUVERS.kulbit.duration);
    expect(engine.getSnapshot().maneuver.active).toBeNull();
    expect(Math.abs(engine.flight.pitch - entryPitch)).toBeLessThan(0.06);
    expect(Math.abs(engine.flight.roll - entryRoll)).toBeLessThan(0.02);
  });

  it('exposes every manoeuvre with a key and a stable order', () => {
    const engine = startCombat();
    const list = engine.getSnapshot().maneuver.list;
    expect(list).toHaveLength(7);
    expect(list.map((item) => item.id)).toEqual([
      'highG',
      'airbrake',
      'cobra',
      'barrelRoll',
      'splitS',
      'immelmann',
      'kulbit',
    ]);
    for (const item of list) {
      expect(item.key.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('v0.2 flight aids', () => {
  it('nudges the nose onto an off-axis target and yields to pilot rudder', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'OFFSET', distance: 2200, side: 900, vertical: 120 }],
    });
    advance(engine, 1.5);
    const target = engine.getEntities().find((entity) => entity.kind === 'fighter');
    expect(target).toBeDefined();
    engine.selectTarget(target!.id);
    advance(engine, 1.2);
    const assisted = engine.getSnapshot().lock.steering;

    engine.startManeuver; // keep the reference explicit for readability
    const manual = startCombat({
      enemies: [{ callsign: 'OFFSET', distance: 2200, side: 900, vertical: 120 }],
    });
    advance(manual, 1.5);
    manual.setAssist('steering', false);
    const manualTarget = manual.getEntities().find((entity) => entity.kind === 'fighter');
    manual.selectTarget(manualTarget!.id);
    advance(manual, 1.2);

    expect(Math.abs(assisted)).toBeLessThan(Math.abs(manual.getSnapshot().lock.steering));
    expect(engine.getSnapshot().lock.assisted).toBe(true);
  });

  it('levels the wings when the stick is centred but leaves a held bank alone', () => {
    const engine = startCombat();
    engine.flight.roll = 0.16;
    engine.flight.rollRate = 0.4;
    advance(engine, 1.5);
    expect(Math.abs(engine.flight.roll)).toBeLessThan(0.05);

    engine.setInput({ roll: 1 });
    advance(engine, 0.9);
    const bank = engine.flight.roll;
    expect(Math.abs(bank)).toBeGreaterThan(0.6);
    engine.setInput({ roll: 0 });
    advance(engine, 0.4);
    expect(Math.abs(engine.flight.roll)).toBeGreaterThan(0.45);
  });

  it('never overrules a full-throttle order with the auto throttle', () => {
    const engine = startCombat();
    engine.setThrottle(1);
    advance(engine, 4);
    expect(engine.flight.throttle).toBeGreaterThan(0.95);
    expect(engine.flight.afterburner).toBe(true);
  });

  it('raises the throttle to recover energy when the pilot leaves it alone', () => {
    const engine = startCombat();
    engine.setThrottle(0.3);
    advance(engine, 6);
    expect(engine.flight.throttle).toBeGreaterThan(0.55);
    const assist = engine.getSnapshot().assist;
    expect(assist.master).toBe(true);
    expect(assist.list.find((item) => item.id === 'throttle')?.enabled).toBe(true);
  });

  it('guards low altitude and can be switched off entirely', () => {
    const engine = startCombat();
    engine.flight.position.y = 620;
    engine.flight.pitch = -0.5;
    advance(engine, 0.6);
    expect(engine.getSnapshot().warnings.some((warning) => warning.kind === 'terrain')).toBe(true);
    expect(engine.getSnapshot().assist.engaged).toContain('terrain');

    engine.toggleAssists();
    advance(engine, 0.3);
    expect(engine.getSnapshot().assist.master).toBe(false);
    expect(engine.getSnapshot().assist.engaged).toHaveLength(0);
    for (const item of engine.getSnapshot().assist.list) expect(item.enabled).toBe(false);
  });
});

describe('v0.2 startup checklist', () => {
  it('ticks off the brief instructions as the pilot actually flies them', () => {
    const engine = startCombat({ enemies: [{ callsign: 'TARGET', distance: 1800, side: 0, vertical: 0 }] });
    const initial = engine.getSnapshot().tutorial;
    expect(initial.total).toBe(7);
    expect(initial.visible).toBe(true);
    expect(initial.completed).toBe(0);

    engine.setInput({ pitch: 0.6, roll: 0.6 });
    advance(engine, 0.2);
    engine.setInput({ pitch: 0, roll: 0 });
    engine.adjustThrottle(0.1);
    engine.cycleTarget();
    advance(engine, 2.4);
    expect(engine.getSnapshot().tutorial.completed).toBeGreaterThanOrEqual(4);
    expect(
      engine.getSnapshot().tutorial.steps.find((step) => step.id === 'lock')?.done,
    ).toBe(true);

    engine.startManeuver('airbrake');
    engine.endManeuver('airbrake');
    engine.flare();
    engine.fireMissile();
    const done = engine.getSnapshot().tutorial;
    expect(done.completed).toBe(done.total);
  });

  it('can be dismissed and does not come back on its own', () => {
    const engine = startCombat();
    engine.dismissTutorial();
    advance(engine, 1);
    expect(engine.getSnapshot().tutorial.visible).toBe(false);
    engine.restartTutorial();
    expect(engine.getSnapshot().tutorial.visible).toBe(true);
  });
});

describe('v0.2 attitude bookkeeping', () => {
  it('keeps heading readable while looping through vertical attitudes', () => {
    const engine = startCombat();
    engine.startManeuver('immelmann');
    advance(engine, MANEUVERS.immelmann.duration * 0.5);
    const snapshot = engine.getSnapshot();
    expect(snapshot.flight.pitchRaw).toBeGreaterThan(60);
    expect(snapshot.flight.inverted).toBe(true);
    expect(snapshot.flight.heading).toBeGreaterThanOrEqual(0);
    expect(snapshot.flight.heading).toBeLessThan(360);
    advance(engine, MANEUVERS.immelmann.duration);
    expect(engine.getSnapshot().flight.inverted).toBe(false);
  });

  it('reports manoeuvre progress for the HUD timeline', () => {
    const engine = startCombat();
    const ids: ManeuverId[] = ['cobra'];
    for (const id of ids) {
      engine.startManeuver(id);
      advance(engine, MANEUVERS[id].duration * 0.5);
      const progress = engine.getSnapshot().maneuver.progress;
      expect(progress).toBeGreaterThan(0.35);
      expect(progress).toBeLessThan(0.75);
      expect(engine.getSnapshot().maneuver.activeCode).toBe(MANEUVERS[id].code);
      advance(engine, MANEUVERS[id].duration);
    }
  });

  it('keeps raw pitch in degrees for the ladder and the raw value for the camera', () => {
    const engine = startCombat();
    engine.setInput({ pitch: 1 });
    advance(engine, 3);
    const snapshot = engine.getSnapshot();
    expect(snapshot.flight.pitch).toBeCloseTo(PITCH_LIMIT_DEG, 0);
    expect(snapshot.flight.pitchRaw).toBeCloseTo(snapshot.flight.pitch, 3);
    expect(engine.getFlight().pitch).toBeCloseTo(snapshot.flight.pitchRaw / RAD, 4);
  });
});

const PITCH_LIMIT_DEG = 1.35 * RAD;

describe('v0.2 soak', () => {
  it('stays finite and playable through a full sortie with constant input churn', () => {
    const engine = new CockpitEngine(
      createDemoScenario({ requiredKills: 2, bossTriggerAt: 12 }),
    );
    engine.launch();
    engine.skipBoot();

    const maneuvers: ManeuverId[] = [
      'highG',
      'airbrake',
      'cobra',
      'barrelRoll',
      'splitS',
      'immelmann',
      'kulbit',
    ];
    let seed = 1337;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let step = 0; step < 60 * 90; step += 1) {
      if (step % 12 === 0) {
        engine.setInput({
          pitch: random() * 2 - 1,
          roll: random() * 2 - 1,
          yaw: (random() * 2 - 1) * 0.5,
        });
      }
      if (step % 37 === 0) engine.setThrottle(random());
      if (step % 53 === 0) engine.cycleTarget();
      if (step % 71 === 0) engine.fire();
      if (step % 97 === 0) engine.flare();
      if (step % 29 === 0) {
        const id = maneuvers[Math.floor(random() * maneuvers.length)]!;
        if (random() > 0.5) engine.startManeuver(id);
        else engine.endManeuver(id);
      }
      if (step % 211 === 0) engine.toggleAssists();
      engine.update(1 / 60);

      const flight = engine.flight;
      expect(Number.isFinite(flight.position.x)).toBe(true);
      expect(Number.isFinite(flight.position.y)).toBe(true);
      expect(Number.isFinite(flight.position.z)).toBe(true);
      expect(Number.isFinite(flight.yaw)).toBe(true);
      expect(Number.isFinite(flight.pitch)).toBe(true);
      expect(Number.isFinite(flight.roll)).toBe(true);
      expect(Number.isFinite(flight.speed)).toBe(true);
      expect(Number.isFinite(flight.gLoad)).toBe(true);
      expect(flight.position.y).toBeGreaterThanOrEqual(140);
      expect(flight.position.y).toBeLessThanOrEqual(14000);
      expect(Math.abs(flight.pitch)).toBeLessThanOrEqual(2 * Math.PI + 0.5);
      expect(flight.speed).toBeGreaterThanOrEqual(100);
      expect(flight.speed).toBeLessThanOrEqual(331);
    }

    expect(['dogfight', 'boss-intro', 'boss', 'complete', 'failed']).toContain(engine.phase);
    const snapshot = engine.getSnapshot();
    expect(snapshot.maneuver.list).toHaveLength(7);
    expect(snapshot.assist.list).toHaveLength(4);
    expect(snapshot.tutorial.steps).toHaveLength(7);
  });

  it('always returns to the normal pitch envelope once a scripted manoeuvre ends', () => {
    const ids: ManeuverId[] = ['cobra', 'barrelRoll', 'splitS', 'immelmann', 'kulbit'];
    for (const id of ids) {
      const engine = startCombat();
      engine.startManeuver(id);
      advance(engine, MANEUVERS[id].duration + 0.5);
      expect(engine.getSnapshot().maneuver.active).toBeNull();
      expect(Math.abs(engine.flight.pitch)).toBeLessThanOrEqual(1.35);
      expect(Number.isFinite(engine.flight.yaw)).toBe(true);
      expect(Number.isFinite(engine.flight.roll)).toBe(true);
    }
  });
});

