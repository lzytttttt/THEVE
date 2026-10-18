import { describe, expect, it } from 'vitest';
import { CockpitEngine } from '../src/sim/engine';
import { createDemoScenario } from '../src/sim/scenario';
import { bearingDegrees, vec3 } from '../src/sim/math';
import type { SimEffect, SimEntity, SimEvent } from '../src/sim/types';

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

function record(engine: CockpitEngine): SimEvent[] {
  const events: SimEvent[] = [];
  engine.on((event) => events.push(event));
  return events;
}

function kinds(effects: readonly SimEffect[]): string[] {
  return effects.map((effect) => effect.kind);
}

describe('v0.3 damage bearing', () => {
  it('measures clockwise from the nose', () => {
    // yaw 0 looks toward -Z, so +X is ninety degrees to the right.
    expect(bearingDegrees(0, vec3(0, 0, 0), vec3(0, 0, -100))).toBeCloseTo(0, 4);
    expect(bearingDegrees(0, vec3(0, 0, 0), vec3(100, 0, 0))).toBeCloseTo(90, 4);
    expect(bearingDegrees(0, vec3(0, 0, 0), vec3(0, 0, 100))).toBeCloseTo(180, 4);
    expect(bearingDegrees(0, vec3(0, 0, 0), vec3(-100, 0, 0))).toBeCloseTo(270, 4);
    // A point directly overhead has no horizontal bearing; it must not produce NaN.
    expect(Number.isFinite(bearingDegrees(0.7, vec3(0, 0, 0), vec3(0, 50, 0)))).toBe(true);
  });
});

