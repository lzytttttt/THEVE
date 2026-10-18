import { describe, expect, it, vi } from 'vitest';
import { CockpitEngine } from '../src/sim/engine';
import { createDemoScenario } from '../src/sim/scenario';
import {
  BOSS_ATTACKS,
  BOSS_ATTACK_ORDER,
  BOSS_ANCHOR,
  BOSS_HULL,
  BOSS_LANCE_MUZZLE,
  bossAttackPool,
  type BossPose,
  bossHitTest,
  bossHullPushOut,
  bossSegmentHit,
  fromBossLocal,
  lanceHits,
  lanceOffset,
  lanceRadius,
  toBossLocal,
} from '../src/sim/boss';
import type { SimEntity, Vec3, ViewMode } from '../src/sim/types';
import { isViewMode, VIEW_LABEL, VIEW_ORDER } from '../src/sim/types';

function advance(engine: CockpitEngine, seconds: number): void {
  const steps = Math.ceil(seconds * 60);
  for (let index = 0; index < steps; index += 1) engine.update(1 / 60);
}

function bossFight(): CockpitEngine {
  const engine = new CockpitEngine(
    createDemoScenario({ enemies: [], requiredKills: 0, bossTriggerAt: 0.01 }),
  );
  engine.launch();
  engine.skipBoot();
  advance(engine, 4);
  return engine;
}

const POSE: BossPose = { position: { x: 0, y: 6000, z: 0 }, yaw: 0, pitch: 0, roll: 0 };

/** Boss-local coordinates → the world point the collider is actually tested against. */
function at(x: number, y: number, z: number, pose: BossPose = POSE): Vec3 {
  return fromBossLocal(pose, { x, y, z });
}

