import type { AudioTelemetry, SimEvent } from '../sim/types';

type BusName = 'engine' | 'music' | 'sfx' | 'warning';

const CHORDS: number[][] = [
  [50, 53, 57, 62], // Dm
  [46, 50, 53, 58], // Bb
  [41, 45, 48, 53], // F
  [48, 52, 55, 60], // C
];

const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function isAudioContextAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

/**
 * Fully procedural theme audio: engine drone, wind, lock tone, RWR, weapons,
 * radio squelch and a slow generative score. No audio files are shipped.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buses: Partial<Record<BusName, GainNode>> = {};
  private noiseBuffer: AudioBuffer | null = null;

  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private lockOsc: OscillatorNode | null = null;
  private lockGain: GainNode | null = null;
  private rwrOsc: OscillatorNode | null = null;
  private rwrGain: GainNode | null = null;

  private musicPadGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private pulseTimer: number | null = null;
  private chordIndex = 0;

  private level = 0;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private volumes = { muted: false, volume: 0.65 };
  private paused = false;
  private started = false;
  private starting = false;
  private lastGunAt = 0;
  private lastHitAt = 0;
  private timers: number[] = [];

  get available(): boolean {
    return isAudioContextAvailable();
  }

  get running(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  async start(): Promise<boolean> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch {
          return false;
        }
      }
      return true;
    }
    if (this.starting || !this.available) return false;
    this.starting = true;
    try {
      const context = new window.AudioContext({ latencyHint: 'interactive' });
      this.ctx = context;
      this.buildGraph();
      await context.resume();
      this.started = true;
      this.startMusic();
      this.applyMaster();
      this.bootSweep();
      return true;
    } catch {
      try {
        await this.ctx?.close();
      } catch {
        /* noop */
      }
      this.ctx = null;
      this.started = false;
      return false;
    } finally {
      this.starting = false;
    }
  }

  setVolumes(muted: boolean, volume: number): void {
    this.volumes = { muted, volume: clamp01(volume) };
    this.applyMaster();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMaster();
  }

  async suspend(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.suspend();
    } catch {
      /* noop */
    }
  }

  async resume(): Promise<void> {
    if (!this.ctx || this.volumes.muted) return;
    try {
      await this.ctx.resume();
    } catch {
      /* noop */
    }
  }

  getLevel(): number {
    return this.level;
  }

  update(telemetry: AudioTelemetry): void {
    this.paused = telemetry.paused;
    this.applyMaster();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const active = !telemetry.paused && ['dogfight', 'boss', 'boss-intro'].includes(telemetry.phase);
    const speedNorm = clamp01((telemetry.speed - 140) / 360);

    if (this.engineFilter && this.engineGain && this.engineOscA && this.engineOscB) {
      this.engineFilter.frequency.setTargetAtTime(
        220 + speedNorm * 680 + telemetry.throttle * 380,
        now,
        0.12,
      );
      this.engineGain.gain.setTargetAtTime(
        active ? 0.032 + telemetry.throttle * 0.055 : 0.006,
        now,
        0.15,
      );
      this.engineOscA.frequency.setTargetAtTime(42 + telemetry.throttle * 38, now, 0.2);
      this.engineOscB.frequency.setTargetAtTime(68 + telemetry.throttle * 52, now, 0.2);
    }
    this.windGain?.gain.setTargetAtTime(
      active
        ? 0.012 + speedNorm * 0.05 + (telemetry.airbrake ? 0.032 : 0) + (telemetry.maneuver ? 0.014 : 0)
        : 0.002,
      now,
      0.2,
    );

    if (this.lockGain) {
      const searching = telemetry.lockState === 'searching';
      const locked = telemetry.lockState === 'locked';
      const pulse = Math.sin(now * Math.PI * 2 * 3.4) > 0.45 ? 0.024 : 0;
      const target = locked ? 0.046 : searching ? pulse : 0;
      this.lockGain.gain.setTargetAtTime(target, now, 0.02);
    }
    if (this.rwrGain) {
      const fast = Math.sin(now * Math.PI * 2 * 5.4) > 0.2;
      const target = telemetry.missileWarning ? (fast ? 0.055 : 0.006) : 0;
      this.rwrGain.gain.setTargetAtTime(target, now, 0.015);
    }
    if (this.musicPadGain) {
      const target = telemetry.phase === 'complete' ? 0.1 : telemetry.paused ? 0.12 : 0.2;
      this.musicPadGain.gain.setTargetAtTime(target, now, 1.2);
    }

    if (this.analyser && this.data) {
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (let index = 0; index < this.data.length; index += 1) {
        const value = (this.data[index]! - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / this.data.length);
      this.level += (clamp01(rms * 4.2) - this.level) * 0.18;
    }
  }

  handleEvent(event: SimEvent): void {
    if (!this.ctx || !this.started) return;
    switch (event.type) {
      case 'launch':
        this.playLaunchSweep();
        break;
      case 'lock-acquired':
        this.beep(1180, 0.07, 0.04, 'square');
        this.schedule(90, () => this.beep(1580, 0.09, 0.045, 'square'));
        break;
      case 'missile-fire':
        this.playMissile(event.team === 'player' ? 1 : 0.7);
        break;
      case 'gun-fire': {
        const now = performance.now();
        if (now - this.lastGunAt > 70) {
          this.lastGunAt = now;
          this.playGun();
        }
        break;
      }
      case 'explosion':
        this.playExplosion(clamp01(event.scale / 60), event.scale > 40);
        break;
      case 'hit': {
        const now = performance.now();
        if (now - this.lastHitAt > 55) {
          this.lastHitAt = now;
          this.noiseBurst(0.06, 'bandpass', 2200, 0.035, 'sfx');
        }
        break;
      }
      case 'flare':
        this.playFlare();
        break;
      case 'damage':
        this.playDamage();
        break;
      case 'warning':
        if (event.warning.kind === 'missile' || event.warning.kind === 'boss') {
          this.beep(720, 0.08, 0.03, 'sawtooth');
        }
        break;
      case 'radio':
        this.playRadioSquelch();
        break;
      case 'boss-intro':
        this.playBossIntro();
        break;
      case 'boss-shield-down':
        this.playExplosion(0.8, true);
        break;
      case 'boss-destroyed':
        this.playBossDeath();
        break;
      case 'mission-complete':
        this.playComplete();
        break;
      case 'mission-failed':
        this.playFailure();
        break;
      case 'afterburner':
        this.noiseBurst(0.5, 'lowpass', 900, 0.05, 'engine');
        break;
      case 'resupply':
        this.beep(1320, 0.05, 0.025, 'square');
        this.schedule(80, () => this.beep(1760, 0.06, 0.025, 'square'));
        break;
      case 'maneuver-start':
        // Hydraulic whine of the control surfaces slamming to the stops.
        this.noiseBurst(0.42, 'bandpass', 720, 0.055, 'sfx');
        this.beep(320, 0.16, 0.03, 'sawtooth', 'sfx');
        break;
      case 'maneuver-end':
        this.noiseBurst(0.22, 'highpass', 1400, 0.03, 'sfx');
        break;
      case 'maneuver-blocked':
        this.beep(260, 0.12, 0.035, 'square', 'warning');
        break;
      case 'assist-toggle':
        this.beep(event.enabled ? 980 : 520, 0.06, 0.028, 'triangle', 'warning');
        this.schedule(70, () =>
          this.beep(event.enabled ? 1320 : 380, 0.07, 0.026, 'triangle', 'warning'),
        );
        break;
      case 'assist-engaged':
        this.beep(1500, 0.035, 0.014, 'sine', 'warning');
        break;
      case 'stall':
        this.noiseBurst(0.34, 'bandpass', 460, 0.05, 'warning');
        break;
      case 'tutorial-complete':
        this.beep(880, 0.06, 0.03, 'square', 'warning');
        this.schedule(90, () => this.beep(1320, 0.09, 0.03, 'square', 'warning'));
        break;
      default:
        break;
    }
  }

  dispose(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    if (this.pulseTimer !== null) window.clearInterval(this.pulseTimer);
    this.musicTimer = null;
    this.pulseTimer = null;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers = [];
    try {
      this.engineOscA?.stop();
      this.engineOscB?.stop();
      this.lockOsc?.stop();
      this.rwrOsc?.stop();
    } catch {
      /* noop */
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.started = false;
  }

  /* ------------------------------------------------------------------ */
  /* graph                                                               */
  /* ------------------------------------------------------------------ */

  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 7;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.28;
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.master.connect(this.analyser);
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

    for (const [name, gain] of [
      ['engine', 0.65],
      ['music', 0.5],
      ['sfx', 0.72],
      ['warning', 0.5],
    ] as Array<[BusName, number]>) {
      const node = ctx.createGain();
      node.gain.value = gain;
      node.connect(this.master);
      this.buses[name] = node;
    }

    const engineBus = this.buses.engine;
    if (!engineBus) return;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 2.4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.006;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(engineBus);

    this.engineOscA = ctx.createOscillator();
    this.engineOscA.type = 'sawtooth';
    this.engineOscA.frequency.value = 48;
    this.engineOscB = ctx.createOscillator();
    this.engineOscB.type = 'sawtooth';
    this.engineOscB.frequency.value = 72;
    this.engineOscB.detune.value = -7;
    this.engineOscA.connect(this.engineFilter);
    this.engineOscB.connect(this.engineFilter);
    this.engineOscA.start();
    this.engineOscB.start();

    this.noiseBuffer = this.createNoiseBuffer(2);
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 680;
    windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.002;
    wind.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(engineBus);
    wind.start();

    this.lockOsc = ctx.createOscillator();
    this.lockOsc.type = 'square';
    this.lockOsc.frequency.value = 980;
    this.lockGain = ctx.createGain();
    this.lockGain.gain.value = 0;
    this.lockOsc.connect(this.lockGain);
    this.lockGain.connect(this.buses.sfx ?? this.master);
    this.lockOsc.start();

    this.rwrOsc = ctx.createOscillator();
    this.rwrOsc.type = 'triangle';
    this.rwrOsc.frequency.value = 660;
    this.rwrGain = ctx.createGain();
    this.rwrGain.gain.value = 0;
    this.rwrOsc.connect(this.rwrGain);
    this.rwrGain.connect(this.buses.warning ?? this.master);
    this.rwrOsc.start();

    this.musicPadGain = ctx.createGain();
    this.musicPadGain.gain.value = 0.2;
    this.musicPadGain.connect(this.buses.music ?? this.master);
  }

  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error('Audio context missing');
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    const target = this.volumes.muted || this.paused ? 0 : this.volumes.volume * 0.9;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  /* ------------------------------------------------------------------ */
  /* score                                                               */
  /* ------------------------------------------------------------------ */

  private startMusic(): void {
    this.schedulePad();
    this.musicTimer = window.setInterval(() => this.schedulePad(), 7600);
    this.pulseTimer = window.setInterval(() => this.playPulse(), 750);
  }

  private schedulePad(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicPadGain) return;
    const chord = CHORDS[this.chordIndex % CHORDS.length] ?? CHORDS[0]!;
    this.chordIndex += 1;
    const now = ctx.currentTime + 0.05;
    for (const midi of chord) {
      const osc = ctx.createOscillator();
      osc.type = midi < 48 ? 'triangle' : 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = (Math.random() - 0.5) * 9;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420 + Math.random() * 220;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 2.2);
      gain.gain.setValueAtTime(0.035, now + 5.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 8.4);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicPadGain);
      osc.start(now);
      osc.stop(now + 8.6);
    }
  }

  private playPulse(): void {
    if (!this.ctx || this.paused || this.volumes.muted) return;
    const bus = this.buses.music;
    if (!bus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(116, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  private bootSweep(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 1.4);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(260, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 1.4);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.buses.sfx ?? this.master ?? this.ctx.destination);
    osc.start(now);
    osc.stop(now + 1.7);
  }

  private playLaunchSweep(): void {
    this.noiseBurst(1.4, 'highpass', 340, 0.08, 'engine');
    this.schedule(200, () => this.noiseBurst(1.1, 'bandpass', 1200, 0.05, 'engine'));
  }

  /* ------------------------------------------------------------------ */
  /* one shots                                                           */
  /* ------------------------------------------------------------------ */

  private ensureContext(): AudioContext | null {
    return this.ctx;
  }

  private beep(
    frequency: number,
    duration: number,
    gainValue: number,
    type: OscillatorType = 'square',
    bus: BusName = 'warning',
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.buses[bus] ?? this.master ?? ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noiseBurst(
    duration: number,
    filterType: BiquadFilterType,
    frequency: number,
    gainValue: number,
    bus: BusName,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.buses[bus] ?? this.master ?? ctx.destination);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  private playMissile(intensity: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    if (!this.noiseBuffer) return;
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(1800, now + 0.6);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12 * intensity, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.buses.sfx ?? this.master ?? ctx.destination);
    noise.start(now);
    noise.stop(now + 0.8);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(68, now + 0.6);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.04 * intensity, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(oscGain);
    oscGain.connect(this.buses.sfx ?? this.master ?? ctx.destination);
    osc.start(now);
    osc.stop(now + 0.65);
  }

  private playGun(): void {
    this.noiseBurst(0.045, 'highpass', 900, 0.06, 'sfx');
    this.beep(150, 0.035, 0.02, 'square', 'sfx');
  }

  private playExplosion(intensity: number, heavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const duration = heavy ? 1.6 : 0.9;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    if (!this.noiseBuffer) return;
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 420 : 900, now);
    filter.frequency.exponentialRampToValueAtTime(80, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime((heavy ? 0.42 : 0.22) * (0.4 + intensity), now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.buses.sfx ?? this.master ?? ctx.destination);
    noise.start(now);
    noise.stop(now + duration + 0.05);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(heavy ? 74 : 110, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + duration * 0.8);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime((heavy ? 0.2 : 0.09) * (0.5 + intensity), now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    sub.connect(subGain);
    subGain.connect(this.buses.sfx ?? this.master ?? ctx.destination);
    sub.start(now);
    sub.stop(now + duration + 0.05);
  }

  private playBossDeath(): void {
    this.playExplosion(1, true);
    this.schedule(280, () => this.playExplosion(0.8, true));
    this.schedule(640, () => this.playExplosion(0.9, true));
    this.schedule(1040, () => this.playExplosion(1, true));
  }

  private playFlare(): void {
    for (let index = 0; index < 3; index += 1) {
      this.schedule(index * 45, () => this.noiseBurst(0.08, 'highpass', 2400, 0.05, 'sfx'));
    }
  }

  private playDamage(): void {
    this.noiseBurst(0.22, 'lowpass', 650, 0.12, 'sfx');
    this.beep(180, 0.16, 0.04, 'sawtooth', 'warning');
  }

  private playRadioSquelch(): void {
    this.noiseBurst(0.07, 'bandpass', 1500, 0.022, 'warning');
  }

  private playBossIntro(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.playExplosion(0.5, true);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.buses.music ?? this.master ?? ctx.destination);
    osc.start(now);
    osc.stop(now + 3.1);
  }

  private playComplete(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [62, 66, 69, 74];
    notes.forEach((midi, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      const gain = ctx.createGain();
      const start = now + index * 0.17;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.4);
      osc.connect(gain);
      gain.connect(this.buses.music ?? this.master ?? ctx.destination);
      osc.start(start);
      osc.stop(start + 2.5);
    });
  }

  private playFailure(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 2.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
    osc.connect(gain);
    gain.connect(this.buses.music ?? this.master ?? ctx.destination);
    osc.start(now);
    osc.stop(now + 2.5);
  }

  private schedule(delay: number, callback: () => void): void {
    const timer = window.setTimeout(() => {
      this.timers = this.timers.filter((item) => item !== timer);
      try {
        callback();
      } catch {
        /* noop */
      }
    }, delay);
    this.timers.push(timer);
  }
}
