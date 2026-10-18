import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import type { BossAttackId, BossAttackPhase, ViewMode } from '../src/sim/types';

describe('AudioEngine fallbacks', () => {
  it('degrades silently when WebAudio is unavailable', async () => {
    const engine = new AudioEngine();
    expect(engine.available).toBe(false);
    await expect(engine.start()).resolves.toBe(false);
    expect(engine.running).toBe(false);
    expect(() => engine.setVolumes(false, 0.6)).not.toThrow();
    expect(() =>
      engine.update({
        phase: 'dogfight',
        paused: false,
        throttle: 0.7,
        speed: 240,
        altitude: 6800,
        gLoad: 2,
        hpRatio: 1,
        lockState: 'locked',
        lockProgress: 1,
        missileWarning: true,
        intensity: 0.7,
        combo: 3,
        threat: 0.5,
        bossActive: false,
        elapsed: 4,
        maneuver: 'highG',
        airbrake: true,
        assistEngaged: 2,
      }),
    ).not.toThrow();
    expect(() => engine.handleEvent({ type: 'flare' })).not.toThrow();
    expect(() => engine.handleEvent({ type: 'maneuver-start', id: 'cobra' })).not.toThrow();
    expect(() =>
      engine.handleEvent({ type: 'assist-toggle', id: 'steering', enabled: true }),
    ).not.toThrow();
    expect(() => engine.handleEvent({ type: 'stall' })).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });

  it('accepts every v0.5 boss and camera event without a context', () => {
    const engine = new AudioEngine();
    const attacks: BossAttackId[] = ['ciws', 'salvo', 'pulse', 'lance'];
    const phases: BossAttackPhase[] = ['idle', 'telegraph', 'active', 'recover'];
    for (const id of attacks) {
      for (const phase of phases) {
        expect(() => engine.handleEvent({ type: 'boss-attack', id, phase })).not.toThrow();
      }
    }
    expect(() =>
      engine.handleEvent({
        type: 'boss-lance-fire',
        origin: { x: 0, y: 40, z: -900 },
        axis: { x: 0, y: 0, z: -1 },
      }),
    ).not.toThrow();
    expect(() =>
      engine.handleEvent({ type: 'hull-impact', part: 'hull', damage: 45 }),
    ).not.toThrow();
    for (const mode of ['cockpit', 'chase'] as ViewMode[]) {
      expect(() => engine.handleEvent({ type: 'view-change', mode })).not.toThrow();
    }
    expect(() => engine.dispose()).not.toThrow();
  });
});
