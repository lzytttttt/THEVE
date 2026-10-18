import { describe, expect, it } from 'vitest';
import { CockpitEngine } from '../src/sim/engine';
import { createDemoScenario } from '../src/sim/scenario';
import type { SimEntity } from '../src/sim/types';

function advance(engine: CockpitEngine, seconds: number): void {
  const steps = Math.ceil(seconds * 60);
  for (let index = 0; index < steps; index += 1) engine.update(1 / 60);
}

function startCombat(overrides: Parameters<typeof createDemoScenario>[0] = {}): CockpitEngine {
  const engine = new CockpitEngine(createDemoScenario(overrides));
  engine.launch();
  engine.skipBoot();
  return engine;
}

describe('CockpitEngine flight model', () => {
  it('boots into combat and keeps pitch, speed and throttle inside their envelopes', () => {
    const engine = new CockpitEngine(createDemoScenario({ enemies: [] }));
    expect(engine.phase).toBe('idle');
    engine.launch();
    expect(engine.phase).toBe('boot');
    engine.skipBoot();
    expect(engine.phase).toBe('dogfight');

    engine.setInput({ pitch: 1 });
    advance(engine, 1.5);
    expect(engine.flight.pitch).toBeGreaterThan(0.05);

    advance(engine, 6);
    expect(engine.flight.pitch).toBeLessThanOrEqual(1.351);
    expect(engine.flight.speed).toBeGreaterThan(150);
    expect(engine.flight.speed).toBeLessThanOrEqual(330);

    engine.setThrottle(1);
    advance(engine, 4);
    expect(engine.flight.speed).toBeLessThanOrEqual(330);
    expect(engine.flight.afterburner).toBe(true);
    const snapshot = engine.getSnapshot();
    expect(snapshot.flight.mach).toBeGreaterThan(0.6);
    expect(snapshot.flight.heading).toBeGreaterThanOrEqual(0);
    expect(snapshot.flight.heading).toBeLessThan(360);
  });

  it('stops simulation when paused', () => {
    const engine = startCombat({ enemies: [] });
    engine.pause();
    const before = engine.elapsed;
    advance(engine, 1);
    expect(engine.elapsed).toBe(before);
    engine.resume();
    advance(engine, 0.2);
    expect(engine.elapsed).toBeGreaterThan(before);
  });
});

describe('CockpitEngine targeting and weapons', () => {
  it('acquires a lock on a centered target and consumes a missile on fire', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'TARGET', distance: 1800, side: 0, vertical: 0 }],
      requiredKills: 2,
      bossTriggerAt: 600,
    });
    advance(engine, 1.6);
    const lock = engine.getSnapshot().lock;
    expect(lock.targetId).not.toBeNull();
    expect(lock.state).toBe('locked');
    expect(lock.progress).toBeGreaterThanOrEqual(0.99);

    engine.fireMissile();
    expect(engine.weapons.missiles).toBe(9);
    expect(engine.getSnapshot().mission.stats.missilesFired).toBe(1);
    expect(engine.getEntities().some((entity) => entity.kind === 'missile')).toBe(true);
  });

  it('refuses to launch a missile without a lock', () => {
    const engine = startCombat({
      enemies: [],
      requiredKills: 2,
      bossTriggerAt: 600,
    });
    engine.fireMissile();
    // v0.4 raised the rail to ten: three waves and a dreadnought is not an
    // eight-missile sortie.
    expect(engine.weapons.missiles).toBe(10);
    expect(engine.getSnapshot().warnings.some((warning) => warning.message === 'NO LOCK')).toBe(true);
  });

  it('deploys flares and spends the counter measure budget', () => {
    const engine = startCombat({ enemies: [], requiredKills: 2, bossTriggerAt: 600 });
    engine.flare();
    expect(engine.weapons.flares).toBe(5);
    expect(engine.getEntities().filter((entity) => entity.kind === 'flare').length).toBe(3);
    engine.flare();
    expect(engine.weapons.flares).toBe(5);
  });
});

describe('CockpitEngine mission state machine', () => {
  it('transitions from dogfight to boss and completes after the weak points fall', () => {
    const engine = startCombat({
      enemies: [],
      requiredKills: 0,
      bossTriggerAt: 0.01,
    });
    advance(engine, 0.2);
    expect(engine.phase).toBe('boss-intro');
    advance(engine, 3.2);
    expect(engine.phase).toBe('boss');
    const snapshot = engine.getSnapshot();
    expect(snapshot.boss).not.toBeNull();
    expect(snapshot.boss?.weakpoints).toHaveLength(3);

    const internal = engine as unknown as { destroyWeakpoint: (target: SimEntity) => void };
    for (const key of ['shieldL', 'shieldR', 'core'] as const) {
      const weakpoint = engine
        .getEntities()
        .find((entity) => entity.weakpoint?.key === key && entity.alive);
      expect(weakpoint).toBeDefined();
      internal.destroyWeakpoint(weakpoint as SimEntity);
      advance(engine, 0.15);
    }

    expect(engine.phase).toBe('boss');
    advance(engine, 4);
    expect(engine.phase).toBe('complete');
    const complete = engine.getSnapshot();
    expect(complete.mission.stats.rank).not.toBeNull();
    expect(complete.mission.score).toBeGreaterThan(3000);
    expect(complete.boss?.weakpoints.every((weakpoint) => weakpoint.hp === 0)).toBe(true);
  });

  it('fails when the airframe is destroyed', () => {
    const engine = startCombat({ enemies: [], requiredKills: 2, bossTriggerAt: 600 });
    engine.flight.hp = 0;
    advance(engine, 0.1);
    expect(engine.phase).toBe('failed');
    expect(engine.getSnapshot().mission.stats.rank).toBe('C');
  });
});
