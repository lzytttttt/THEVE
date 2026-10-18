import { useCallback, useEffect, useState } from 'react';
import {
  CockpitProvider,
  useAudio,
  useCockpit,
  useCockpitActions,
  useCockpitEngine,
  useCockpitSettings,
  useCockpitControls,
  formatClock,
} from '@theve/ui';
import { CockpitViewport } from '@theve/ui/three';
import { CockpitHud, CockpitControls, IconButton } from '@theve/ui';
import { IconExpand, IconHelp, IconPause, IconSoundOff, IconSoundOn, cx } from '@theve/ui';
import { Brand, BrandRule } from '../brand';
import { useFps } from '../useFps';
import type { Route } from '../App';
import {
  BootOverlay,
  BossIntroOverlay,
  BriefingOverlay,
  DebriefOverlay,
  HelpOverlay,
  PauseOverlay,
} from '../components/Overlays';

type Overlay = 'none' | 'pause' | 'help';
type Rank = 'S' | 'A' | 'B' | 'C';

const RANK_VALUE: Record<Rank, number> = { S: 4, A: 3, B: 2, C: 1 };
const BEST_KEY = 'theve.best-rank.v1';

function readBest(): Rank | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw === 'S' || raw === 'A' || raw === 'B' || raw === 'C' ? raw : null;
  } catch {
    return null;
  }
}

function writeBest(rank: Rank): void {
  try {
    window.localStorage.setItem(BEST_KEY, rank);
  } catch {
    /* noop */
  }
}

export interface CockpitPageProps {
  onNavigate: (route: Route) => void;
}

export function CockpitPage({ onNavigate }: CockpitPageProps) {
  return (
    <CockpitProvider audio>
      <CockpitExperience onNavigate={onNavigate} />
    </CockpitProvider>
  );
}

