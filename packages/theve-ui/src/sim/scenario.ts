import type { Scenario } from './types';

/**
 * Operation SUNSET SPEAR — an original scenario. All squadrons, callsigns and
 * machines are fictional. Inspired by the cinematic air-combat language of
 * ACE COMBAT 8: WINGS OF THEVE, without reproducing any of its assets.
 */
export const sunsetSpearScenario: Scenario = {
  id: 'sunset-spear',
  operation: 'OP. 08 — SUNSET SPEAR',
  titleEn: 'SUNSET SPEAR',
  titleZh: '落日之矛',
  callsign: 'LUMEN 1',
  wingmanCallsign: 'LUMEN 2',
  awacsCallsign: 'SENTINEL',
  start: { speed: 255, altitude: 6800, heading: 352 },
  enemies: [
    { callsign: 'VESPER 1', distance: 1600, side: -260, vertical: 110 },
    { callsign: 'VESPER 2', distance: 2000, side: 320, vertical: -60 },
    { callsign: 'VESPER ACE', variant: 'ace', distance: 2600, side: 700, vertical: 240 },
  ],
  requiredKills: 2,
  bossTriggerAt: 80,
  boss: {
    id: 'leviathan',
    callsign: 'LEVIATHAN',
    nameEn: 'AERIAL DREADNOUGHT LEVIATHAN',
    nameZh: '空中无畏舰 · 利维坦',
    spawnDistance: 2800,
    spawnSide: 600,
    spawnAlt: 7400,
  },
};

export function createDemoScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    ...sunsetSpearScenario,
    ...overrides,
    start: { ...sunsetSpearScenario.start, ...overrides.start },
    boss: { ...sunsetSpearScenario.boss, ...overrides.boss },
    enemies: overrides.enemies ?? sunsetSpearScenario.enemies.map((enemy) => ({ ...enemy })),
  };
}
