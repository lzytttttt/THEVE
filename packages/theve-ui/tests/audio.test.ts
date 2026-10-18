import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';

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
});
