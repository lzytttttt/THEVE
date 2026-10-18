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
}

declare global {
  interface Window {
    __THEVE__?: TheveDebugApi;
    __THEVE_SCENE__?: CockpitScene;
  }
}

export {};
