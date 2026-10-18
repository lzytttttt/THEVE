import { describe, expect, it, vi } from 'vitest';
import { CockpitEngine } from '../src/sim/engine';
import { createDemoScenario, sunsetSpearScenario } from '../src/sim/scenario';
import { MANEUVER_ORDER } from '../src/sim/maneuvers';
import { SHOWCASE_ORDER } from '../src/sim/enemies';
import {
  createAutoPilotMemory,
  solveAutoPilot,
  type AutoPilotWorld,
} from '../src/sim/autopilot';
import type { ManeuverId, SimEvent } from '../src/sim/types';

/* ------------------------------------------------------------------ */
/* harness                                                             */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG so a whole sortie is reproducible in a test. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SortieResult {
  phase: string;
  seconds: number;
  kills: number;
  events: SimEvent[];
  demonstrated: number;
  plays: number;
  retries: number;
}

/** Fly a full automatic sortie with a fixed random seed. */
function automaticSortie(seed: number, budgetSeconds = 900): SortieResult {
  const random = mulberry32(seed);
  const spy = vi.spyOn(Math, 'random').mockImplementation(random);
  try {
    const engine = new CockpitEngine(sunsetSpearScenario);
    const events: SimEvent[] = [];
    engine.on((event) => events.push(event));
    engine.setAutoPilot(true);
    const dt = 1 / 60;
    const steps = Math.ceil(budgetSeconds / dt);
    for (let index = 0; index < steps; index += 1) {
      engine.update(dt);
      if (engine.phase === 'complete') {
        const auto = engine.getSnapshot().auto;
        return {
          phase: engine.phase,
          seconds: index * dt,
          kills: engine.getSnapshot().mission.stats.kills,
          events,
          demonstrated: auto.demonstrated,
          plays: auto.plays,
          retries: events.filter((event) => event.type === 'auto-retry').length,
        };
      }
    }
    const auto = engine.getSnapshot().auto;
    return {
      phase: engine.phase,
      seconds: budgetSeconds,
      kills: engine.getSnapshot().mission.stats.kills,
      events,
      demonstrated: auto.demonstrated,
      plays: auto.plays,
      retries: events.filter((event) => event.type === 'auto-retry').length,
    };
  } finally {
    spy.mockRestore();
  }
}

function advance(engine: CockpitEngine, seconds: number, dt = 1 / 60): void {
  const steps = Math.ceil(seconds / dt);
  for (let index = 0; index < steps; index += 1) engine.update(dt);
}

/* ------------------------------------------------------------------ */
/* the headline promise: one switch, whole sortie                      */
/* ------------------------------------------------------------------ */

