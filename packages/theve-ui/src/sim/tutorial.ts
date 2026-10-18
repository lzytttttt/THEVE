import type { TutorialState, TutorialStep, TutorialStepId } from './types';

export interface TutorialDefinition {
  id: TutorialStepId;
  keys: string[];
  labelZh: string;
  labelEn: string;
}

/**
 * Shown the moment the mission starts. Every entry is ticked off by actually
 * flying — it is a checklist, not a manual, so it never blocks the controls.
 */
export const TUTORIAL_STEPS: TutorialDefinition[] = [
  { id: 'attitude', keys: ['W', 'S', 'A', 'D'], labelZh: '俯仰 / 滚转', labelEn: 'PITCH & ROLL' },
  { id: 'throttle', keys: ['SHIFT', 'CTRL'], labelZh: '加油门', labelEn: 'THROTTLE' },
  { id: 'target', keys: ['TAB'], labelZh: '切换目标', labelEn: 'CYCLE TARGET' },
  { id: 'lock', keys: ['—'], labelZh: '把敌机压进锁定锥', labelEn: 'HOLD THE LOCK CONE' },
  { id: 'fire', keys: ['SPACE'], labelZh: '发射导弹', labelEn: 'FOX TWO' },
  { id: 'maneuver', keys: ['C', 'X', 'Z'], labelZh: '使用机动', labelEn: 'MANOEUVRE' },
  { id: 'defend', keys: ['F'], labelZh: '释放热焰弹', labelEn: 'DEPLOY FLARE' },
];

export type TutorialFlags = Record<TutorialStepId, boolean>;

export function createTutorialFlags(): TutorialFlags {
  return {
    attitude: false,
    throttle: false,
    target: false,
    lock: false,
    fire: false,
    maneuver: false,
    defend: false,
  };
}

export function buildTutorialState(
  flags: TutorialFlags,
  dismissed: boolean,
  visible: boolean,
): TutorialState {
  const steps: TutorialStep[] = TUTORIAL_STEPS.map((definition) => ({
    id: definition.id,
    keys: definition.keys,
    labelZh: definition.labelZh,
    labelEn: definition.labelEn,
    done: flags[definition.id] === true,
  }));
  const completed = steps.filter((step) => step.done).length;
  return {
    visible: visible && !dismissed,
    dismissed,
    completed,
    total: steps.length,
    steps,
  };
}
