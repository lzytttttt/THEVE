import type { Scenario, ScenarioWave } from './types';

/**
 * Operation SUNSET SPEAR — an original scenario. All squadrons, callsigns and
 * machines are fictional. Inspired by the cinematic air-combat language of
 * ACE COMBAT 8: WINGS OF THEVE, without reproducing any of its assets.
 *
 * v0.4 turns the single three-ship formation into a staged engagement: a light
 * vanguard, then the squadron's weight, then the commander and his escort. Each
 * wave is released on a kill count *or* a clock, so the fight escalates whether
 * the player is winning fast or struggling.
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
    { callsign: 'VESPER 1', enemy: 'interceptor', distance: 1600, side: -260, vertical: 110 },
    { callsign: 'VESPER 2', enemy: 'scout', distance: 2000, side: 320, vertical: -60 },
  ],
  reinforcements: [
    {
      id: 'vesper-main',
      code: 'WAVE 2',
      labelEn: 'VESPER MAIN FORCE',
      labelZh: '维斯珀 主队',
      atKills: 2,
      atTime: 26,
      concurrent: 4,
      units: [
        { callsign: 'VESPER 3', enemy: 'interceptor', distance: 2600, side: -640, vertical: 180 },
        { callsign: 'VESPER 4', enemy: 'heavy', distance: 3000, side: 520, vertical: -220 },
        { callsign: 'VESPER ACE', enemy: 'ace', distance: 2700, side: 760, vertical: 260 },
      ],
    },
    {
      id: 'vesper-command',
      code: 'WAVE 3',
      labelEn: 'VESPER COMMAND FLIGHT',
      labelZh: '维斯珀 指挥编队',
      atKills: 4,
      atTime: 54,
      concurrent: 5,
      units: [
        { callsign: 'VESPER LEAD', enemy: 'commander', distance: 3300, side: -180, vertical: 340 },
        { callsign: 'VESPER 5', enemy: 'jammer', distance: 2500, side: -720, vertical: -260 },
        { callsign: 'VESPER 6', enemy: 'interceptor', distance: 2900, side: 620, vertical: -140 },
      ],
    },
  ],
  // The dreadnought is the second act, not an interruption. v0.3 triggered it
  // after two kills out of three, so the fight was always clean; v0.4 has eight
  // bandits in three waves, and triggering on six left the commander's flight
  // and a jammer in the air when the main battery opened up. Clearing the
  // squadron first is both the better story and the fairer fight.
  requiredKills: 8,
  // Generous fallback so a passive sortie still reaches the second act.
  bossTriggerAt: 240,
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

/** Deep copies so a demo scenario never shares wave arrays with the original. */
function cloneWaves(waves: readonly ScenarioWave[]): ScenarioWave[] {
  return waves.map((wave) => ({ ...wave, units: wave.units.map((unit) => ({ ...unit })) }));
}

export function createDemoScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    ...sunsetSpearScenario,
    ...overrides,
    start: { ...sunsetSpearScenario.start, ...overrides.start },
    boss: { ...sunsetSpearScenario.boss, ...overrides.boss },
    enemies: overrides.enemies ?? sunsetSpearScenario.enemies.map((enemy) => ({ ...enemy })),
    // A caller that replaces the opening formation is describing its own stage;
    // keeping the campaign's reinforcements would ambush it. Opt back in by
    // passing `reinforcements` explicitly.
    reinforcements:
      overrides.reinforcements ??
      (overrides.enemies
        ? []
        : cloneWaves(sunsetSpearScenario.reinforcements ?? [])),
  };
}