describe('v0.4 AUTO ACE', () => {
  it('launches itself the moment it is switched on from the briefing', () => {
    const engine = new CockpitEngine(sunsetSpearScenario);
    expect(engine.phase).toBe('idle');
    engine.setAutoPilot(true);
    expect(engine.isAutoPilot()).toBe(true);
    // One tick is enough: the performer presses LAUNCH for the player.
    engine.update(1 / 60);
    expect(engine.phase).toBe('boot');
  });

  it('takes the stick away from manual input and gives it back on release', () => {
    const engine = new CockpitEngine(createDemoScenario({ enemies: [] }));
    engine.launch();
    engine.skipBoot();
    engine.setAutoPilot(true);
    engine.setInput({ pitch: 1, roll: 1, yaw: 1 });
    engine.setThrottle(1);
    advance(engine, 0.5);
    expect(engine.getSnapshot().auto.engaged).toBe(true);

    engine.setAutoPilot(false);
    expect(engine.isAutoPilot()).toBe(false);
    engine.setInput({ roll: 1 });
    advance(engine, 0.6);
    expect(Math.abs(engine.flight.rollRate)).toBeGreaterThan(0.1);
  });

  /**
   * The acceptance test for the whole feature. Three fixed seeds, at least two
   * of which must reach MISSION COMPLETE inside a generous budget without a
   * single human input. It is deliberately a majority rather than an
   * all-of-three: this is a dogfight, and a run that gets shot down and climbs
   * back in is the mode working, not the mode failing. What it will not accept
   * is the failure this test was written to catch — the performer circling a
   * target at ninety degrees of heading error for fifteen minutes.
   */
  it('clears the campaign without help on a majority of seeds', () => {
    const seeds = [0x5eed, 0xc0ffee, 0x1234abcd];
    const results = seeds.map((seed) => automaticSortie(seed));
    const finished = results.filter((result) => result.phase === 'complete');

    expect(finished.length).toBeGreaterThanOrEqual(2);
    for (const result of finished) {
      // Fast enough to watch, slow enough to be a real mission.
      expect(result.seconds).toBeLessThan(600);
      expect(result.kills).toBeGreaterThanOrEqual(6);
      expect(result.events.some((event) => event.type === 'boss-destroyed')).toBe(true);
    }
  });

  it('shows off the manoeuvre set on the way, not just the minimum to win', () => {
    const result = automaticSortie(0x5eed);
    const played = new Set(
      result.events
        .filter((event) => event.type === 'auto-play')
        .map((event) => (event as { maneuver: ManeuverId }).maneuver),
    );
    // The demo reel is the point of the mode: it must show a real spread of
    // moves, and every entry it claims must be a real v0.2 manoeuvre.
    expect(played.size).toBeGreaterThanOrEqual(4);
    for (const id of played) expect(MANEUVER_ORDER).toContain(id);
    expect(result.plays).toBeGreaterThanOrEqual(4);
  });

  it('narrates the show on the radio with its own voice', () => {
    const result = automaticSortie(0x5eed);
    const autoLines = result.events.filter(
      (event) => event.type === 'radio' && event.message.role === 'auto',
    );
    expect(autoLines.length).toBeGreaterThan(0);
  });

  it('keeps the demo reel across a shoot-down so the run always completes', () => {
    const engine = new CockpitEngine(sunsetSpearScenario);
    engine.setAutoPilot(true);
    advance(engine, 12);
    const shownBefore = engine.getSnapshot().auto.shown.length;

    engine.flight.hp = 0;
    advance(engine, 0.2);
    expect(engine.phase).toBe('failed');
    advance(engine, 4);
    expect(engine.phase === 'boot' || engine.phase === 'dogfight').toBe(true);
    expect(engine.isAutoPilot()).toBe(true);
    expect(engine.getSnapshot().auto.shown.length).toBeGreaterThanOrEqual(shownBefore);
  });

  it('reports a readable state for the HUD at every step', () => {
    const engine = new CockpitEngine(sunsetSpearScenario);
    engine.setAutoPilot(true);
    advance(engine, 20);
    const auto = engine.getSnapshot().auto;
    expect(auto.engaged).toBe(true);
    expect(auto.total).toBe(SHOWCASE_ORDER.length);
    expect(auto.condition).toBeGreaterThanOrEqual(0);
    expect(auto.condition).toBeLessThanOrEqual(1);
    expect(auto.mode).not.toBe('standby');
    expect(auto.code.length).toBeGreaterThan(0);
  });
});

