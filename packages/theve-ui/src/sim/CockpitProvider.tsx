import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { CockpitEngine } from './engine';
import { sunsetSpearScenario } from './scenario';
import type {
  CockpitSnapshot,
  ControlInput,
  Scenario,
  WeaponId,
} from './types';

export type CockpitQuality = 'auto' | 'high' | 'low';

export interface CockpitActions {
  launch: () => void;
  skipBoot: () => void;
  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  restart: () => void;
  warpToBoss: () => void;
  setInput: (partial: Partial<ControlInput>) => void;
  setThrottle: (value: number) => void;
  adjustThrottle: (delta: number) => void;
  setThrottleAxis: (axis: number) => void;
  cycleTarget: () => void;
  selectTarget: (id: string | null) => void;
  fire: () => void;
  startGun: () => void;
  stopGun: () => void;
  fireMissile: () => void;
  flare: () => void;
  cycleWeapon: () => void;
  selectWeapon: (weapon: WeaponId) => void;
  triggerBoss: () => void;
}

export interface CockpitAudio {
  muted: boolean;
  volume: number;
  level: number;
  started: boolean;
  available: boolean;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
}

export interface CockpitSettingsValue {
  quality: CockpitQuality;
  setQuality: (quality: CockpitQuality) => void;
  invertPitch: boolean;
  setInvertPitch: (invert: boolean) => void;
}

interface StoredSettings {
  muted: boolean;
  volume: number;
  quality: CockpitQuality;
  invertPitch: boolean;
}

const STORAGE_KEY = 'theve.settings.v1';
const DEFAULT_SETTINGS: StoredSettings = {
  muted: false,
  volume: 0.65,
  quality: 'auto',
  invertPitch: false,
};

function loadSettings(): StoredSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted,
      volume:
        typeof parsed.volume === 'number'
          ? Math.min(Math.max(parsed.volume, 0), 1)
          : DEFAULT_SETTINGS.volume,
      quality:
        parsed.quality === 'high' || parsed.quality === 'low' || parsed.quality === 'auto'
          ? parsed.quality
          : DEFAULT_SETTINGS.quality,
      invertPitch: Boolean(parsed.invertPitch),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const EngineContext = createContext<CockpitEngine | null>(null);
const SnapshotContext = createContext<CockpitSnapshot | null>(null);
const ActionsContext = createContext<CockpitActions | null>(null);
const AudioContext = createContext<CockpitAudio | null>(null);
const SettingsContext = createContext<CockpitSettingsValue | null>(null);

export interface CockpitProviderProps {
  children: ReactNode;
  scenario?: Scenario;
  audio?: boolean;
}

/**
 * Owns the flight simulation, the React snapshot bridge and procedural audio.
 * The simulation ticks at a fixed 60 Hz; React only receives a 30 Hz snapshot.
 */
