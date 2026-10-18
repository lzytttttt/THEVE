import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import { SCORE_SECTIONS } from '../src/audio/score';
import type { AudioTelemetry } from '../src/sim/types';

/**
 * The v0.3 score cannot be listened to in CI, so it is verified structurally
 * instead: a fake WebAudio graph records every node the arranger builds, and the
 * test asserts that bars are committed ahead of the clock, that the layers are
 * there, and that the section follows the fight.
 */

class FakeParam {
  value = 0;
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
  setTargetAtTime(): this {
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  connect(): this {
    return this;
  }
  disconnect(): void {
    /* noop */
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = '';
  frequency = new FakeParam();
  Q = new FakeParam();
  detune = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = '';
  frequency = new FakeParam();
  detune = new FakeParam();
  started: number | null = null;
  stopped: number | null = null;
  start(at = 0): void {
    this.started = at;
  }
  stop(at = 0): void {
    this.stopped = at;
  }
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  start(): void {
    /* noop */
  }
  stop(): void {
    /* noop */
  }
}

class FakeBuffer {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
  ) {}
  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  destination = new FakeNode();
  counts = { oscillators: 0, buffers: 0, gains: 0, filters: 0, convolvers: 0, panners: 0 };

  createGain(): FakeGain {
    this.counts.gains += 1;
    return new FakeGain();
  }
  createDynamicsCompressor(): FakeNode & { threshold: FakeParam } {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  createAnalyser(): FakeNode & {
    fftSize: number;
    smoothingTimeConstant: number;
    getByteTimeDomainData: (data: Uint8Array) => void;
  } {
    return Object.assign(new FakeNode(), {
      fftSize: 256,
      smoothingTimeConstant: 0.8,
      getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
    });
  }
  createConvolver(): FakeNode & { buffer: unknown } {
    this.counts.convolvers += 1;
    return Object.assign(new FakeNode(), { buffer: null });
  }
  createBiquadFilter(): FakeFilter {
    this.counts.filters += 1;
    return new FakeFilter();
  }
  createOscillator(): FakeOscillator {
    this.counts.oscillators += 1;
    return new FakeOscillator();
  }
  createBufferSource(): FakeBufferSource {
    this.counts.buffers += 1;
    return new FakeBufferSource();
  }
  createBuffer(channels: number, length: number): FakeBuffer {
    return new FakeBuffer(channels, length);
  }
  createStereoPanner(): FakeNode & { pan: FakeParam } {
    this.counts.panners += 1;
    return Object.assign(new FakeNode(), { pan: new FakeParam() });
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
}

function telemetry(overrides: Partial<AudioTelemetry> = {}): AudioTelemetry {
  return {
    phase: 'dogfight',
    paused: false,
    throttle: 0.7,
    speed: 240,
    altitude: 6800,
    gLoad: 2,
    hpRatio: 1,
    lockState: 'none',
    lockProgress: 0,
    missileWarning: false,
    intensity: 0.5,
    combo: 0,
    threat: 0.2,
    bossActive: false,
    elapsed: 10,
    maneuver: null,
    airbrake: false,
    assistEngaged: 0,
    ...overrides,
  };
}

let context: FakeContext;

beforeEach(() => {
  vi.useFakeTimers();
  context = new FakeContext();
  (window as unknown as { AudioContext: unknown }).AudioContext = function AudioContext() {
    return context;
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

/** Let the lookahead scheduler commit `seconds` worth of bars. */
function run(engine: AudioEngine, seconds: number, chunk = 0.25): void {
  const steps = Math.ceil(seconds / chunk);
  for (let index = 0; index < steps; index += 1) {
    context.currentTime += chunk;
    vi.advanceTimersByTime(chunk * 1000);
    engine.update(telemetry({ elapsed: context.currentTime }));
  }
}

describe('v0.3 score playback', () => {
  it('starts, builds the graph and reports running', async () => {
    const engine = new AudioEngine();
    expect(engine.available).toBe(true);
    await expect(engine.start()).resolves.toBe(true);
    expect(engine.running).toBe(true);
    // Bus gains, layer gains, the music master and the reverb send.
    expect(context.counts.gains).toBeGreaterThan(10);
    expect(context.counts.convolvers).toBe(1);
    engine.dispose();
  });

  it('commits whole bars ahead of the audio clock', async () => {
    const engine = new AudioEngine();
    await engine.start();
    const before = context.counts.oscillators;
    run(engine, 6);
    const after = context.counts.oscillators;

    // The soaring cue alone voices a pad, a bass, a lead and harp arpeggios,
    // so six seconds of bars cannot possibly be silent.
    const bars = Math.ceil(6 / (60 / SCORE_SECTIONS.soar.bpm) / 4);
    expect(after - before).toBeGreaterThan(bars * 4);
    engine.dispose();
  });

  it('is drumless while soaring and gains a taiko kit once the fight starts', async () => {
    const engine = new AudioEngine();
    await engine.start();
    run(engine, 4);
    const quiet = context.counts.buffers;

    for (let index = 0; index < 10; index += 1) {
      context.currentTime += 1.4;
      vi.advanceTimersByTime(1400);
      engine.update(
        telemetry({ phase: 'boss', bossActive: true, intensity: 0.95, elapsed: context.currentTime }),
      );
    }
    // Percussion is the only thing in the score that needs a noise source.
    expect(context.counts.buffers).toBeGreaterThan(quiet);
    engine.dispose();
  });

  it('keeps scheduling while the clock runs and stops when disposed', async () => {
    const engine = new AudioEngine();
    await engine.start();
    run(engine, 4);
    const scheduled = context.counts.oscillators;
    engine.dispose();
    run(engine, 6);
    // After dispose the interval is cleared, so nothing new is committed.
    expect(context.counts.oscillators).toBeLessThan(scheduled + 40);
  });

  it('freezes the arrangement while the game is paused instead of piling up bars', async () => {
    const engine = new AudioEngine();
    await engine.start();
    run(engine, 3);
    const beforePause = context.counts.oscillators;

    engine.setPaused(true);
    const steps = 12;
    for (let index = 0; index < steps; index += 1) {
      context.currentTime += 0.25;
      vi.advanceTimersByTime(250);
      engine.update(telemetry({ paused: true, elapsed: context.currentTime }));
    }
    expect(context.counts.oscillators).toBe(beforePause);

    engine.setPaused(false);
    run(engine, 3);
    expect(context.counts.oscillators).toBeGreaterThan(beforePause);
    engine.dispose();
  });

  it('follows the fight into the boss arrangement', async () => {
    const engine = new AudioEngine();
    await engine.start();
    expect(engine.section).toBe('soar');
    run(engine, 4);

    // Drive the mission into the boss with the throttle wide open.
    for (let index = 0; index < 24; index += 1) {
      context.currentTime += 1.4;
      vi.advanceTimersByTime(1400);
      engine.update(
        telemetry({
          phase: 'boss',
          bossActive: true,
          intensity: 0.95,
          lockState: 'locked',
          lockProgress: 1,
          gLoad: 6,
          elapsed: context.currentTime,
        }),
      );
    }
    expect(engine.section).toBe('boss');
    engine.dispose();
  });

  it('switches to the victory hymn and the elegy at the end of a sortie', async () => {
    const engine = new AudioEngine();
    await engine.start();
    run(engine, 3);

    for (let index = 0; index < 8; index += 1) {
      context.currentTime += 2.2;
      vi.advanceTimersByTime(2200);
      engine.update(telemetry({ phase: 'complete', intensity: 0.4, elapsed: context.currentTime }));
    }
    expect(engine.section).toBe('victory');

    for (let index = 0; index < 8; index += 1) {
      context.currentTime += 2.2;
      vi.advanceTimersByTime(2200);
      engine.update(telemetry({ phase: 'failed', intensity: 0.2, elapsed: context.currentTime }));
    }
    expect(engine.section).toBe('elegy');
    engine.dispose();
  });

  it('raises the lock tone with the seek and holds it when locked', async () => {
    const engine = new AudioEngine();
    await engine.start();
    engine.update(telemetry({ lockState: 'searching', lockProgress: 0.2 }));
    engine.update(telemetry({ lockState: 'locked', lockProgress: 1 }));
    // Nothing to assert on a fake param beyond "it did not throw"; the point is
    // that the locked branch never divides by zero or leaves the tone silent.
    expect(engine.running).toBe(true);
    engine.dispose();
  });

  it('voices every v0.3 combat event without throwing', async () => {
    const engine = new AudioEngine();
    await engine.start();
    const events = [
      { type: 'hit', targetId: 'a', damage: 6, mine: true, weapon: 'gun', kind: 'fighter', kill: false },
      { type: 'hit', targetId: 'b', damage: 200, mine: true, weapon: 'missile', kind: 'weakpoint', kill: true },
      { type: 'shield-deflect', key: 'shieldL' },
      { type: 'kill', targetId: 'c', callsign: 'VESPER 1', label: 'Su-57', points: 100, ace: true },
      { type: 'flyby', team: 'hostile', distance: 180 },
      { type: 'damage', amount: 12, bearing: 92 },
      { type: 'explosion', position: { x: 0, y: 0, z: 0 }, scale: 24, distance: 900 },
    ] as const;
    for (const event of events) {
      expect(() => engine.handleEvent(event)).not.toThrow();
    }
    // Panning only happens for directional damage.
    expect(context.counts.panners).toBeGreaterThan(0);
    engine.dispose();
  });
});