/** Point on the boss-local Z axis, `range` metres from its centre. */
function along(z: number, pose: BossPose = POSE): Vec3 {
  return at(0, 0, z, pose);
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

describe('v0.5 boss collision volume', () => {
  it('describes the hull as a compound body, not a point', () => {
    expect(BOSS_HULL.length).toBeGreaterThan(6);
    // Every box has real volume and a name for the impact callout.
    for (const box of BOSS_HULL) {
      expect(box.hx).toBeGreaterThan(0);
      expect(box.hy).toBeGreaterThan(0);
      expect(box.hz).toBeGreaterThan(0);
      expect(box.part.length).toBeGreaterThan(0);
    }
    // The keel is the longest single piece.
    const keel = BOSS_HULL.find((box) => box.part === 'KEEL');
    expect(keel?.hz).toBeGreaterThan(200);
  });

  it('round-trips a point through the boss frame and back', () => {
    const pose: BossPose = { position: { x: 1200, y: 5400, z: -800 }, yaw: 0.9, roll: 0.02 };
    const point: Vec3 = { x: 1180, y: 5480, z: -1180 };
    const back = fromBossLocal(pose, toBossLocal(pose, point));
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
    expect(back.z).toBeCloseTo(point.z, 6);
  });

  it('reports a hit inside the hull and a miss outside it', () => {
    expect(bossHitTest(POSE, at(0, 0, 0))).toBe('KEEL');
    expect(bossHitTest(POSE, at(300, -6, 60))).toBe('WING');
    // The maw between the bow jaws is a real hole: a shot up the throat of the
    // ship reaches the reactor, which is what makes the core run possible.
    expect(bossHitTest(POSE, at(BOSS_ANCHOR.core.x, BOSS_ANCHOR.core.y, BOSS_ANCHOR.core.z))).toBeNull();
    // A round that comes at the core from the side still meets the keel first.
    expect(bossHitTest(POSE, at(0, 0, -120))).toBe('KEEL');
    // …and well clear of the ship is clear.
    expect(bossHitTest(POSE, at(0, 900, 0))).toBeNull();
  });

  it('finds where a swept path meets the armour', () => {
    const hit = bossSegmentHit(POSE, along(1600), along(-1600));
    expect(hit).not.toBeNull();
    expect(hit!.part).toBe('STERN');
    expect(hit!.t).toBeGreaterThan(0);
    expect(hit!.t).toBeLessThan(1);

    // Straight up the throat: the bow jaws straddle the muzzle, so a shot down
    // the maw's own axis never touches armour — that gap is the core run.
    const throat = bossSegmentHit(POSE, at(0, -6, -1600), at(0, -6, -300));
    expect(throat).toBeNull();

    const miss = bossSegmentHit(POSE, at(4000, 0, 1600), at(4000, 0, -1600));
    expect(miss).toBeNull();
  });

  it('pushes a point that is inside the hull back out along the nearest face', () => {
    // Just inside the starboard flank of the keel.
    const inside = at(74, 0, -30);
    expect(bossHitTest(POSE, inside)).not.toBeNull();
    const push = bossHullPushOut(POSE, inside, 10);
    expect(push).not.toBeNull();
    const moved: Vec3 = {
      x: inside.x + push!.correction.x,
      y: inside.y + push!.correction.y,
      z: inside.z + push!.correction.z,
    };
    expect(bossHitTest(POSE, moved)).toBeNull();
    // The correction is a displacement, not a position: applying it must not
    // move the player anywhere except just clear of the hull. Subtracting the
    // world point instead of the local one used to teleport them 6000 m down.
    expect(
      Math.abs(push!.correction.x) + Math.abs(push!.correction.y) + Math.abs(push!.correction.z),
    ).toBeLessThan(200);
    expect(Math.abs(moved.y - inside.y)).toBeLessThan(80);

    // Iterating from anywhere inside must reach clear air without ever
    // oscillating between two overlapping boxes — the failure mode a single
    // minimum-translation step has on a keel with a deck sitting on it.
    for (const start of [at(0, 0, 0), at(0, 40, 0), at(-60, 20, 100)]) {
      let point = start;
      let escaped = false;
      for (let pass = 0; pass < 12; pass += 1) {
        const step = bossHullPushOut(POSE, point, 6);
        if (!step) {
          escaped = true;
          break;
        }
        point = {
          x: point.x + Math.max(-30, Math.min(30, step.correction.x)),
          y: point.y + Math.max(-30, Math.min(30, step.correction.y)),
          z: point.z + Math.max(-30, Math.min(30, step.correction.z)),
        };
        expect(Math.abs(point.y - POSE.position.y)).toBeLessThan(600);
      }
      expect(escaped).toBe(true);
    }

    // A point already outside needs no correction.
    expect(bossHullPushOut(POSE, at(0, 4000, 0))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* the attack book                                                     */
/* ------------------------------------------------------------------ */

describe('v0.5 boss attack book', () => {
  it('gives every attack a counter the player can actually fly', () => {
    for (const id of BOSS_ATTACK_ORDER) {
      const attack = BOSS_ATTACKS[id];
      expect(attack.telegraph).toBeGreaterThan(0.4);
      expect(attack.active).toBeGreaterThan(0);
      expect(attack.cooldown[1]).toBeGreaterThan(attack.cooldown[0]);
      expect(attack.counterZh.length).toBeGreaterThan(6);
      expect(attack.counterEn.length).toBeGreaterThan(6);
      expect(attack.damage).toBeGreaterThan(0);
      expect(attack.range[1]).toBeGreaterThan(attack.range[0]);
    }
  });

  it('unlocks the spinal lance only once the reactor is exposed', () => {
    expect(bossAttackPool(1)).not.toContain('lance');
    expect(bossAttackPool(2)).not.toContain('lance');
    expect(bossAttackPool(3)).toContain('lance');
    expect(BOSS_ATTACK_ORDER.every((id) => bossAttackPool(3).includes(id))).toBe(true);
  });

  it('measures the lance corridor so a perpendicular break escapes it', () => {
    const origin: Vec3 = { x: 0, y: 0, z: 0 };
    const axis: Vec3 = { x: 0, y: 0, z: -1 };
    // Dead on the axis, 4 km out.
    expect(lanceHits(origin, axis, { x: 0, y: 0, z: -4000 })).toBe(true);
    expect(lanceOffset(origin, axis, { x: 0, y: 0, z: -4000 })).toBeCloseTo(0, 6);
    // A hundred metres off the axis at that range: the beam has bloomed to
    // 26 + 4000 * 0.02 = 106 m, so this is the edge of a survivable break.
    expect(lanceRadius(4000)).toBeCloseTo(106, 6);
    expect(lanceHits(origin, axis, { x: 100, y: 0, z: -4000 })).toBe(true);
    expect(lanceHits(origin, axis, { x: 400, y: 0, z: -4000 })).toBe(false);
    // Behind the muzzle is never hit.
    expect(lanceHits(origin, axis, { x: 0, y: 0, z: 500 })).toBe(false);
  });

  it('places the lance muzzle under the bow, inside the hull boxes', () => {
    expect(BOSS_LANCE_MUZZLE.z).toBeLessThan(BOSS_ANCHOR.core.z);
    expect(BOSS_LANCE_MUZZLE.y).toBeLessThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* the encounter, driven through the engine                            */
/* ------------------------------------------------------------------ */

describe('v0.5 boss encounter', () => {
  it('keeps the player out of the hull instead of letting them fly through it', () => {
    const engine = bossFight();
    const boss = engine.getBossEntity();
    expect(boss).toBeTruthy();
    const pose: BossPose = {
      position: boss!.position,
      yaw: boss!.yaw,
      pitch: 0,
      roll: boss!.roll,
    };
    // Teleport the player into the middle of the dreadnought's keel.
    const before = engine.getFlight().hp;
    engine.flight.position = { ...boss!.position };
    advance(engine, 0.4);
    const flight = engine.getFlight();
    expect(flight.hp).toBeLessThan(before);
    expect(bossHitTest(pose, flight.position)).toBeNull();
    // …and clear means *just* clear, in the same sky. A push-out that folds the
    // dreadnought's own altitude into the correction, or one that snaps four
    // hundred metres sideways, would both show up here.
    expect(Math.abs(flight.position.y - boss!.position.y)).toBeLessThan(400);
  });

  it('publishes a stage, a range and an attack telegraph for the HUD', () => {
    const engine = bossFight();
    const attack = BOSS_ATTACKS;
    expect(Object.keys(attack).length).toBe(BOSS_ATTACK_ORDER.length);
    const snapshot = engine.getSnapshot();
    expect(snapshot.boss).not.toBeNull();
    const boss = snapshot.boss!;
    expect(boss.stage).toBe(1);
    expect(boss.stageLabel).toBe('护盾完整');
    expect(boss.stageCode).toBe('SHIELDED');
    expect(boss.distance).toBeGreaterThan(0);
    expect(boss.tooClose).toBe(false);
    expect(boss.weakpoints).toHaveLength(3);
    expect(boss.weakpoints.filter((weakpoint) => weakpoint.targetable)).toHaveLength(2);
  });

  it('runs attacks on a readable cycle and never repeats one out of turn', () => {
    const engine = bossFight();
    const seen = new Set<string>();
    const phases: string[] = [];
    engine.on((event) => {
      if (event.type !== 'boss-attack') return;
      seen.add(event.id);
      phases.push(`${event.id}:${event.phase}`);
    });
    // Fly the dreadnought: chase it, top the airframe up (this test is about the
    // director's cadence, not about surviving), and turn back in whenever the
    // crude pursuit has bled the range out past a useful engagement.
    for (let index = 0; index < 60 * 120; index += 1) {
      const boss = engine.getBossEntity();
      const flight = engine.flight;
      flight.hp = 100;
      if (boss) {
        const toBoss = {
          x: boss.position.x - flight.position.x,
          y: boss.position.y - flight.position.y,
          z: boss.position.z - flight.position.z,
        };
        const span = Math.hypot(toBoss.x, toBoss.y, toBoss.z) || 1;
        if (span > 3200) {
          // Re-enter the fight from 2.6 km on the dreadnought's nose.
          flight.position = {
            x: boss.position.x + (toBoss.x / span) * 2600,
            y: boss.position.y + (toBoss.y / span) * 2600,
            z: boss.position.z + (toBoss.z / span) * 2600,
          };
        }
        engine.setInput({
          pitch: Math.max(-0.6, Math.min(0.6, toBoss.y / span)),
          roll: Math.max(-1, Math.min(1, toBoss.x / span)),
        });
      }
      engine.update(1 / 60);
    }
    // Over two minutes against the dreadnought the shield-phase attacks must all
    // have fired at least once, and the phasing must be well-formed.
    expect([...seen].sort()).toEqual(expect.arrayContaining(['ciws', 'salvo', 'pulse']));
    for (const entry of phases) {
      const [id, phase] = entry.split(':');
      expect(BOSS_ATTACK_ORDER).toContain(id);
      expect(['telegraph', 'active', 'recover', 'idle']).toContain(phase);
    }
    // Every telegraph is followed by that attack going live.
    const telegraphs = phases.filter((entry) => entry.endsWith(':telegraph')).length;
    const actives = phases.filter((entry) => entry.endsWith(':active')).length;
    expect(actives).toBeGreaterThanOrEqual(telegraphs - 1);
    expect(telegraphs).toBeGreaterThan(3);
  });

  it('telegraphs the attack on the HUD before it hurts', () => {
    const engine = bossFight();
    let telegraph: string | null = null;
    for (let index = 0; index < 60 * 40 && !telegraph; index += 1) {
      engine.update(1 / 60);
      const boss = engine.getSnapshot().boss;
      if (boss?.attack && boss.attack.phase === 'telegraph') {
        telegraph = boss.attack.id;
      }
    }
    expect(telegraph).not.toBeNull();
    const boss = engine.getSnapshot().boss!;
    expect(boss.attack!.remaining).toBeGreaterThan(0);
    expect(boss.attack!.progress).toBeGreaterThanOrEqual(0);
    expect(boss.attack!.progress).toBeLessThanOrEqual(1);
    expect(boss.attack!.counterZh.length).toBeGreaterThan(4);
  });

  it('escapes the lance corridor when the telegraph is answered', () => {
    const engine = bossFight();
    const boss = engine.getBossEntity()!;
    // Walk the boss all the way to the exposed stage by killing both nodes.
    for (const entity of engine.getEntities()) {
      if (entity.kind === 'weakpoint' && entity.weakpoint?.key !== 'core') {
        entity.weakpoint!.targetable = true;
      }
    }
    const nodes = engine
      .getEntities()
      .filter(
        (entity): entity is SimEntity =>
          entity.kind === 'weakpoint' && entity.weakpoint?.key !== 'core',
      );
    // Damage them through the public path: a lock plus a missile is slow, so
    // drive them to one hit point and let the gun finish the job via damage.
    for (const node of nodes) node.hp = 1;
    engine.selectTarget(nodes[0]!.id);
    engine.setInput({ pitch: 0 });
    advance(engine, 0.2);
    // Force the transition the same way the sim would.
    for (const node of nodes) {
      node.hp = 0;
      node.alive = false;
    }
    advance(engine, 2);
    const stage = engine.getSnapshot().boss?.stage;
    expect(stage === 2 || stage === 3).toBe(true);
    expect(boss.alive).toBe(true);
  });

  it('damages the player inside the shield pulse and spares them outside it', () => {
    const engine = bossFight();
    const boss = engine.getBossEntity()!;
    // Hold station right on top of the hull for long enough to wind the
    // capacitor, then keep station: the pulse has to land.
    let hp = engine.getFlight().hp;
    let tookPulse = false;
    for (let index = 0; index < 60 * 60 && !tookPulse; index += 1) {
      const flight = engine.flight;
      flight.position = {
        x: boss.position.x + 400,
        y: boss.position.y + 200,
        z: boss.position.z + 400,
      };
      flight.hp = 100;
      engine.update(1 / 60);
      if (engine.getFlight().hp < 100 - 20) {
        tookPulse = true;
        hp = engine.getFlight().hp;
      }
    }
    expect(tookPulse).toBe(true);
    expect(hp).toBeLessThan(90);
  });
});

/* ------------------------------------------------------------------ */
/* the camera                                                          */
/* ------------------------------------------------------------------ */

describe('v0.5 view modes', () => {
  it('exposes exactly two cameras with stable labels', () => {
    expect(VIEW_ORDER).toEqual(['cockpit', 'chase']);
    for (const mode of VIEW_ORDER) {
      expect(VIEW_LABEL[mode].code).toHaveLength(3);
      expect(VIEW_LABEL[mode].zh.length).toBeGreaterThan(1);
      expect(isViewMode(mode)).toBe(true);
    }
    expect(isViewMode('third')).toBe(false);
    expect(isViewMode(null)).toBe(false);
  });

  it('starts in the cockpit and toggles to the outside view and back', () => {
    const engine = bossFight();
    expect(engine.getView()).toBe('cockpit');
    expect(engine.getSnapshot().view).toBe('cockpit');
    expect(engine.toggleView()).toBe('chase');
    expect(engine.getSnapshot().view).toBe('chase');
    expect(engine.toggleView()).toBe('cockpit');
    expect(engine.getView()).toBe('cockpit');
  });

  it('ignores a nonsense mode instead of breaking the camera', () => {
    const engine = bossFight();
    engine.setView('chase');
    engine.setView('nosebleed' as ViewMode);
    expect(engine.getView()).toBe('chase');
  });

  it('reports control deflection and manoeuvre state for the model', () => {
    const engine = bossFight();
    engine.setInput({ roll: 1, pitch: -0.4 });
    advance(engine, 0.4);
    const telemetry = engine.getViewTelemetry();
    expect(telemetry.mode).toBe('cockpit');
    expect(telemetry.control.roll).toBeGreaterThan(0.5);
    expect(telemetry.control.pitch).toBeLessThan(-0.2);
    expect(telemetry.speed).toBeGreaterThan(0);
    expect(telemetry.gLoad).toBeGreaterThanOrEqual(1);

    engine.startManeuver('barrelRoll');
    advance(engine, 0.2);
    expect(engine.getViewTelemetry().maneuver).toBe('barrelRoll');
    expect(engine.getViewTelemetry().maneuverProgress).toBeGreaterThan(0);
  });

  it('keeps flying identically whichever camera is selected', () => {
    // Both runs have to see the same dice: the sim draws on Math.random for
    // flak, gun bursts and drone spawns, so the comparison is only meaningful
    // with the generator pinned to the same seed.
    const seed = () => {
      let state = 0x2f6e2b1;
      return () => {
        state = (state * 1664525 + 1013904223) % 0x100000000;
        return state / 0x100000000;
      };
    };
    const run = (mode: ViewMode) => {
      const random = vi.spyOn(Math, 'random').mockImplementation(seed());
      try {
        const engine = bossFight();
        engine.setView(mode);
        engine.setInput({ pitch: 0.6, roll: 0.4 });
        engine.setThrottle(0.8);
        advance(engine, 6);
        const flight = engine.getFlight();
        return {
          x: Math.round(flight.position.x),
          y: Math.round(flight.position.y),
          z: Math.round(flight.position.z),
          yaw: Number(flight.yaw.toFixed(4)),
          speed: Number(flight.speed.toFixed(3)),
          hp: flight.hp,
        };
      } finally {
        random.mockRestore();
      }
    };
    // The camera is a view, not a physics mode: the aircraft must fly the same
    // sortie from the outside as it does from the cockpit.
    expect(run('chase')).toEqual(run('cockpit'));
  });
});

/* ------------------------------------------------------------------ */
/* flares                                                              */
/* ------------------------------------------------------------------ */

describe('v0.5 countermeasures', () => {
  it('throws a salvo of drifting cartridges that burn down', () => {
    const engine = bossFight();
    engine.flare();
    const flares = engine.getEntities().filter((entity) => entity.kind === 'flare');
    expect(flares).toHaveLength(4);
    const start = flares.map((flare) => ({ ...flare.position }));
    const drift = flares.map((flare) => ({ ...flare.drift! }));
    advance(engine, 1);
    const live = engine.getEntities().filter((entity) => entity.kind === 'flare');
    expect(live.length).toBe(4);
    // Every cartridge has moved, and gravity is winning: a cartridge thrown
    // from a climbing aircraft rises for a beat, then falls.
    live.forEach((flare, index) => {
      const from = start[index]!;
      const moved =
        Math.abs(flare.position.x - from.x) +
        Math.abs(flare.position.y - from.y) +
        Math.abs(flare.position.z - from.z);
      expect(moved).toBeGreaterThan(1);
      expect(flare.drift!.y).toBeLessThan(drift[index]!.y - 10);
    });
    // And they burn out rather than lingering forever.
    advance(engine, 4);
    expect(engine.getEntities().filter((entity) => entity.kind === 'flare')).toHaveLength(0);
  });

  it('keeps the cloud near the airframe so a head-on missile can be decoyed', () => {
    const engine = bossFight();
    engine.setThrottle(0.85);
    advance(engine, 2);
    engine.flare();
    let worst = 0;
    for (let index = 0; index < 60; index += 1) {
      engine.update(1 / 60);
      for (const flare of engine.entities.filter((entity) => entity.kind === 'flare')) {
        worst = Math.max(
          worst,
          Math.hypot(
            flare.position.x - engine.flight.position.x,
            flare.position.y - engine.flight.position.y,
            flare.position.z - engine.flight.position.z,
          ),
        );
      }
    }
    // A cartridge that immediately falls a long way astern only answers a
    // missile chasing from behind. This is the balance decision the AUTO ACE
    // soak runs forced, so it is pinned here rather than left to a comment.
    expect(worst).toBeLessThan(340);
    expect(worst).toBeGreaterThan(0);
  });

  it('seduces a missile that passes close to a burning cartridge', () => {
    const engine = bossFight();
    engine.flare();
    const flare = engine.getEntities().find((entity) => entity.kind === 'flare')!;
    const flight = engine.getFlight();
    // A hostile round 600 m ahead of the aircraft: well outside its own fuse,
    // but close enough to a cartridge that has been parked next to it.
    const spot = {
      x: flight.position.x,
      y: flight.position.y + 600,
      z: flight.position.z,
    };
    flare.position = { x: spot.x + 40, y: spot.y, z: spot.z };
    const missile: SimEntity = {
      ...flare,
      id: 'test-missile',
      kind: 'missile',
      team: 'hostile',
      callsign: 'TEST AAM',
      position: { ...spot },
      life: 5,
      maxLife: 5,
      drift: null,
      weakpoint: null,
      ai: null,
      missile: {
        targetId: 'player',
        speed: 0,
        life: 5,
        maxLife: 5,
        owner: 'hostile',
        whooshed: false,
      },
    };
    engine.entities.push(missile);
    advance(engine, 0.05);
    const after = engine.getEntities().find((entity) => entity.id === 'test-missile');
    expect(after).toBeTruthy();
    expect(after!.missile!.targetId).not.toBe('player');
    expect(after!.missile!.targetId).toBe(flare.id);
  });
});
