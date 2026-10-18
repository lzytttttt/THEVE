import { useEffect, useRef, useState } from 'react';
import {
  useCockpitEngine,
  useCockpitSettings,
  type CockpitQuality,
} from '../sim/CockpitProvider';
import { cx } from '../primitives';
import { CockpitScene } from './scene';

export interface CockpitViewportProps {
  className?: string;
  quality?: CockpitQuality;
  onReady?: (scene: CockpitScene) => void;
}

/**
 * Mounts the three.js cockpit. The DOM overlay (HUD) is rendered by the caller;
 * this layer only owns the WebGL canvas, its lifecycle and target projection.
 */
export function CockpitViewport({ className, quality, onReady }: CockpitViewportProps) {
  const engine = useCockpitEngine();
  const settings = useCockpitSettings();
  const resolved = quality ?? settings.quality;
  const hostRef = useRef<HTMLDivElement>(null);
  const [degraded, setDegraded] = useState(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: CockpitScene | null = null;
    try {
      scene = new CockpitScene(host, engine, { quality: resolved });
      onReadyRef.current?.(scene);
    } catch (error) {
      console.warn('[THEVE] WebGL cockpit unavailable, using fallback sky.', error);
      setDegraded(true);
    }
    return () => {
      scene?.dispose();
    };
  }, [engine, resolved]);

  return (
    <div
      className={cx('tv-cockpit', degraded && 'tv-cockpit--degraded', className)}
      data-quality={resolved}
      data-view={settings.view}
    >
      <div className="tv-cockpit__sky" aria-hidden="true" />
      <div ref={hostRef} className="tv-cockpit__stage" aria-hidden="true" />
      <div className="tv-cockpit__glass" aria-hidden="true" />
      {degraded && (
        <p className="tv-cockpit__degraded-note">VISUAL CORE OFFLINE · 2D HUD ACTIVE</p>
      )}
    </div>
  );
}
