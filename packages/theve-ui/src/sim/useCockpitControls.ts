import { useEffect, useRef } from 'react';
import { useCockpitActions, useCockpitEngine } from './CockpitProvider';
import { MANEUVERS } from './maneuvers';
import type { ManeuverId } from './types';

export interface CockpitControlOptions {
  enabled?: boolean;
  invertPitch?: boolean;
  onPause?: () => void;
  onHelp?: () => void;
  onMute?: () => void;
  onRestart?: () => void;
  /** v0.4: fired after `G` hands the sortie to the performer (or takes it back). */
  onAutoPilot?: (engaged: boolean) => void;
}

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/** Held manoeuvres: engage while the key is down, release when it comes up. */
const SUSTAINED_BY_KEY: Record<string, ManeuverId> = {
  KeyC: 'highG',
  KeyX: 'airbrake',
};

/** Timed manoeuvres: one press ignites the full profile. */
const SCRIPTED_BY_KEY: Record<string, ManeuverId> = Object.fromEntries(
  (['cobra', 'barrelRoll', 'splitS', 'immelmann', 'kulbit'] as ManeuverId[]).map((id) => [
    MANEUVERS[id].key,
    id,
  ]),
) as Record<string, ManeuverId>;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, select, textarea, [role="dialog"], [data-tv-ui="true"]',
    ),
  );
}

/**
 * Keyboard, pointer-drag and wheel bindings for the cockpit. Movement is
 * immediate; discrete actions respect focus so tab navigation still works.
 */
export function useCockpitControls(options: CockpitControlOptions = {}): void {
  const { enabled = true, invertPitch = false } = options;
  const actions = useCockpitActions();
  const engine = useCockpitEngine();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) return;
    const held = new Set<string>();
    let dragging = false;
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let activeSustained: ManeuverId | null = null;

    const resetAxes = () => {
      actions.setInput({ pitch: 0, roll: 0, yaw: 0 });
      actions.setThrottleAxis(0);
    };

    const releaseSustained = () => {
      if (activeSustained) {
        actions.endManeuver(activeSustained);
        activeSustained = null;
      }
    };

    const applyAxes = () => {
      const pitchUp = held.has('KeyS') || held.has('ArrowDown') ? 1 : 0;
      const pitchDown = held.has('KeyW') || held.has('ArrowUp') ? 1 : 0;
      const pitch = (pitchUp - pitchDown) * (invertPitch ? -1 : 1);
      const roll =
        (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0) -
        (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0);
      const yaw = (held.has('KeyQ') ? 1 : 0) - (held.has('KeyE') ? 1 : 0);
      actions.setInput({ pitch, roll, yaw });
      const throttle =
        (held.has('ShiftLeft') || held.has('ShiftRight') ? 1 : 0) -
        (held.has('ControlLeft') || held.has('ControlRight') ? 1 : 0);
      actions.setThrottleAxis(throttle);
    };

    const releaseAll = () => {
      held.clear();
      dragging = false;
      pointerId = null;
      releaseSustained();
      resetAxes();
      actions.stopGun();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') return;
      if (event.metaKey || event.altKey) return;
      const interactive = isInteractiveTarget(event.target);
      const code = event.code;

      if (MOVEMENT_KEYS.has(code) || code === 'Space' || code === 'Tab') {
        if (interactive) return;
        event.preventDefault();
      }
      if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'ControlLeft' || code === 'ControlRight') {
        held.add(code);
        applyAxes();
        return;
      }
      if (MOVEMENT_KEYS.has(code)) {
        held.add(code);
        applyAxes();
        return;
      }
      if (interactive) return;

      const sustained = SUSTAINED_BY_KEY[code];
      if (sustained) {
        event.preventDefault();
        if (activeSustained !== sustained) {
          releaseSustained();
          actions.startManeuver(sustained);
          activeSustained = sustained;
        }
        return;
      }

      if (event.repeat) return;

      const scripted = SCRIPTED_BY_KEY[code];
      if (scripted) {
        event.preventDefault();
        actions.startManeuver(scripted);
        return;
      }

      switch (code) {
        case 'Tab':
        case 'KeyT':
          event.preventDefault();
          actions.cycleTarget();
          break;
        case 'Space':
          event.preventDefault();
          actions.fire();
          break;
        case 'KeyJ':
          actions.startGun();
          break;
        case 'KeyF':
          actions.flare();
          break;
        case 'KeyY':
          actions.toggleAssists();
          break;
        case 'KeyG':
          // The one-key clear. It launches from the briefing, waits out the
          // self-test on its own, and keeps flying after a shoot-down.
          event.preventDefault();
          releaseAll();
          optionsRef.current.onAutoPilot?.(actions.toggleAutoPilot());
          break;
        case 'Digit1':
          actions.selectWeapon('aam');
          break;
        case 'Digit2':
          actions.selectWeapon('gun');
          break;
        case 'KeyM':
          optionsRef.current.onMute?.();
          break;
        case 'KeyP':
        case 'Escape':
          optionsRef.current.onPause?.();
          break;
        case 'KeyH':
          optionsRef.current.onHelp?.();
          break;
        case 'KeyR':
          optionsRef.current.onRestart?.();
          break;
        default:
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const code = event.code;
      if (code === 'KeyJ') actions.stopGun();
      if (activeSustained && MANEUVERS[activeSustained].key === code) releaseSustained();
      if (held.delete(code)) applyAxes();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;
      if (engine.paused) return;
      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const scale = Math.min(window.innerWidth, window.innerHeight) * 0.24;
      const roll = Math.min(Math.max((event.clientX - startX) / scale, -1), 1);
      const pitch = Math.min(Math.max((event.clientY - startY) / scale, -1), 1);
      actions.setInput({ roll, pitch: invertPitch ? -pitch : pitch });
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      resetAxes();
    };

    const onWheel = (event: WheelEvent) => {
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      actions.adjustThrottle(event.deltaY > 0 ? -0.035 : 0.035);
    };

    const onBlur = () => releaseAll();
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      releaseAll();
    };
  }, [actions, enabled, engine, invertPitch]);
}