function CockpitExperience({ onNavigate }: CockpitPageProps) {
  const snapshot = useCockpit();
  const actions = useCockpitActions();
  const audio = useAudio();
  const settings = useCockpitSettings();
  const engine = useCockpitEngine();
  const fps = useFps();
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [best, setBest] = useState<Rank | null>(readBest);
  const [fullscreen, setFullscreen] = useState(false);
  const [portraitDismissed, setPortraitDismissed] = useState(false);
  const [portrait, setPortrait] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
  });

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px) and (orientation: portrait)');
    const onChange = () => setPortrait(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const portraitBlocked = portrait && !portraitDismissed;

  const activePhase = ['boot', 'dogfight', 'boss-intro', 'boss'].includes(snapshot.phase);

  const openPause = useCallback(() => {
    if (!['boot', 'dogfight', 'boss-intro', 'boss'].includes(engine.phase)) return;
    setOverlay('pause');
    actions.pause();
  }, [actions, engine]);

  const openHelp = useCallback(() => {
    if (!['boot', 'dogfight', 'boss-intro', 'boss'].includes(engine.phase)) return;
    setOverlay('help');
    actions.pause();
  }, [actions, engine]);

  const closeOverlay = useCallback(() => {
    setOverlay('none');
    actions.resume();
  }, [actions]);

  const launch = useCallback(() => {
    setOverlay('none');
    actions.launch();
  }, [actions]);

  const retry = useCallback(() => {
    setOverlay('none');
    actions.restart();
  }, [actions]);

  useCockpitControls({
    enabled: activePhase && overlay === 'none' && !portraitBlocked,
    invertPitch: settings.invertPitch,
    onPause: openPause,
    onHelp: openHelp,
    onMute: audio.toggleMute,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (snapshot.phase !== 'idle' || event.code !== 'Enter') return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, a, input')) return;
      event.preventDefault();
      launch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snapshot.phase, launch]);

  useEffect(() => {
    if (snapshot.phase !== 'complete' && snapshot.phase !== 'failed') return;
    if (overlay !== 'none') {
      setOverlay('none');
    }
  }, [snapshot.phase, overlay]);

  useEffect(() => {
    if (snapshot.phase !== 'complete' || !snapshot.mission.stats.rank) return;
    const rank = snapshot.mission.stats.rank;
    if (!best || RANK_VALUE[rank] > RANK_VALUE[best]) {
      setBest(rank);
      writeBest(rank);
    }
    // Only record when the debrief appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.phase, snapshot.mission.stats.rank]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    window.__THEVE__ = {
      launch: () => {
        setOverlay('none');
        actions.launch();
      },
      skipBoot: () => actions.skipBoot(),
      triggerBoss: () => {
        setOverlay('none');
        if (engine.phase === 'idle') actions.launch();
        actions.triggerBoss();
      },
      snapshot: () => engine.getSnapshot(),
      setOverlay: (next) => {
        setOverlay(next);
        if (next === 'none') actions.resume();
        else actions.pause();
      },
      phase: () => engine.phase,
      engine,
    };
    return () => {
      delete window.__THEVE__;
    };
  }, [actions, engine]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  };

  const phaseLabel: Record<string, string> = {
    idle: 'STANDBY',
    boot: 'BOOT',
    dogfight: 'ENGAGED',
    'boss-intro': 'CONTACT',
    boss: 'DEEP STRIKE',
    complete: 'RTB',
    failed: 'SIGNAL LOST',
  };

  const showBriefing = snapshot.phase === 'idle' && overlay === 'none';
  const showBoot = snapshot.phase === 'boot' && overlay === 'none';
  const showBossIntro = snapshot.phase === 'boss-intro' && overlay === 'none';
  const showDebrief =
    (snapshot.phase === 'complete' || snapshot.phase === 'failed') && overlay === 'none';

  return (
    <div className={cx('cockpit-page', `cockpit-page--${snapshot.phase}`)}>
      <div className="cockpit-page__world">
        <CockpitViewport
          quality={settings.quality}
          onReady={(scene) => {
            window.__THEVE_SCENE__ = scene;
          }}
        />
      </div>

      <CockpitHud />
      <CockpitControls />

      <header className="mission-bar">
        <div className="mission-bar__left">
          <Brand compact />
          <BrandRule />
          <span className="mission-bar__op tv-mono">OP. 08 / SUNSET SPEAR</span>
          <span className="mission-bar__callsign tv-mono">LUMEN 1</span>
        </div>
        <div className="mission-bar__center tv-mono">
          <span className="mission-bar__phase" data-phase={snapshot.phase}>
            <i aria-hidden="true" />
            {phaseLabel[snapshot.phase] ?? snapshot.phase}
          </span>
          <span className="mission-bar__clock">SIM {formatClock(snapshot.elapsed)}</span>
          <span className="mission-bar__sep" aria-hidden="true" />
          <span className="mission-bar__coords">36°12′N 142°08′E</span>
        </div>
        <div className="mission-bar__right">
          <span className="mission-bar__link tv-mono">
            <i aria-hidden="true" /> LINK OK
          </span>
          <span className={cx('mission-bar__signal', audio.started && !audio.muted && 'is-live')}>
            <span className="signal-bars" aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => (
                <i
                  key={index}
                  style={{ opacity: audio.muted ? 0.16 : audio.started ? (audio.level * 5 > index ? 1 : 0.15) : 0.22 }}
                />
              ))}
            </span>
            <span className="tv-mono">{audio.muted ? 'MUTED' : audio.started ? 'SIGNAL' : 'AUDIO'}</span>
          </span>
          <span className="mission-bar__fps tv-mono">{fps} FPS</span>
          <IconButton label={audio.muted ? '取消静音' : '静音'} onClick={audio.toggleMute}>
            {audio.muted ? <IconSoundOff size={16} /> : <IconSoundOn size={16} />}
          </IconButton>
          <IconButton label="操作帮助" onClick={openHelp}>
            <IconHelp size={16} />
          </IconButton>
          <IconButton label="暂停" onClick={openPause}>
            <IconPause size={16} />
          </IconButton>
          <IconButton label={fullscreen ? '退出全屏' : '全屏'} onClick={toggleFullscreen}>
            <IconExpand size={16} />
          </IconButton>
        </div>
      </header>

      {showBriefing && (
        <BriefingOverlay
          onLaunch={launch}
          onExit={() => onNavigate('attract')}
          muted={audio.muted}
        />
      )}
      {showBoot && <BootOverlay onSkip={actions.skipBoot} />}
      {showBossIntro && <BossIntroOverlay />}
      {overlay === 'pause' && (
        <PauseOverlay
          audio={audio}
          quality={settings.quality}
          setQuality={settings.setQuality}
          invertPitch={settings.invertPitch}
          setInvertPitch={settings.setInvertPitch}
          onResume={closeOverlay}
          onRestart={retry}
          onExit={() => onNavigate('attract')}
        />
      )}
      {overlay === 'help' && <HelpOverlay onClose={closeOverlay} />}
      {showDebrief && (
        <DebriefOverlay
          snapshot={snapshot}
          best={best}
          onRetry={retry}
          onExit={() => onNavigate('attract')}
        />
      )}

      {!portraitDismissed && (
        <div className="rotate-hint" role="status" data-tv-ui="true">
          <span className="rotate-hint__mark" aria-hidden="true">
            <IconExpand size={22} />
          </span>
          <span className="tv-eyebrow">DISPLAY ORIENTATION</span>
          <strong>请横屏进入座舱</strong>
          <span className="rotate-hint__en tv-mono">ROTATE TO LANDSCAPE</span>
          <p>座舱 HUD 需要横向空间。旋转设备获得完整视野，或继续使用精简界面。</p>
          <button
            type="button"
            className="tv-btn tv-btn--primary"
            onClick={() => setPortraitDismissed(true)}
          >
            继续 / CONTINUE
          </button>
        </div>
      )}
    </div>
  );
}
