import {
  barSeconds,
  chordForBar,
  midiToFreq,
  phraseForBar,
  phraseNoteToMidi,
  SCORE_SECTIONS,
  selectSection,
  type SectionId,
} from './score';
// The telegraph cues are timed by the attack book rather than by their own
// constants, so retuning a warning window cannot desync its sound.
import { BOSS_ATTACKS } from '../sim/boss';
import type { AudioTelemetry, BossAttackId, SimEvent, TargetKind } from '../sim/types';

type BusName = 'engine' | 'music' | 'sfx' | 'warning';

/** Layers inside the music bus, so the arrangement can be mixed per section. */
type MusicLayer = 'pad' | 'lead' | 'harp' | 'brass' | 'perc' | 'ostinato';

/** Seconds the radio ducks the score so a line always reads. */
const DUCK_TIME = 1.05;
/** Seconds the score stays under the lance beam — it should own the mix. */
const LANCE_DUCK_TIME = 2.4;
/** Scheduler wake-up. The lookahead must stay comfortably above this. */
const SCORE_TICK_MS = 90;
const SCORE_LOOKAHEAD = 0.85;
/** Bars that must play before the arrangement is allowed to move on. */
const SECTION_MIN_BARS = 2;

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function isAudioContextAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

/**
 * Fully procedural audio: engine drone, wind, weapons, damage and — new in
 * v0.3 — an arranged generative score plus a layered impact vocabulary. v0.5
 * adds the flare launch (a mortar, three cartridges and a burning candle) and
 * the boss attack vocabulary, each attack telegraphing itself with its own
 * mechanical signature.
 *
 * The score is scheduled a bar at a time against `AudioContext.currentTime`
 * rather than fired from timers, so the pad, the lead line and the taiko stay
 * locked to the same grid no matter what the frame rate is doing. No audio
 * files are shipped; the reverb tail is a procedurally generated impulse.
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

  /* --- v0.3 score ---------------------------------------------------- */
  private musicGain: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private layers: Partial<Record<MusicLayer, GainNode>> = {};
  private scoreTimer: number | null = null;
  private scoreSection: SectionId = 'soar';
  private pendingSection: SectionId | null = null;
  private scoreBar = 0;
  private scoreBarsInSection = 0;
  private scoreBarTime = 0;
  private duckUntil = 0;
  private nextAlarmAt = 0;

  /* --- v0.5 boss attacks --------------------------------------------- */
  /**
   * Output of the telegraph cue currently sounding. The sustained layers of a
   * cue connect here instead of straight to a bus, so the phase change that
   * ends the warning can also end the sound.
   */
  private telegraphGain: GainNode | null = null;

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

  /** Which arrangement is playing — exposed for the systems page and tests. */
  get section(): SectionId {
    return this.scoreSection;
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

    /* Lock tone: rises with the seek, then goes solid. */
    if (this.lockGain && this.lockOsc) {
      const progress = clamp01(telemetry.lockProgress);
      const searching = telemetry.lockState === 'searching';
      const locked = telemetry.lockState === 'locked';
      if (locked) {
        this.lockOsc.frequency.setTargetAtTime(1240, now, 0.04);
        this.lockGain.gain.setTargetAtTime(0.05, now, 0.02);
      } else if (searching) {
        this.lockOsc.frequency.setTargetAtTime(620 + progress * 430, now, 0.06);
        const pulse = Math.sin(now * Math.PI * 2 * (4 + progress * 5)) > 0.4 ? 0.03 : 0;
        this.lockGain.gain.setTargetAtTime(pulse, now, 0.02);
      } else {
        this.lockGain.gain.setTargetAtTime(0, now, 0.05);
      }
    }
    if (this.rwrGain) {
      const rate = 5.4 + telemetry.threat * 3.4;
      const fast = Math.sin(now * Math.PI * 2 * rate) > 0.2;
      const target = telemetry.missileWarning ? (fast ? 0.055 : 0.006) : 0;
      this.rwrGain.gain.setTargetAtTime(target, now, 0.015);
    }

    /* Score dynamics: louder and denser as the fight heats up, ducked under radio. */
    if (this.musicGain) {
      const phaseGain =
        telemetry.phase === 'complete' ? 1 : telemetry.phase === 'failed' ? 0.78 : 0.86;
      const ducked = now < this.duckUntil ? 0.42 : 1;
      const target = phaseGain * ducked * (0.78 + telemetry.intensity * 0.34);
      this.musicGain.gain.setTargetAtTime(target, now, ducked < 1 ? 0.07 : 0.5);
    }

    /* Low-hull alarm: gets faster as the airframe gives out. */
    const critical =
      active && telemetry.hpRatio > 0 && telemetry.hpRatio < 0.34;
    if (critical && now >= this.nextAlarmAt) {
      const severity = clamp01((0.34 - telemetry.hpRatio) / 0.34);
      this.nextAlarmAt = now + 1.4 - severity * 0.75;
      this.beep(720 + severity * 260, 0.09, 0.02 + severity * 0.018, 'square', 'warning');
      this.schedule(110, () => this.beep(480, 0.09, 0.016 + severity * 0.014, 'triangle', 'warning'));
    }

    this.pendingSection = selectSection({
      phase: telemetry.phase,
      elapsed: telemetry.elapsed,
      intensity: telemetry.intensity,
    }).section;

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
        this.playExplosion(clamp01(event.scale / 60), event.scale > 40, event.distance);
        break;
      case 'hit':
        if (event.mine) {
          const now = performance.now();
          if (now - this.lastHitAt > 45) {
            this.lastHitAt = now;
            this.playHitConfirm(event.kind, event.kill, event.weapon);
          }
        }
        break;
      case 'shield-deflect':
        this.playShieldDeflect();
        break;
      case 'kill':
        this.playKill(event.ace);
        break;
      case 'flyby':
        this.playFlyby(event.distance, event.team === 'hostile');
        break;
      case 'flare':
        this.playFlare();
        break;
      case 'damage':
        this.playDamage(event.bearing, event.amount);
        break;
      case 'hull-impact':
        this.playHullImpact(event.damage);
        break;
      case 'warning':
        if (event.warning.kind === 'missile' || event.warning.kind === 'boss') {
          this.beep(720, 0.08, 0.03, 'sawtooth');
        }
        break;
      case 'radio':
        this.playRadioSquelch();
        this.duckUntil = this.ctx.currentTime + DUCK_TIME;
        break;
      case 'boss-intro':
        this.playBossIntro();
        this.duckUntil = this.ctx.currentTime + 2.6;
        break;
      case 'boss-attack':
        // Only the telegraph is a cue of its own. The later phases cut it, so a
        // charge that is interrupted cannot whine over whatever ended it.
        if (event.phase === 'telegraph') this.playBossTelegraph(event.id);
        else this.cutTelegraph();
        break;
      case 'boss-lance-fire':
        this.playLanceFire();
        this.duckUntil = this.ctx.currentTime + LANCE_DUCK_TIME;
        break;
      case 'boss-shield-down':
        this.playExplosion(0.8, true, 1800);
        break;
      case 'boss-destroyed':
        this.playBossDeath();
        this.duckUntil = this.ctx.currentTime + 3.4;
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
      case 'view-change':
        this.playViewChange(event.mode === 'chase');
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
    if (this.scoreTimer !== null) window.clearInterval(this.scoreTimer);
    this.scoreTimer = null;
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
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 24;
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
      ['music', 0.62],
      ['sfx', 0.72],
      ['warning', 0.5],
    ] as Array<[BusName, number]>) {
      const node = ctx.createGain();
      node.gain.value = gain;
      node.connect(this.master);
      this.buses[name] = node;
    }

    this.buildScoreGraph();
    this.buildEngineGraph();
    this.buildToneGraph();
  }

  /** Music submix: per-layer gains, a procedural hall and the dynamic master. */
  private buildScoreGraph(): void {
    const ctx = this.ctx;
    const bus = this.buses.music;
    if (!ctx || !bus) return;

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.9;
    this.musicGain.connect(bus);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.createImpulse(2.1, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.34;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.musicGain);

    for (const [name, gain] of [
      ['pad', 0.78],
      ['lead', 0.9],
      ['harp', 0.6],
      ['brass', 0.68],
      ['perc', 0.82],
      ['ostinato', 0.4],
    ] as Array<[MusicLayer, number]>) {
      const node = ctx.createGain();
      node.gain.value = gain;
      node.connect(this.musicGain);
      this.layers[name] = node;
    }
  }

  private buildEngineGraph(): void {
    const ctx = this.ctx;
    const engineBus = this.buses.engine;
    if (!ctx || !engineBus) return;
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
  }

  /** The two always-on tones: the seek/lock tone and the missile-warning pair. */
  private buildToneGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.lockOsc = ctx.createOscillator();
    this.lockOsc.type = 'square';
    this.lockOsc.frequency.value = 980;
    this.lockGain = ctx.createGain();
    this.lockGain.gain.value = 0;
    this.lockOsc.connect(this.lockGain);
    this.lockGain.connect(this.buses.sfx ?? this.master ?? ctx.destination);
    this.lockOsc.start();

    this.rwrOsc = ctx.createOscillator();
    this.rwrOsc.type = 'triangle';
    this.rwrOsc.frequency.value = 660;
    this.rwrGain = ctx.createGain();
    this.rwrGain.gain.value = 0;
    this.rwrOsc.connect(this.rwrGain);
    this.rwrGain.connect(this.buses.warning ?? this.master ?? ctx.destination);
    this.rwrOsc.start();
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

  /**
   * Procedural hall impulse: decaying noise with a short pre-delay. Cheaper and
   * far more controllable than shipping an IR file, and it gives the score the
   * depth that a dry oscillator stack never has.
   */
  private createImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error('Audio context missing');
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const t = index / length;
        const envelope = (1 - t) ** decay;
        // A little early-reflection shaping keeps it from sounding like a fade-out.
        const shimmer = index < ctx.sampleRate * 0.02 ? 0.35 : 1;
        data[index] = (Math.random() * 2 - 1) * envelope * shimmer;
      }
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
    const ctx = this.ctx;
    if (!ctx) return;
    this.scoreSection = 'soar';
    this.scoreBar = 0;
    this.scoreBarsInSection = 0;
    this.scoreBarTime = ctx.currentTime + 0.2;
    this.scoreTimer = window.setInterval(() => this.pumpScore(), SCORE_TICK_MS);
  }

  /**
   * Lookahead scheduler. Bars are committed a fraction of a second before they
   * are heard so the WebAudio clock, not the timer, decides when notes start.
   */
  private pumpScore(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.paused || this.volumes.muted) {
      // Freeze the arrangement instead of letting bars pile up while silent.
      this.scoreBarTime = Math.max(this.scoreBarTime, ctx.currentTime + 0.35);
      return;
    }
    let guard = 0;
    while (this.scoreBarTime < ctx.currentTime + SCORE_LOOKAHEAD && guard < 6) {
      guard += 1;
      this.resolveSection();
      const section = SCORE_SECTIONS[this.scoreSection];
      this.scheduleBar(this.scoreBarTime);
      this.scoreBarTime += barSeconds(section);
      this.scoreBar += 1;
      this.scoreBarsInSection += 1;
    }
  }

  /** Move to the next requested section, but only on a bar line. */
  private resolveSection(): void {
    const next = this.pendingSection;
    if (!next || next === this.scoreSection) return;
    const terminal = next === 'victory' || next === 'elegy';
    if (!terminal && this.scoreBarsInSection < SECTION_MIN_BARS) return;
    this.scoreSection = next;
    this.scoreBar = 0;
    this.scoreBarsInSection = 0;
    if (next === 'boss' || next === 'assault') this.playRiser();
  }

  private scheduleBar(at: number): void {
    const section = SCORE_SECTIONS[this.scoreSection];
    const beat = 60 / section.bpm;
    const barLength = beat * 4;
    const energy = section.energy;
    const chord = chordForBar(section, this.scoreBar);
    const bass = chord[0] ?? 38;

    /* 1 ── strings: the bed the whole cue sits on --------------------- */
    const padTones = [chord[1], chord[2], chord[3], section.choir ? chord[4] : null].filter(
      (midi): midi is number => typeof midi === 'number',
    );
    for (const midi of padTones) {
      this.voicePad(midi, at, barLength * 1.02, section.pad * (0.03 + energy * 0.014));
    }
    if (section.choir) {
      this.voiceChoir((chord[2] ?? 57) + 7, at, barLength * 1.02, section.pad * 0.03);
    }

    /* 2 ── bass ------------------------------------------------------- */
    this.voiceBass(bass, at, beat * 3.2, 0.06 + energy * 0.035);
    if (energy > 0.5) this.voiceBass(bass, at + beat * 3, beat * 0.9, 0.04 + energy * 0.025);

    /* 3 ── harp arpeggio --------------------------------------------- */
    if (section.harp > 0.01) {
      const arp = [chord[1], chord[2], chord[3], chord[4]].filter(
        (midi): midi is number => typeof midi === 'number',
      );
      const steps = energy > 0.7 ? 8 : 4;
      for (let index = 0; index < steps; index += 1) {
        const midi = (arp[index % Math.max(1, arp.length)] ?? 57) + (index >= arp.length ? 12 : 0);
        this.voiceHarp(midi, at + (index * barLength) / steps, section.harp * 0.05);
      }
    }

    /* 4 ── string ostinato ------------------------------------------- */
    if (section.ostinato !== 'none') {
      const subdivisions = section.ostinato === 'sixteenth' ? 16 : 8;
      const root = (chord[1] ?? 50) + 12;
      for (let index = 0; index < subdivisions; index += 1) {
        const accent = index % 4 === 0 ? 1 : 0.5;
        this.voiceOstinato(
          root,
          at + (index * barLength) / subdivisions,
          (0.022 + energy * 0.024) * accent,
        );
      }
    }

    /* 5 ── brass stabs ----------------------------------------------- */
    if (section.brass > 0.01) {
      const hits = energy > 0.8 ? [0, 2.5] : [0];
      const colour = chord[2] ?? 45;
      for (const offset of hits) {
        for (const midi of [colour, colour + 7]) {
          this.voiceBrass(
            midi,
            at + offset * beat,
            beat * (energy > 0.8 ? 0.7 : 1.8),
            section.brass * 0.045,
          );
        }
      }
    }

    /* 6 ── percussion ------------------------------------------------- */
    const pattern = section.percussion;
    const step = barLength / 16;
    for (const index of pattern.kick) this.hitKick(at + index * step, 0.13 * (0.6 + energy * 0.5));
    for (const index of pattern.snare) this.hitSnare(at + index * step, 0.05 + energy * 0.04);
    for (const index of pattern.hat) this.hitHat(at + index * step, 0.014 + energy * 0.012);
    for (const index of pattern.tom) this.hitTom(at + index * step, 0.045 + energy * 0.035);
    for (const index of pattern.crash) this.hitCrash(at + index * step, 0.03 + energy * 0.03);

    /* 7 ── the tune --------------------------------------------------- */
    const phrase = phraseForBar(section, this.scoreBar);
    const repeats = Math.max(1, Math.round(4 / phrase.span));
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (const note of phrase.notes) {
        const offset = (repeat * phrase.span + note.beat) * beat;
        if (offset >= barLength) continue;
        this.voiceLead(
          phraseNoteToMidi(section, note),
          at + offset,
          Math.max(0.12, note.length * beat * 0.94),
          (0.042 + energy * 0.046) * note.accent,
          Boolean(note.glide),
        );
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* instruments                                                         */
  /* ------------------------------------------------------------------ */

  private layer(name: MusicLayer): GainNode | null {
    return this.layers[name] ?? null;
  }

  private sendReverb(node: AudioNode, amount: number): void {
    if (!this.reverbSend) return;
    const send = this.ctx?.createGain();
    if (!send) return;
    send.gain.value = amount;
    node.connect(send);
    send.connect(this.reverbSend);
  }

  private voicePad(midi: number, at: number, duration: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('pad');
    if (!ctx || !bus || level <= 0.0004) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(460, at);
    filter.frequency.linearRampToValueAtTime(1500, at + duration * 0.5);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + Math.min(1.7, duration * 0.35));
    gain.gain.setValueAtTime(level, at + duration * 0.72);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.6);
    filter.connect(gain);
    gain.connect(bus);
    this.sendReverb(gain, 0.5);
    for (const detune of [-8, 0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = detune + (Math.random() - 0.5) * 5;
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + duration + 0.7);
    }
  }

  /** A vowel-ish fifth that only appears in the epic sections. */
  private voiceChoir(midi: number, at: number, duration: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('pad');
    if (!ctx || !bus || level <= 0.0004) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + duration * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.5);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 720;
    formant.Q.value = 1.4;
    gain.connect(bus);
    formant.connect(gain);
    this.sendReverb(gain, 0.7);
    for (const detune of [-5, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = detune;
      osc.connect(formant);
      osc.start(at);
      osc.stop(at + duration + 0.6);
    }
  }

  /**
   * The soaring lead: a triangle/saw pair with vibrato and an optional scoop
   * into the note, fed to the hall. This is the voice that carries the tune.
   */
  private voiceLead(
    midi: number,
    at: number,
    duration: number,
    level: number,
    glide: boolean,
  ): void {
    const ctx = this.ctx;
    const bus = this.layer('lead');
    if (!ctx || !bus || level <= 0.0004) return;
    const freq = midiToFreq(midi);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.09);
    gain.gain.setValueAtTime(level, at + Math.max(0.1, duration * 0.6));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.42);
    gain.connect(bus);
    this.sendReverb(gain, 0.62);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    if (glide) {
      osc.frequency.setValueAtTime(freq * 2 ** (-1.6 / 12), at);
      osc.frequency.exponentialRampToValueAtTime(freq, at + 0.15);
    } else {
      osc.frequency.setValueAtTime(freq, at);
    }
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + duration + 0.5);

    const colour = ctx.createOscillator();
    colour.type = 'sawtooth';
    colour.frequency.value = freq;
    colour.detune.value = 6;
    const colourGain = ctx.createGain();
    colourGain.gain.value = 0.32;
    colour.connect(colourGain);
    colourGain.connect(gain);
    colour.start(at);
    colour.stop(at + duration + 0.5);

    // Vibrato arrives after the attack, the way a player would add it.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.4 + Math.random() * 1.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, at);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.007, at + 0.35);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoGain.connect(colour.frequency);
    lfo.start(at);
    lfo.stop(at + duration + 0.5);
  }

  private voiceBass(midi: number, at: number, duration: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('pad');
    if (!ctx || !bus || level <= 0.0004) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.connect(gain);
    gain.connect(bus);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + duration + 0.1);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq(midi) / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.6;
    sub.connect(subGain);
    subGain.connect(filter);
    sub.start(at);
    sub.stop(at + duration + 0.1);
  }

  private voiceHarp(midi: number, at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('harp');
    if (!ctx || !bus || level <= 0.0004) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    gain.connect(bus);
    this.sendReverb(gain, 0.55);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi + 12);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + 1.2);
  }

  private voiceBrass(midi: number, at: number, duration: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('brass');
    if (!ctx || !bus || level <= 0.0004) return;
    const freq = midiToFreq(midi);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.07);
    gain.gain.setValueAtTime(level, at + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.18);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, at);
    filter.frequency.linearRampToValueAtTime(1250, at + 0.14);
    filter.Q.value = 1.1;
    filter.connect(gain);
    gain.connect(bus);
    this.sendReverb(gain, 0.42);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 0.97, at);
    osc.frequency.linearRampToValueAtTime(freq, at + 0.09);
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + duration + 0.25);
  }

  private voiceOstinato(midi: number, at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('ostinato');
    if (!ctx || !bus || level <= 0.0004) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.9;
    filter.connect(gain);
    gain.connect(bus);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(midi);
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + 0.25);
  }

  /* --- percussion ---------------------------------------------------- */

  private noiseSource(at: number): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer) return null;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.loopStart = Math.random() * 1.5;
    source.loopEnd = source.loopStart + 0.4;
    source.start(at, source.loopStart);
    return source;
  }

  private hitKick(at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('perc');
    if (!ctx || !bus || level <= 0.0004) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(152, at);
    osc.frequency.exponentialRampToValueAtTime(44, at + 0.17);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.36);
    osc.connect(gain);
    gain.connect(bus);
    this.sendReverb(gain, 0.2);
    osc.start(at);
    osc.stop(at + 0.4);

    const click = this.noiseSource(at);
    if (!click) return;
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'lowpass';
    clickFilter.frequency.value = 320;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(level * 0.5, at);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(bus);
    click.stop(at + 0.08);
  }

  private hitSnare(at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('perc');
    if (!ctx || !bus || level <= 0.0004) return;
    const noise = this.noiseSource(at);
    if (noise) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1900;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.19);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      this.sendReverb(gain, 0.3);
      noise.stop(at + 0.22);
    }
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, at);
    body.frequency.exponentialRampToValueAtTime(150, at + 0.1);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(level * 0.6, at);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    body.connect(bodyGain);
    bodyGain.connect(bus);
    body.start(at);
    body.stop(at + 0.14);
  }

  private hitHat(at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('perc');
    if (!ctx || !bus || level <= 0.0004) return;
    const noise = this.noiseSource(at);
    if (!noise) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    noise.stop(at + 0.08);
  }

  private hitTom(at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('perc');
    if (!ctx || !bus || level <= 0.0004) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(226, at);
    osc.frequency.exponentialRampToValueAtTime(88, at + 0.28);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
    osc.connect(gain);
    gain.connect(bus);
    this.sendReverb(gain, 0.3);
    osc.start(at);
    osc.stop(at + 0.45);
  }

  private hitCrash(at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.layer('perc');
    if (!ctx || !bus || level <= 0.0004) return;
    const noise = this.noiseSource(at);
    if (!noise) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.7);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    this.sendReverb(gain, 0.6);
    noise.stop(at + 1.8);
  }

  /** Rising sweep that announces the boss and the section change under it. */
  private playRiser(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const duration = 2.4;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.exponentialRampToValueAtTime(4200, now + duration);
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + duration * 0.85);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.2);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.layer('brass') ?? this.musicGain ?? ctx.destination);
    this.sendReverb(gain, 0.5);
    osc.start(now);
    osc.stop(now + duration + 0.3);
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
  /* combat one-shots                                                    */
  /* ------------------------------------------------------------------ */

  private ensureContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Send a finished voice to its bus, optionally placed in the stereo field.
   * StereoPanner is not in every implementation, so the pan is a bonus rather
   * than a requirement — a centred voice is always the safe fallback.
   */
  private connectOut(node: AudioNode, bus: BusName, pan = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const destination = this.buses[bus] ?? this.master ?? ctx.destination;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      panner.connect(destination);
      return;
    }
    node.connect(destination);
  }

  private beep(
    frequency: number,
    duration: number,
    gainValue: number,
    type: OscillatorType = 'square',
    bus: BusName = 'warning',
    pan = 0,
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
    this.connectOut(gain, bus, pan);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noiseBurst(
    duration: number,
    filterType: BiquadFilterType,
    frequency: number,
    gainValue: number,
    bus: BusName,
    pan = 0,
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
    this.connectOut(gain, bus, pan);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  /** A pitched drop — the body of a thump, a clang or a sub hit. */
  private toneDrop(
    from: number,
    to: number,
    duration: number,
    gainValue: number,
    type: OscillatorType,
    bus: BusName,
    pan = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(12, to), now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    this.connectOut(gain, bus, pan);
    osc.start(now);
    osc.stop(now + duration + 0.03);
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

    // The launch thump: the rail, not the motor.
    this.toneDrop(240, 62, 0.34, 0.055 * intensity, 'sawtooth', 'sfx');
    this.noiseBurst(0.09, 'lowpass', 420, 0.09 * intensity, 'sfx');
  }

  /**
   * Cannon: three layers. A hard transient for the crack, a pitched drop for
   * the body and a small mechanical rattle so the burst has a rhythm.
   */
  private playGun(): void {
    const jitter = 1 + (Math.random() - 0.5) * 0.12;
    this.noiseBurst(0.032, 'highpass', 3200 * jitter, 0.075, 'sfx');
    this.toneDrop(104 * jitter, 46, 0.1, 0.06, 'sine', 'sfx');
    this.noiseBurst(0.05, 'bandpass', 720, 0.03, 'sfx');
    this.beep(196 * jitter, 0.03, 0.012, 'square', 'sfx');
  }

  /** The "you connected" ping. Different colour for armour and for shields. */
  private playHitConfirm(kind: TargetKind, kill: boolean, weapon: 'gun' | 'missile'): void {
    const base = (kind === 'weakpoint' ? 2480 : 2060) * (1 + (Math.random() - 0.5) * 0.07);
    this.noiseBurst(0.028, 'bandpass', 4600, 0.03, 'sfx');
    this.beep(base, 0.06, 0.045, 'triangle', 'sfx');
    this.beep(base * 1.51, 0.045, 0.026, 'sine', 'sfx');
    if (weapon === 'missile') {
      this.toneDrop(260, 70, 0.24, 0.07, 'sine', 'sfx');
    }
    if (kill) {
      this.schedule(55, () => this.beep(base * 2, 0.13, 0.05, 'triangle', 'sfx'));
      this.schedule(150, () => this.beep(base * 3.02, 0.2, 0.036, 'sine', 'sfx'));
    }
  }

  /** Cold metallic bounce: the shot did not get through. */
  private playShieldDeflect(): void {
    this.noiseBurst(0.08, 'bandpass', 2800, 0.055, 'warning');
    this.toneDrop(1500, 360, 0.3, 0.04, 'sawtooth', 'warning');
    this.beep(540, 0.16, 0.022, 'square', 'warning');
  }

  private playKill(ace: boolean): void {
    const notes = ace ? [69, 74, 81] : [62, 69, 74];
    notes.forEach((midi, index) => {
      this.schedule(index * 85, () =>
        this.beep(midiToFreq(midi), 0.3 - index * 0.05, 0.04, 'triangle', 'sfx'),
      );
    });
  }

  /**
   * Close pass. The delay is the real speed of sound, which is what makes a
   * missile going by feel like it went *past* rather than *off*.
   */
  private playFlyby(distance: number, hostile: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const delay = Math.min(1.2, Math.max(0, distance) / 340);
    const loud = clamp01(1 - distance / 460);
    this.schedule(delay * 1000, () => {
      const context = this.ctx;
      if (!context || !this.noiseBuffer) return;
      const at = context.currentTime;
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(280, at);
      filter.frequency.exponentialRampToValueAtTime(2600, at + 0.34);
      filter.frequency.exponentialRampToValueAtTime(420, at + 0.78);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.02 + loud * 0.075, at + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.buses.sfx ?? this.master ?? context.destination);
      source.start(at);
      source.stop(at + 0.9);
      if (hostile) this.beep(340, 0.12, 0.018, 'sawtooth', 'warning');
    });
  }

  /**
   * Explosion. `distance` is in metres: far bursts arrive late, lose their
   * highs and drop in level, which is what turns a wall of noise into a
   * battlefield with depth.
   */
  private playExplosion(intensity: number, heavy = false, distance = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const delay = Math.min(2.2, Math.max(0, distance) / 340);
    const near = clamp01(1 - distance / 4200);
    const cutoff = (heavy ? 460 : 940) * (0.3 + near * 0.7);
    const level = (heavy ? 0.42 : 0.22) * (0.4 + intensity) * (0.22 + near * 0.78);
    const duration = (heavy ? 1.6 : 0.9) * (0.7 + near * 0.3);

    this.schedule(delay * 1000, () => {
      const context = this.ctx;
      if (!context || !this.noiseBuffer) return;
      const now = context.currentTime;
      const bus = this.buses.sfx ?? this.master ?? context.destination;

      // Crack: the transient that makes the hit land.
      if (near > 0.35) {
        const crack = context.createBufferSource();
        crack.buffer = this.noiseBuffer;
        const crackFilter = context.createBiquadFilter();
        crackFilter.type = 'highpass';
        crackFilter.frequency.value = 1800;
        const crackGain = context.createGain();
        crackGain.gain.setValueAtTime(level * 0.5, now);
        crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
        crack.connect(crackFilter);
        crackFilter.connect(crackGain);
        crackGain.connect(bus);
        crack.start(now);
        crack.stop(now + 0.06);
      }

      // Body.
      const noise = context.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + duration);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      noise.start(now);
      noise.stop(now + duration + 0.05);

      // Sub: felt rather than heard, and only when it is close.
      if (near > 0.5) {
        const sub = context.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(heavy ? 74 : 110, now);
        sub.frequency.exponentialRampToValueAtTime(28, now + duration * 0.8);
        const subGain = context.createGain();
        subGain.gain.setValueAtTime((heavy ? 0.2 : 0.09) * (0.5 + intensity) * near, now);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        sub.connect(subGain);
        subGain.connect(bus);
        sub.start(now);
        sub.stop(now + duration + 0.05);
      }

      // Debris tail: falling, scattered metal after the blast.
      const tail = context.createBufferSource();
      tail.buffer = this.noiseBuffer;
      const tailFilter = context.createBiquadFilter();
      tailFilter.type = 'bandpass';
      tailFilter.frequency.value = 1500 + Math.random() * 900;
      tailFilter.Q.value = 0.6;
      const tailGain = context.createGain();
      tailGain.gain.setValueAtTime(0.0001, now + 0.12);
      tailGain.gain.exponentialRampToValueAtTime(level * 0.16, now + 0.22);
      tailGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      tail.connect(tailFilter);
      tailFilter.connect(tailGain);
      tailGain.connect(bus);
      tail.start(now);
      tail.stop(now + 1);
    });
  }

  private playBossDeath(): void {
    this.playExplosion(1, true, 0);
    this.schedule(280, () => this.playExplosion(0.8, true, 220));
    this.schedule(640, () => this.playExplosion(0.9, true, 480));
    this.schedule(1040, () => this.playExplosion(1, true, 760));
    this.schedule(420, () => this.toneDrop(180, 40, 2.6, 0.09, 'sawtooth', 'music'));
    this.schedule(420, () => this.beep(58, 2.8, 0.07, 'triangle', 'music'));
  }

  /* ------------------------------------------------------------------ */
  /* v0.5 boss attacks                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Telegraph cue for a boss attack. Each attack gets its own mechanical
   * signature so the answer can be picked from audio alone: the ordinary
   * missile warning is a single 720 Hz saw, and none of these four repeats it.
   *
   * The length comes from the attack book, so retuning a warning window cannot
   * desync the cue that fills it.
   */
  private playBossTelegraph(id: BossAttackId): void {
    const seconds = BOSS_ATTACKS[id].telegraph;
    switch (id) {
      case 'lance':
        this.playLanceCharge(seconds);
        break;
      case 'pulse':
        this.playPulseCharge(seconds);
        break;
      case 'salvo':
        this.playSalvoTelegraph(seconds);
        break;
      case 'ciws':
        this.playCiwsSpinUp(seconds);
        break;
    }
  }

  /**
   * Open the shared output for a telegraph cue and register it as the live one.
   * Every sustained layer of the cue connects here rather than straight to a
   * bus, so the phase change that ends the warning can also end the sound.
   */
  private beginTelegraph(bus: BusName): GainNode | null {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    this.cutTelegraph();
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.buses[bus] ?? this.master ?? ctx.destination);
    this.telegraphGain = out;
    return out;
  }

  /**
   * Drop whatever telegraph is sounding. Each layer was given a stop time of
   * its own, so fading the shared gain is enough — and it keeps a 3 s lance
   * charge from whining over the shot that ended it.
   */
  private cutTelegraph(): void {
    const ctx = this.ctx;
    const out = this.telegraphGain;
    this.telegraphGain = null;
    if (!ctx || !out) return;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  }

  /**
   * `lance`: a capacitor filling. The whine has to be audible from the first
   * frame and rise the whole way, because for three seconds it *is* the
   * countdown — slow at first, then visibly accelerating into the shot.
   */
  private playLanceCharge(seconds: number): void {
    const ctx = this.ensureContext();
    const out = this.beginTelegraph('warning');
    if (!ctx || !out) return;
    const now = ctx.currentTime;
    const release = 0.06;

    // A saw through a resonant low-pass that opens as the charge builds.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(5400, now + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.016, now + seconds * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.055, now + seconds);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds + release);
    filter.connect(gain);
    gain.connect(out);

    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(78, now);
    whine.frequency.exponentialRampToValueAtTime(1180, now + seconds);
    whine.connect(filter);
    whine.start(now);
    whine.stop(now + seconds + release + 0.05);

    // A pure sine an octave up gives the rise a pitch the ear can track, and
    // only arrives near the end, when the capacitor is nearly full.
    const tone = ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(156, now);
    tone.frequency.exponentialRampToValueAtTime(2360, now + seconds);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.02, now + seconds);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds + release);
    tone.connect(toneGain);
    toneGain.connect(out);
    tone.start(now);
    tone.stop(now + seconds + release + 0.05);
  }

  /**
   * `pulse`: the shield ring charging. A resonant sweep for the capacitor and a
   * clock that accelerates towards the discharge — here the tempo, not the
   * pitch, is the warning.
   */
  private playPulseCharge(seconds: number): void {
    const ctx = this.ensureContext();
    const out = this.beginTelegraph('warning');
    if (!ctx || !out) return;
    const now = ctx.currentTime;

    // A saw tracked by a narrow band-pass is the classic ring-modulated sweep.
    const ring = ctx.createOscillator();
    ring.type = 'sawtooth';
    ring.frequency.setValueAtTime(96, now);
    ring.frequency.exponentialRampToValueAtTime(300, now + seconds);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 14;
    band.frequency.setValueAtTime(420, now);
    band.frequency.exponentialRampToValueAtTime(2600, now + seconds);
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0.0001, now);
    ringGain.gain.exponentialRampToValueAtTime(0.05, now + seconds * 0.7);
    ringGain.gain.exponentialRampToValueAtTime(0.07, now + seconds);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds + 0.05);
    ring.connect(band);
    band.connect(ringGain);
    ringGain.connect(out);
    ring.start(now);
    ring.stop(now + seconds + 0.1);

    // The clock: each interval is 82% of the last, so the pattern itself counts
    // down and the player feels the discharge arriving.
    let offset = seconds * 0.1;
    let interval = seconds * 0.24;
    let guard = 0;
    while (offset < seconds - 0.04 && guard < 12) {
      guard += 1;
      this.schedule(offset * 1000, () =>
        this.noiseBurst(0.02, 'bandpass', 2400, 0.026, 'warning'),
      );
      offset += interval;
      interval *= 0.82;
    }
  }

  /**
   * `salvo`: the VLS cells. Actuators charging under the deck, hatch motors
   * clunking open and a low two-tone launch alarm — the busiest of the four
   * cues, because four of these turn into missiles.
   */
  private playSalvoTelegraph(seconds: number): void {
    const ctx = this.ensureContext();
    const out = this.beginTelegraph('warning');
    if (!ctx || !out) return;
    const now = ctx.currentTime;

    // The hydraulic bed: the only sustained layer, and the one a cut takes.
    const whine = ctx.createOscillator();
    whine.type = 'triangle';
    whine.frequency.setValueAtTime(96, now);
    whine.frequency.linearRampToValueAtTime(132, now + seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.03, now + 0.05);
    gain.gain.setValueAtTime(0.03, now + seconds - 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    whine.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    whine.start(now);
    whine.stop(now + seconds + 0.05);

    /* Hatches: three mechanical clunks, low and dry, on the sfx bus — they are
       hardware moving, not an alarm. */
    for (const [index, fraction] of [0, 0.19, 0.38].entries()) {
      this.schedule(fraction * seconds * 1000, () => {
        this.noiseBurst(0.1, 'lowpass', 400 + Math.random() * 90, 0.07, 'sfx');
        this.toneDrop(150, 52 + index * 6, 0.18, 0.05, 'square', 'sfx');
        this.beep(360 - index * 30, 0.13, 0.013, 'triangle', 'sfx');
      });
    }

    /* Alarm: low two-tone whoops, below the 720 Hz missile beep so the two
       never blur together. */
    for (const fraction of [0.1, 0.45, 0.72]) {
      this.schedule(fraction * seconds * 1000, () => {
        this.beep(330, 0.12, 0.03, 'sawtooth', 'warning');
        this.schedule(130, () => this.beep(247, 0.15, 0.026, 'sawtooth', 'warning'));
      });
    }
  }

  /**
   * `ciws`: a motor catching. A barrel cluster spooling up under a stutter of
   * dry mechanical ticks that speeds up — deliberately rattly, and pitched high
   * and irregular so it never reads as the player's own cannon.
   */
  private playCiwsSpinUp(seconds: number): void {
    const ctx = this.ensureContext();
    const out = this.beginTelegraph('warning');
    if (!ctx || !out) return;
    const now = ctx.currentTime;

    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(58, now);
    motor.frequency.exponentialRampToValueAtTime(240, now + seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + seconds * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds + 0.05);
    motor.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    motor.start(now);
    motor.stop(now + seconds + 0.1);

    // The stutter: intervals shrink as the barrels come up to rate, and the
    // ticks alternate sides like the two mounts picking up the track.
    let offset = 0;
    let interval = seconds * 0.3;
    let guard = 0;
    while (offset < seconds - 0.03 && guard < 10) {
      guard += 1;
      const pan = guard % 2 === 0 ? -0.35 : 0.35;
      const bite = 900 + Math.random() * 500 + (offset / seconds) * 1400;
      this.schedule(offset * 1000, () => {
        this.noiseBurst(0.028, 'bandpass', bite, 0.03, 'warning', pan);
        this.toneDrop(220, 90, 0.05, 0.018, 'square', 'warning', pan);
      });
      offset += interval;
      interval *= 0.72;
    }
  }

  /**
   * The spinal lance firing: a sub drop you feel, a bright roar with a fast
   * attack that lasts as long as the beam burns, and the muzzle's metallic
   * ring. The event carries the muzzle and the axis, but the lance is always
   * fired at the player, so it is authored as a point-blank event rather than
   * panned or distance-attenuated like a flyby.
   */
  private playLanceFire(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const bus = this.buses.sfx ?? this.master ?? ctx.destination;

    // Pressure wave, not the beam: deep, quick and gone before the roar.
    this.toneDrop(150, 24, 2.2, 0.16, 'sine', 'sfx');
    this.toneDrop(72, 16, 2.6, 0.1, 'triangle', 'sfx');

    const roar = ctx.createBufferSource();
    roar.buffer = this.noiseBuffer;
    roar.loop = true;
    roar.loopStart = Math.random() * 1.4;
    roar.loopEnd = roar.loopStart + 0.5;
    const shape = ctx.createBiquadFilter();
    shape.type = 'bandpass';
    shape.Q.value = 0.7;
    shape.frequency.setValueAtTime(3600, now);
    shape.frequency.exponentialRampToValueAtTime(520, now + 1.9);
    const roarGain = ctx.createGain();
    roarGain.gain.setValueAtTime(0.0001, now);
    roarGain.gain.exponentialRampToValueAtTime(0.3, now + 0.025); // fast attack
    roarGain.gain.setValueAtTime(0.3, now + 1);
    roarGain.gain.exponentialRampToValueAtTime(0.0001, now + 2);
    roar.connect(shape);
    shape.connect(roarGain);
    roarGain.connect(bus);
    roar.start(now);
    roar.stop(now + 2.1);

    // The white-hot core: a high band that survives the low sweep.
    const core = ctx.createBufferSource();
    core.buffer = this.noiseBuffer;
    core.loop = true;
    core.loopStart = Math.random() * 1.4;
    core.loopEnd = core.loopStart + 0.5;
    const coreFilter = ctx.createBiquadFilter();
    coreFilter.type = 'highpass';
    coreFilter.frequency.value = 4800;
    const coreGain = ctx.createGain();
    coreGain.gain.setValueAtTime(0.0001, now);
    coreGain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    coreGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    core.connect(coreFilter);
    coreFilter.connect(coreGain);
    coreGain.connect(bus);
    core.start(now);
    core.stop(now + 1.3);

    // Muzzle ring, then the smaller panel answer to one side.
    this.playMetalRing(now, 240, 1.8, 0.06, 'sfx');
    this.playMetalRing(now + 0.04, 620, 1.1, 0.03, 'sfx', 0.3);
  }

  /**
   * Inharmonic metallic ring. Struck metal does not sit on a harmonic series,
   * so the partials are deliberately unmusical and the upper ones die first —
   * that is the difference between a hull ringing and a synth chord.
   */
  private playMetalRing(
    at: number,
    base: number,
    duration: number,
    level: number,
    bus: BusName,
    pan = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const out = ctx.createGain();
    out.gain.setValueAtTime(level, at);
    out.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    for (const [index, ratio] of [1, 1.87, 2.63, 4.06].entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.03);
      const partial = ctx.createGain();
      const partialDuration = duration * (1 - index * 0.17);
      partial.gain.setValueAtTime(1 / (1 + index * 0.8), at);
      partial.gain.exponentialRampToValueAtTime(0.0001, at + partialDuration);
      osc.connect(partial);
      partial.connect(out);
      osc.start(at);
      osc.stop(at + partialDuration + 0.05);
    }
    this.connectOut(out, bus, pan);
  }

  /**
   * Countermeasure launch. A flare is four sounds, not one: the mortar kicking
   * the cartridges out of the dispenser, the cartridges igniting, the magnesium
   * burning for well over a second and the whole thing falling away behind the
   * aircraft.
   *
   * The burn is the signature — the old three-click version read as a UI blip
   * rather than as a physical object leaving the airframe, which is why it is
   * built on the audio clock and left to outlive the pops by ~1.5 s.
   */
  private playFlare(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    /* 1 ── dispenser thunk. The mortar is airframe structure, so its body rides
       the engine bus with the afterburner; the pyrotechnics are sfx. */
    this.noiseBurst(0.16, 'lowpass', 520, 0.1, 'engine');
    this.toneDrop(168, 44, 0.24, 0.08, 'sine', 'engine');
    this.noiseBurst(0.035, 'bandpass', 2600, 0.03, 'sfx'); // breech slamming shut

    /* 2 ── three cartridges. They alternate sides — the aircraft carries them on
       both shoulders — and each is detuned, because they are separate objects. */
    let offset = 45;
    for (let index = 0; index < 3; index += 1) {
      const pan = (index % 2 === 0 ? -1 : 1) * (0.26 + Math.random() * 0.24);
      this.schedule(offset, () => this.playFlarePop(pan));
      offset += 40 + Math.random() * 30;
    }

    /* 3 & 4 ── burn and tail are scheduled against `currentTime`, not a timer:
       they are the longest layers and must not drift against the pops. */
    const burn = 1.2 + Math.random() * 0.6;
    const tail = 0.55 + Math.random() * 0.3;
    this.playFlareBurn(now + 0.06, burn);
    this.playFlareFall(now + burn * 0.62, tail);
  }

  /** One cartridge leaving the tube: bright, metallic and a little off-centre. */
  private playFlarePop(pan: number): void {
    const detune = 1 + (Math.random() - 0.5) * 0.16;
    // Case + igniter charge: a short bright band, then the shell ringing as it
    // tumbles. Both sit above the hiss so they cut through it.
    this.noiseBurst(0.07, 'bandpass', 3200 * detune, 0.05, 'sfx', pan);
    this.noiseBurst(0.02, 'highpass', 5200 * detune, 0.028, 'sfx', pan);
    this.toneDrop(1500 * detune, 430, 0.18, 0.026, 'triangle', 'sfx', pan);
  }

  /**
   * The burning candle. A noise voice through a band-pass whose centre
   * frequency slides *down* as the flare burns out, under a slow gain decay and
   * a shallow tremolo. That downward sweep, long after the pops are gone, is
   * what separates a burning countermeasure from a hiss or a click.
   */
  private playFlareBurn(at: number, duration: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.loopStart = Math.random() * 1.4;
    source.loopEnd = source.loopStart + 0.5;
    const flame = ctx.createBiquadFilter();
    flame.type = 'bandpass';
    flame.Q.value = 0.85;
    flame.frequency.setValueAtTime(4200, at);
    flame.frequency.exponentialRampToValueAtTime(560, at + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.055, at + 0.05);
    envelope.gain.exponentialRampToValueAtTime(0.02, at + duration * 0.6);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    // Tremolo lives on its own gain stage so the flicker can never push the
    // envelope itself negative on the way down to silence.
    const flicker = ctx.createGain();
    flicker.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 8 + Math.random() * 6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.22;
    lfo.connect(lfoGain);
    lfoGain.connect(flicker.gain);
    lfo.start(at);
    lfo.stop(at + duration);

    source.connect(flame);
    flame.connect(envelope);
    envelope.connect(flicker);
    this.connectOut(flicker, 'sfx');
    source.start(at);
    source.stop(at + duration + 0.05);

    // A thin bright band above it for the flame front. It rides the same
    // flicker, so both layers breathe together.
    const sizzle = ctx.createBufferSource();
    sizzle.buffer = this.noiseBuffer;
    sizzle.loop = true;
    sizzle.loopStart = Math.random() * 1.4;
    sizzle.loopEnd = sizzle.loopStart + 0.5;
    const sizzleFilter = ctx.createBiquadFilter();
    sizzleFilter.type = 'highpass';
    sizzleFilter.frequency.setValueAtTime(6000, at);
    sizzleFilter.frequency.exponentialRampToValueAtTime(2400, at + duration);
    const sizzleGain = ctx.createGain();
    sizzleGain.gain.setValueAtTime(0.0001, at);
    sizzleGain.gain.exponentialRampToValueAtTime(0.016, at + 0.08);
    sizzleGain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 0.85);
    sizzle.connect(sizzleFilter);
    sizzleFilter.connect(sizzleGain);
    sizzleGain.connect(flicker);
    sizzle.start(at);
    sizzle.stop(at + duration + 0.05);
  }

  /**
   * The tail. The candle is behind the aircraft by now, so it loses its highs
   * and its pitch at the same time: a cheap doppler image, which is what makes
   * the flare read as leaving rather than as simply stopping.
   */
  private playFlareFall(at: number, duration: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.loopStart = Math.random() * 1.4;
    source.loopEnd = source.loopStart + 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(1400, at);
    filter.frequency.exponentialRampToValueAtTime(240, at + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.026, at + duration * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);

    const bus = this.buses.sfx ?? this.master ?? ctx.destination;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(-0.15, at);
      panner.pan.linearRampToValueAtTime(-0.5, at + duration);
      gain.connect(panner);
      panner.connect(bus);
    } else {
      gain.connect(bus);
    }
    source.start(at);
    source.stop(at + duration + 0.05);

    // The falling pitch of it, quiet enough to stay under the hiss.
    const tone = ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(430, at);
    tone.frequency.exponentialRampToValueAtTime(170, at + duration);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.0001, at);
    toneGain.gain.exponentialRampToValueAtTime(0.012, at + duration * 0.2);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    tone.connect(toneGain);
    toneGain.connect(gain);
    tone.start(at);
    tone.stop(at + duration + 0.05);
  }

  private playDamage(bearing = 0, amount = 8): void {
    // Pan the thump toward the side it came from.
    const pan = Math.sin((bearing * Math.PI) / 180);
    this.noiseBurst(0.22, 'lowpass', 650, 0.12, 'sfx');
    this.toneDrop(190, 62, 0.26, 0.05 + clamp01(amount / 20) * 0.05, 'sawtooth', 'warning', pan);
  }

  /**
   * Something big and metallic just hit the airframe — the boss ramming, not a
   * round. Heavy low noise for the crush, a hard crack for the contact and an
   * inharmonic ring for the structure: the ring is what makes it read as hull
   * rather than as another explosion.
   */
  private playHullImpact(damage: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const weight = clamp01(damage / 45);
    const now = ctx.currentTime;

    this.noiseBurst(0.5 + weight * 0.5, 'lowpass', 340 + weight * 300, 0.15 + weight * 0.1, 'sfx');
    this.toneDrop(160, 32, 0.5, 0.1 + weight * 0.06, 'sine', 'sfx');
    this.noiseBurst(0.05, 'highpass', 2400, 0.06, 'sfx');
    this.playMetalRing(now, 190 + Math.random() * 70, 1.4, 0.045 + weight * 0.03, 'sfx');

    // Panels shedding after the hit, so the crush has a tail.
    this.schedule(140 + Math.random() * 80, () =>
      this.noiseBurst(0.22, 'bandpass', 1800 + Math.random() * 900, 0.03, 'sfx'),
    );
  }

  private playRadioSquelch(): void {
    this.noiseBurst(0.07, 'bandpass', 1500, 0.022, 'warning');
  }

  /**
   * Camera change. Deliberately the smallest voice in the engine — a UI
   * confirmation, not an alert — rising into chase and falling back to the
   * cockpit, so the two directions are distinguishable without looking.
   */
  private playViewChange(chase: boolean): void {
    const [first, second] = chase ? [980, 1460] : [1460, 980];
    this.beep(first, 0.045, 0.02, 'sine', 'warning');
    this.schedule(60, () => this.beep(second, 0.06, 0.018, 'sine', 'warning'));
  }

  private playBossIntro(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.playExplosion(0.5, true, 1400);
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
