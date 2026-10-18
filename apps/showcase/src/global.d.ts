import type { CockpitEngine, CockpitSnapshot } from '@theve/ui';
import type { CockpitScene } from '@theve/ui/three';

export interface TheveDebugApi {
  launch: () => void;
  skipBoot: () => void;
  triggerBoss: () => void;
  snapshot: () => CockpitSnapshot;
  setOverlay: (overlay: 'none' | 'pause' | 'help') => void;
  phase: () => string;
  engine: CockpitEngine;
  /** v0.4: engage AUTO ACE from a script, no user gesture required. */
  autoAce: (enabled?: boolean) => void;
  /** v0.4: advance the simulation headlessly and return the new snapshot. */
  step: (seconds: number) => CockpitSnapshot;
}

declare global {
  interface Window {
    __THEVE__?: TheveDebugApi;
    __THEVE_SCENE__?: CockpitScene;
  }
}

export {};