describe('v0.4 wave director', () => {
  const waves = sunsetSpearScenario.reinforcements ?? [];

  it('starts on the opening formation and counts it as wave one', () => {
    const engine = new CockpitEngine(sunsetSpearScenario);
    engine.launch();
    engine.skipBoot();
    const wave = engine.getSnapshot().wave;
    expect(wave.index).toBe(1);
    expect(wave.total).toBe(waves.length + 1);
    expect(wave.code).toBe('WAVE 1');
    expect(wave.hostiles).toBe(sunsetSpearScenario.enemies.length);
    // Every airframe the mission can field is on the roster from the start, so
    // the threat readout never grows a line mid-fight.
    expect(wave.roster.reduce((sum, entry) => sum + entry.total, 0)).toBe(8);
  });

  it('labels the tracker with the wave on stage, not the one still inbound', () => {
    const engine = new CockpitEngine(sunsetSpearScenario);
    engine.launch();
    engine.skipBoot();
    // Two kills alone should not release a wave: the clock has not run out.
    advance(engine, 1);
    const before = engine.getSnapshot().wave.code;
    expect(before).toBe('WAVE 1');

    advance(engine, 30);
    const after = engine.getSnapshot().wave;
    expect(after.index).toBeGreaterThanOrEqual(2);
    expect(after.code).toBe(waves[after.index - 2]?.code);
    expect(after.labelZh).toBe(waves[after.index - 2]?.labelZh);
  });

  it('resupplies the rail when a wave arrives', () => {
    const engine = new CockpitEngine(sunsetSpearScenario);
    engine.launch();
    engine.skipBoot();
    advance(engine, 2);
    engine.fireMissile();
    engine.fireMissile();
    const spent = engine.weapons.missiles;
    advance(engine, 32);
    // The wave beat is the rearm beat: three waves' worth of bandits on eight
    // missiles was not a sortie.
    expect(engine.weapons.missiles).toBeGreaterThan(spent);
  });

  it('keeps the concurrent cap so the sky never fills up', () => {
    const engine = new CockpitEngine(sunsetSpearScenario);
    engine.launch();
    engine.skipBoot();
    advance(engine, 70);
    const hostiles = engine
      .getEntities()
      .filter((entity) => entity.alive && entity.kind === 'fighter' && entity.team === 'hostile');
    // Every wave declares a cap of 5; the initial pair plus both waves is 8, so
    // the cap is what stops all of them being airborne at once.
    expect(hostiles.length).toBeLessThanOrEqual(8);
  });
});

/* ------------------------------------------------------------------ */
/* controller unit tests, driven by hand-built worlds                  */
/* ------------------------------------------------------------------ */