export function CockpitProvider({
  children,
  scenario = sunsetSpearScenario,
  audio: audioEnabled = true,
}: CockpitProviderProps) {
  const [engine] = useState(() => new CockpitEngine(scenario));
  const [snapshot, setSnapshot] = useState<CockpitSnapshot>(() => engine.getSnapshot());
  const audioEngineRef = useRef<AudioEngine | null>(null);
  if (!audioEngineRef.current) audioEngineRef.current = new AudioEngine();

  const [settings, setSettings] = useState<StoredSettings>(loadSettings);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage can be unavailable */
    }
  }, [settings]);

  const [audioStarted, setAudioStarted] = useState(false);
  const [level, setLevel] = useState(0);

  const startAudio = useCallback(async () => {
    if (!audioEnabled || settingsRef.current.muted) return;
    const audioEngine = audioEngineRef.current;
    if (!audioEngine) return;
    const ok = await audioEngine.start();
    if (ok) setAudioStarted(true);
  }, [audioEnabled]);

  useEffect(() => {
    const audioEngine = audioEngineRef.current;
    if (!audioEngine) return;
    audioEngine.setVolumes(settings.muted, settings.volume);
  }, [settings.muted, settings.volume]);

  useEffect(() => {
    const audioEngine = audioEngineRef.current;
    return () => {
      audioEngine?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!audioEnabled) return;
    return engine.on((event) => {
      audioEngineRef.current?.handleEvent(event);
    });
  }, [engine, audioEnabled]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let published = 0;
    const loop = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.06);
      previous = now;
      engine.update(dt);
      audioEngineRef.current?.update(engine.getAudioTelemetry());
      if (now - published >= 33) {
        published = now;
        setSnapshot(engine.getSnapshot());
      }
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [engine]);

  useEffect(() => {
    if (!audioStarted) return;
    const interval = window.setInterval(() => {
      setLevel(audioEngineRef.current?.getLevel() ?? 0);
    }, 220);
    return () => window.clearInterval(interval);
  }, [audioStarted]);

  useEffect(() => {
    if (!audioStarted || !audioEnabled) return;
    const onVisibility = () => {
      const audioEngine = audioEngineRef.current;
      if (!audioEngine) return;
      if (document.hidden) void audioEngine.suspend();
      else void audioEngine.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [audioStarted, audioEnabled]);

  const startIfAudible = useCallback(() => {
    if (!settingsRef.current.muted) void startAudio();
  }, [startAudio]);

  const actions = useMemo<CockpitActions>(
    () => ({
      launch: () => {
        engine.launch();
        startIfAudible();
      },
      skipBoot: () => engine.skipBoot(),
      pause: () => {
        engine.pause();
        audioEngineRef.current?.setPaused(true);
      },
      resume: () => {
        engine.resume();
        audioEngineRef.current?.setPaused(false);
      },
      togglePause: () => {
        if (engine.paused) {
          engine.resume();
          audioEngineRef.current?.setPaused(false);
        } else {
          engine.pause();
          audioEngineRef.current?.setPaused(true);
        }
      },
      restart: () => {
        engine.restart();
        audioEngineRef.current?.setPaused(false);
        startIfAudible();
      },
      warpToBoss: () => engine.warpToBoss(),
      setInput: (partial) => engine.setInput(partial),
      setThrottle: (value) => engine.setThrottle(value),
      adjustThrottle: (delta) => engine.adjustThrottle(delta),
      setThrottleAxis: (axis) => engine.setThrottleAxis(axis),
      cycleTarget: () => engine.cycleTarget(),
      selectTarget: (id) => engine.selectTarget(id),
      fire: () => engine.fire(),
      startGun: () => engine.startGun(),
      stopGun: () => engine.stopGun(),
      fireMissile: () => engine.fireMissile(),
      flare: () => engine.flare(),
      cycleWeapon: () => engine.cycleWeapon(),
      selectWeapon: (weapon) => engine.selectWeapon(weapon),
      triggerBoss: () => engine.debugTriggerBoss(),
    }),
    [engine, startIfAudible],
  );

  const setQuality = useCallback((quality: CockpitQuality) => {
    setSettings((current) => ({ ...current, quality }));
  }, []);
  const setInvertPitch = useCallback((invertPitch: boolean) => {
    setSettings((current) => ({ ...current, invertPitch }));
  }, []);

  const audio = useMemo<CockpitAudio>(
    () => ({
      muted: settings.muted,
      volume: settings.volume,
      level,
      started: audioStarted,
      available: audioEnabled && (audioEngineRef.current?.available ?? false),
      toggleMute: () => {
        const nextMuted = !settingsRef.current.muted;
        setSettings((current) => ({ ...current, muted: nextMuted }));
        settingsRef.current = { ...settingsRef.current, muted: nextMuted };
        const audioEngine = audioEngineRef.current;
        if (!audioEngine) return;
        if (!nextMuted) {
          void startAudio();
        } else {
          audioEngine.setVolumes(true, settingsRef.current.volume);
        }
      },
      setVolume: (volume: number) => {
        setSettings((current) => ({ ...current, volume: Math.min(Math.max(volume, 0), 1) }));
      },
    }),
    [settings.muted, settings.volume, level, audioStarted, audioEnabled, startAudio],
  );

  const cockpitSettings = useMemo<CockpitSettingsValue>(
    () => ({
      quality: settings.quality,
      setQuality,
      invertPitch: settings.invertPitch,
      setInvertPitch,
    }),
    [settings.quality, settings.invertPitch, setQuality, setInvertPitch],
  );

  return (
    <EngineContext.Provider value={engine}>
      <SnapshotContext.Provider value={snapshot}>
        <ActionsContext.Provider value={actions}>
          <SettingsContext.Provider value={cockpitSettings}>
            <AudioContext.Provider value={audio}>{children}</AudioContext.Provider>
          </SettingsContext.Provider>
        </ActionsContext.Provider>
      </SnapshotContext.Provider>
    </EngineContext.Provider>
  );
}

export function useCockpit(): CockpitSnapshot {
  const value = useContext(SnapshotContext);
  if (!value) throw new Error('useCockpit must be used inside <CockpitProvider>');
  return value;
}

export function useCockpitSelector<T>(selector: (snapshot: CockpitSnapshot) => T): T {
  const snapshot = useCockpit();
  return selector(snapshot);
}

export function useCockpitEngine(): CockpitEngine {
  const value = useContext(EngineContext);
  if (!value) throw new Error('useCockpitEngine must be used inside <CockpitProvider>');
  return value;
}

export function useCockpitActions(): CockpitActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useCockpitActions must be used inside <CockpitProvider>');
  return value;
}

export function useCockpitSettings(): CockpitSettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useCockpitSettings must be used inside <CockpitProvider>');
  return value;
}

export function useAudio(): CockpitAudio {
  const value = useContext(AudioContext);
  if (!value) throw new Error('useAudio must be used inside <CockpitProvider>');
  return value;
}