describe('v0.3 impact feedback', () => {
  it('turns a gun hit into sparks, a hit marker and a typed event', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'TARGET', distance: 900, side: 0, vertical: 0 }],
    });
    const events = record(engine);
    advance(engine, 0.4);

    engine.startGun();
    advance(engine, 1.2);
    engine.stopGun();

    const hits = events.filter((event) => event.type === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      if (hit.type !== 'hit') continue;
      expect(hit.mine).toBe(true);
      expect(hit.weapon).toBe('gun');
      expect(hit.kind).toBe('fighter');
    }
    expect(kinds(engine.getEffects())).toContain('spark');
    expect(kinds(engine.getEffects())).toContain('tracer');
    expect(kinds(engine.getEffects())).toContain('muzzle');

    const marker = engine.getSnapshot().combat.hit;
    expect(marker).not.toBeNull();
    expect(marker?.damage).toBeGreaterThan(0);
    expect(marker?.age).toBeLessThan(marker?.duration ?? 0);
  });

  it('expires the hit marker and ages every transient with the simulation clock', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'TARGET', distance: 900, side: 0, vertical: 0 }],
    });
    advance(engine, 0.4);
    engine.startGun();
    advance(engine, 0.6);
    engine.stopGun();
    expect(engine.getSnapshot().combat.hit).not.toBeNull();

    // Freezing the clock must freeze the feedback too.
    engine.pause();
    advance(engine, 1);
    expect(engine.getSnapshot().combat.hit).not.toBeNull();

    engine.resume();
    advance(engine, 1);
    expect(engine.getSnapshot().combat.hit).toBeNull();
  });

  it('records a kill with points, a callsign and wreckage', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'VESPER 9', variant: 'ace', distance: 700, side: 0, vertical: 0 }],
      requiredKills: 1,
    });
    const events = record(engine);
    advance(engine, 0.4);

    const internal = engine as unknown as {
      applyDamage: (target: SimEntity, damage: number, source: 'player' | 'wingman') => void;
    };
    const target = engine.getEntities().find((entity) => entity.kind === 'fighter');
    expect(target).toBeDefined();
    internal.applyDamage(target as SimEntity, 500, 'player');

    const kills = events.filter((event) => event.type === 'kill');
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({ callsign: 'VESPER 9', points: 180, ace: true });
    expect(kinds(engine.getEffects())).toContain('debris');

    const feed = engine.getSnapshot().combat.kills;
    expect(feed).toHaveLength(1);
    expect(feed[0]?.callsign).toBe('VESPER 9');
    expect(feed[0]?.ace).toBe(true);
    expect(feed[0]?.age).toBeLessThan(feed[0]?.duration ?? 0);
  });

  it('points the damage indicator at whatever hit the player', () => {
    const engine = startCombat();
    const events = record(engine);
    advance(engine, 0.2);

    const internal = engine as unknown as {
      damagePlayer: (amount: number, from: { x: number; y: number; z: number } | null) => void;
    };
    // Directly to the player's right-hand side.
    const right = vec3(
      engine.flight.position.x + Math.cos(engine.flight.yaw) * 400,
      engine.flight.position.y,
      engine.flight.position.z - Math.sin(engine.flight.yaw) * 400,
    );
    internal.damagePlayer(14, right);

    const damage = events.find((event) => event.type === 'damage');
    expect(damage).toBeDefined();
    if (damage?.type !== 'damage') throw new Error('expected a damage event');
    expect(damage.bearing).toBeCloseTo(90, 0);

    const incoming = engine.getSnapshot().combat.incoming;
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.severity).toBe('critical');
    expect(incoming[0]?.bearing).toBeCloseTo(90, 0);

    // Without a source the wedge falls back to "from behind" rather than NaN.
    internal.damagePlayer(6, null);
    const fallback = engine.getSnapshot().combat.incoming.at(-1);
    expect(fallback?.bearing).toBe(180);
    expect(fallback?.severity).toBe('caution');
  });

  it('counts a burst of hits as a combo and lets it lapse', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'TARGET', distance: 900, side: 0, vertical: 0 }],
    });
    advance(engine, 0.4);
    engine.startGun();
    advance(engine, 0.8);
    engine.stopGun();
    expect(engine.getSnapshot().combat.combo).toBeGreaterThan(2);

    advance(engine, 2.4);
    expect(engine.getSnapshot().combat.combo).toBe(0);
  });

  it('keeps the effect list inside the frame budget under heavy fire', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'TARGET', distance: 900, side: 0, vertical: 0 }],
    });
    advance(engine, 0.4);
    const internal = engine as unknown as {
      spawnSparks: (point: unknown, color: string, count: number) => void;
      spawnEffect: (kind: string, point: unknown, options: Record<string, unknown>) => void;
    };
    // A meaningful effect that must survive the flood.
    internal.spawnEffect('shockwave', engine.flight.position, { scale: 60, life: 3 });
    for (let index = 0; index < 90; index += 1) {
      internal.spawnSparks(engine.flight.position, 'amber', 8);
    }
    const live = engine.getEffects();
    expect(live.length).toBeLessThanOrEqual(190);
    // Cheap sparks are sacrificed first, so the shockwave is still standing.
    expect(kinds(live)).toContain('shockwave');
    expect(kinds(live).filter((kind) => kind === 'spark').length).toBeLessThan(190);
  });

  it('reports threat and intensity to the score and the mix', () => {
    const engine = startCombat({ enemies: [] });
    advance(engine, 0.5);
    const quiet = engine.getAudioTelemetry();
    expect(quiet.phase).toBe('dogfight');
    expect(quiet.intensity).toBeGreaterThanOrEqual(0);
    expect(quiet.intensity).toBeLessThanOrEqual(1);
    expect(quiet.lockProgress).toBe(0);
    expect(quiet.combo).toBe(0);
    expect(quiet.threat).toBe(0);
  });

  it('puts the player under threat when a hostile missile is inbound', () => {
    const engine = startCombat({
      enemies: [{ callsign: 'VESPER 1', distance: 1400, side: 0, vertical: 0 }],
    });
    // Let the AI close and take its shot.
    advance(engine, 9);
    const telemetry = engine.getAudioTelemetry();
    expect(telemetry.threat).toBeGreaterThan(0);
    expect(telemetry.intensity).toBeGreaterThan(0.3);
  });
});