function world(overrides: Partial<AutoPilotWorld> = {}): AutoPilotWorld {
  return {
    dt: 1 / 60,
    elapsed: 10,
    phase: 'dogfight',
    paused: false,
    position: { x: 0, y: 6000, z: 0 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    rollRate: 0,
    speed: 250,
    altitude: 6000,
    gLoad: 1,
    hp: 100,
    maxHp: 100,
    throttle: 0.7,
    activeManeuver: null,
    activeProgress: 0,
    contacts: [],
    threats: [],
    hazard: null,
    selectedId: null,
    lock: { state: 'none', progress: 0, targetId: null, distance: 0 },
    weapons: { selected: 'aam', missiles: 10, gunAmmo: 900, flares: 6 },
    jammed: false,
    pendingHostiles: 0,
    coreExposed: false,
    ...overrides,
  };
}

function contact(overrides: Partial<AutoPilotWorld['contacts'][number]> = {}) {
  return {
    id: 'fighter-1',
    callsign: 'VESPER 1',
    kind: 'fighter' as const,
    enemyId: 'interceptor' as const,
    position: { x: 0, y: 6000, z: -1500 },
    distance: 1500,
    angle: 0,
    yawError: 0,
    pitchError: 0,
    hp: 100,
    maxHp: 100,
    lockable: true,
    priority: 1,
    selected: false,
    ...overrides,
  };
}

describe('v0.4 auto-pilot controller', () => {
  it('banks toward a bandit that is off to one side', () => {
    const memory = createAutoPilotMemory();
    // Positive yaw error means the target sits off the left wing.
    const command = solveAutoPilot(world({ contacts: [contact({ yawError: 0.5, angle: 28 })] }), memory);
    expect(command.roll).toBeGreaterThan(0.2);
  });

  it('pulls up for a bandit above and pushes for one below', () => {
    const memory = createAutoPilotMemory();
    const above = solveAutoPilot(world({ contacts: [contact({ pitchError: 0.4 })] }), memory);
    const below = solveAutoPilot(world({ contacts: [contact({ pitchError: -0.4 })] }), memory);
    expect(above.pitch).toBeGreaterThan(0.3);
    expect(below.pitch).toBeLessThan(0);
  });

  it('presses the trigger only inside a real launch envelope', () => {
    const memory = createAutoPilotMemory();
    const far = solveAutoPilot(
      world({
        contacts: [contact({ distance: 3000 })],
        lock: { state: 'locked', progress: 1, targetId: 'fighter-1', distance: 3000 },
      }),
      memory,
    );
    expect(far.fireMissile).toBe(true);

    const tooFar = solveAutoPilot(
      world({
        contacts: [contact({ distance: 4200 })],
        lock: { state: 'locked', progress: 1, targetId: 'fighter-1', distance: 4200 },
      }),
      createAutoPilotMemory(),
    );
    expect(tooFar.fireMissile).toBe(false);

    const unlocked = solveAutoPilot(
      world({
        contacts: [contact({ distance: 2000 })],
        lock: { state: 'searching', progress: 0.5, targetId: 'fighter-1', distance: 2000 },
      }),
      createAutoPilotMemory(),
    );
    expect(unlocked.fireMissile).toBe(false);
  });

  it('breaks a missile lock with a decoy manoeuvre when out of flares', () => {
    const memory = createAutoPilotMemory();
    const command = solveAutoPilot(
      world({
        weapons: { selected: 'aam', missiles: 4, gunAmmo: 900, flares: 0 },
        threats: [{ id: 'm1', distance: 900, bearing: 175, impactIn: 1.2 }],
        contacts: [contact()],
      }),
      memory,
    );
    expect(command.startManeuver).not.toBeNull();
    expect(['cobra', 'kulbit', 'barrelRoll', 'splitS']).toContain(command.startManeuver);
    expect(memory.demonstrated[command.startManeuver as ManeuverId]).toBe(true);
    expect(memory.playEvent?.demonstration).toBe(false);
    expect(memory.announce).toBeTruthy();
  });

  it('spends a flare rather than two seconds of aerobatics when it has one', () => {
    const memory = createAutoPilotMemory();
    const command = solveAutoPilot(
      world({ threats: [{ id: 'm1', distance: 900, bearing: 175, impactIn: 1.9 }] }),
      memory,
    );
    expect(command.flare).toBe(true);
    expect(command.startManeuver).toBeNull();
  });

  it('breaks away from the side an inbound missile is on', () => {
    const memory = createAutoPilotMemory();
    // Positive bearing means the missile sits off the left wing.
    const command = solveAutoPilot(
      world({ threats: [{ id: 'm1', distance: 600, bearing: 20, impactIn: 0.9 }] }),
      memory,
    );
    expect(command.roll).toBeLessThan(0);
  });

  it('holds the gun only when the nose is genuinely on the target', () => {
    const onNose = solveAutoPilot(
      world({ contacts: [contact({ distance: 900, angle: 2 })] }),
      createAutoPilotMemory(),
    );
    expect(onNose.gun).toBe(true);
    expect(onNose.selectWeapon).toBe('gun');

    const offNose = solveAutoPilot(
      world({ contacts: [contact({ distance: 900, angle: 30 })] }),
      createAutoPilotMemory(),
    );
    expect(offNose.gun).toBe(false);
  });

  it('prefers an unshown manoeuvre when the sky is quiet', () => {
    const memory = createAutoPilotMemory();
    memory.demonstrated.highG = true;
    const command = solveAutoPilot(world({ pendingHostiles: 3 }), memory);
    expect(command.startManeuver).toBe(SHOWCASE_ORDER.find((id) => id !== 'highG'));
    expect(memory.playEvent?.demonstration).toBe(true);
    expect(memory.mode).toBe('showcase');
  });

  it('will not show off with a missile in the air', () => {
    const memory = createAutoPilotMemory();
    solveAutoPilot(
      world({ threats: [{ id: 'm1', distance: 1400, bearing: 170, impactIn: 2.2 }] }),
      memory,
    );
    expect(memory.mode).toBe('defend');
    expect(memory.playEvent?.demonstration).toBeFalsy();
  });

  it('breaks out of a pursuit orbit instead of circling forever', () => {
    const memory = createAutoPilotMemory();
    // Nose ninety degrees off and staying there: the stable limit cycle that
    // pure pursuit falls into against an equal turn rate.
    let enhanced = 0;
    for (let index = 0; index < 240; index += 1) {
      const command = solveAutoPilot(
        world({ contacts: [contact({ distance: 900, angle: 90, yawError: 1.57 })] }),
        memory,
      );
      // A straight extension is the only thing that commands a level wing here.
      if (Math.abs(command.roll) < 0.05) enhanced += 1;
    }
    expect(enhanced).toBeGreaterThan(30);
  });

  it('respects the manoeuvre gates instead of spamming blocked requests', () => {
    const memory = createAutoPilotMemory();
    // A kulbit needs 200 m/s and 1500 m; a very low, slow jet cannot fly one.
    const command = solveAutoPilot(
      world({ altitude: 900, speed: 170, pendingHostiles: 2 }),
      memory,
    );
    expect(command.startManeuver).toBeNull();
    expect(memory.plays).toBe(0);
  });

  it('keeps flying an airshow when the reel still has moves left', () => {
    const memory = createAutoPilotMemory();
    const command = solveAutoPilot(world({ altitude: 6000 }), memory);
    expect(Number.isFinite(command.pitch)).toBe(true);
    expect(Number.isFinite(command.roll)).toBe(true);
    expect(command.throttle).toBeGreaterThan(0);
    // Nothing to shoot at, so it uses the dead time to show the audience a move.
    expect(memory.mode).toBe('showcase');
    expect(command.startManeuver).not.toBeNull();
  });

  it('settles into a transit when the reel is exhausted and the sky is empty', () => {
    const memory = createAutoPilotMemory();
    for (const id of SHOWCASE_ORDER) memory.demonstrated[id] = true;
    const command = solveAutoPilot(world({ altitude: 6000 }), memory);
    expect(memory.mode).toBe('transit');
    expect(command.startManeuver).toBeNull();
    expect(Number.isFinite(command.roll)).toBe(true);
  });

  it('clears the escorts before it strafes the dreadnought', () => {
    const boss = contact({
      id: 'weakpoint-9',
      callsign: 'SHIELD NODE A',
      kind: 'weakpoint',
      enemyId: null,
      distance: 1500,
      angle: 4,
      priority: 3.4,
    });
    const escort = contact({ id: 'fighter-2', callsign: 'VESPER 3', distance: 700, angle: 20, priority: 1 });
    const memory = createAutoPilotMemory();
    // The escort is inside gun range, so the shield node waits its turn.
    const command = solveAutoPilot(world({ contacts: [boss, escort] }), memory);
    expect(memory.playEvent).toBeNull();
    expect(command.selectTarget).toBe('fighter-2');
  });

  it('goes straight for the shield node when no escort is inside gun range', () => {
    const boss = contact({
      id: 'weakpoint-9',
      callsign: 'SHIELD NODE A',
      kind: 'weakpoint',
      enemyId: null,
      distance: 1500,
      angle: 4,
      priority: 3.4,
    });
    const far = contact({ id: 'fighter-2', callsign: 'VESPER 3', distance: 2600, angle: 10, priority: 1 });
    const command = solveAutoPilot(world({ contacts: [boss, far] }), createAutoPilotMemory());
    expect(command.selectTarget).toBe('weakpoint-9');
  });

  it('goes straight for the reactor once the core is exposed', () => {
    const core = contact({
      id: 'weakpoint-core',
      callsign: 'REACTOR CORE',
      kind: 'weakpoint',
      enemyId: null,
      distance: 1500,
      angle: 4,
      priority: 3.4,
    });
    const escort = contact({ id: 'fighter-2', callsign: 'VESPER DRONE', distance: 700, angle: 20, priority: 0.8 });
    const memory = createAutoPilotMemory();
    const command = solveAutoPilot(world({ contacts: [core, escort], coreExposed: true }), memory);
    expect(command.selectTarget).toBe('weakpoint-core');
  });

  it('climbs away from the hard floor', () => {
    const command = solveAutoPilot(world({ altitude: 1500 }), createAutoPilotMemory());
    expect(command.pitch).toBeGreaterThan(0.3);

    // Throttle is slewed rather than snapped, so it takes a moment to reach the
    // wall — but a jet below the soft floor does get there.
    const slewing = createAutoPilotMemory();
    let throttle = 0.7;
    for (let index = 0; index < 60; index += 1) {
      throttle = solveAutoPilot(world({ altitude: 1500, throttle }), slewing).throttle;
    }
    expect(throttle).toBeGreaterThan(0.98);
  });
});
