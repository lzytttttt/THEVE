import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Meter, Readout, Tag, Toggle } from '../src/primitives';
import { HeadingTape, SpeedTape } from '../src/hud/instruments';
import { RadarScope } from '../src/hud/systems';
import { GLoadMeter, ManeuverRail, StartupChecklist } from '../src/hud/maneuvers';
import { formatClock, formatMach, formatRange } from '../src/hud/format';
import { buildManeuverStatus, MANEUVER_ORDER, MANEUVERS } from '../src/sim/maneuvers';
import { ASSIST_ORDER, buildAssistStatus } from '../src/sim/assists';
import { buildTutorialState, createTutorialFlags } from '../src/sim/tutorial';
import type { CockpitSnapshot } from '../src/sim/types';

const noop = () => undefined;

function stubSnapshot(overrides: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  return {
    phase: 'dogfight',
    paused: false,
    elapsed: 12,
    operation: 'OP. 08',
    titleEn: 'SUNSET SPEAR',
    titleZh: '落日之矛',
    flight: {
      speed: 250,
      knots: 486,
      mach: 0.74,
      altitude: 6800,
      verticalSpeed: 0,
      heading: 352,
      pitch: 4,
      pitchRaw: 4,
      roll: -12,
      rollRate: 0,
      gLoad: 3.2,
      throttle: 0.8,
      hp: 100,
      maxHp: 100,
      afterburner: false,
      airbrake: false,
      highG: false,
      postStall: false,
      inverted: false,
      stall: false,
    },
    weapons: {
      selected: 'aam',
      missiles: 8,
      maxMissiles: 8,
      gunAmmo: 900,
      gunMax: 900,
      flares: 6,
      maxFlares: 6,
      gunFiring: false,
    },
    lock: {
      targetId: null,
      callsign: null,
      progress: 0,
      state: 'none',
      distance: 0,
      inCone: false,
      steering: 0,
      elevation: 0,
      assisted: false,
    },
    targets: [],
    radar: [],
    warnings: [],
    comms: [],
    wingman: null,
    boss: null,
    maneuver: {
      active: null,
      activeLabelEn: null,
      activeLabelZh: null,
      activeCode: null,
      progress: 0,
      list: buildManeuverStatus({
        speed: 250,
        altitude: 6800,
        activeManeuver: null,
        progress: 0,
      }),
    },
    assist: {
      master: true,
      anyEnabled: true,
      engaged: [],
      list: buildAssistStatus(
        { attitude: true, steering: true, throttle: true, terrain: true },
        true,
        [],
        { attitude: 0, steering: 0, throttle: 0, terrain: 0 },
      ),
    },
    tutorial: buildTutorialState(createTutorialFlags(), false, true),
    mission: {
      kills: 0,
      requiredKills: 2,
      objective: 'INTERCEPT',
      objectiveZh: '迎击',
      hint: 'TAB 切换目标',
      score: 0,
      stats: {
        kills: 0,
        shotsFired: 0,
        shotsHit: 0,
        missilesFired: 0,
        missilesHit: 0,
        damageTaken: 0,
        elapsed: 12,
        score: 0,
        rank: null,
      },
    },
    ...overrides,
  };
}

vi.mock('../src/sim/CockpitProvider', () => ({
  useCockpit: () => stubSnapshot(),
  useCockpitActions: () => ({
    startManeuver: noop,
    endManeuver: noop,
    setAssist: noop,
    toggleAssists: noop,
    dismissTutorial: noop,
    cycleTarget: noop,
    flare: noop,
    fire: noop,
    selectWeapon: noop,
    adjustThrottle: noop,
    setThrottle: noop,
    startGun: noop,
    stopGun: noop,
  }),
  useAudio: () => ({ muted: false, toggleMute: noop }),
}));

describe('HUD primitives', () => {
  it('exposes meters to assistive technology', () => {
    render(<Meter label="HULL" value={72} max={100} showValue valueSuffix="%" />);
    const meter = screen.getByRole('meter', { name: 'HULL' });
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '72 %');
  });

  it('renders tags and readouts as readable text', () => {
    render(
      <>
        <Tag tone="hostile">VESPER</Tag>
        <Readout label="IAS" value="472" unit="KT" />
        <Button kbd="ENTER">LAUNCH</Button>
        <Toggle checked label="INVERT" onCheckedChange={() => undefined} />
      </>,
    );
    expect(screen.getByText('VESPER')).toBeInTheDocument();
    expect(screen.getByText('472')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /LAUNCH/ })).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('HUD instruments', () => {
  it('renders a heading tape and a speed tape with screen-reader labels', () => {
    render(
      <>
        <HeadingTape heading={352} />
        <SpeedTape knots={472} mach={0.86} afterburner />
      </>,
    );
    expect(screen.getByText('当前航向 352 度')).toBeInTheDocument();
    expect(screen.getByText('IAS 472 KT')).toBeInTheDocument();
    expect(screen.getByText('MACH 0.86')).toBeInTheDocument();
  });

  it('summarises radar tracks for assistive technology', () => {
    render(
      <RadarScope
        heading={90}
        contacts={[
          { id: 'v1', x: 0.1, y: -0.2, team: 'hostile', kind: 'fighter', selected: true },
          { id: 'w1', x: 0.2, y: 0.1, team: 'ally', kind: 'wingman', selected: false },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: /1 个敌方接触/ })).toBeInTheDocument();
    expect(screen.getByText('2 TRACKS')).toBeInTheDocument();
  });
});

describe('format helpers', () => {
  it('formats mission data consistently', () => {
    expect(formatRange(1240)).toBe('1.2 KM');
    expect(formatRange(860)).toBe('860 M');
    expect(formatMach(0.856)).toBe('0.86');
    expect(formatClock(83)).toBe('01:23');
  });
});

describe('v0.2 handling instruments', () => {
  it('lists all seven manoeuvres with their keycaps and reachable buttons', () => {
    const { container } = render(<ManeuverRail />);
    expect(MANEUVER_ORDER).toHaveLength(7);
    expect(container.querySelectorAll('.tv-maneuver')).toHaveLength(7);
    expect(screen.getByRole('button', { name: '高G转弯 HIGH-G TURN（C）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '库尔比特 KULBIT（K）' })).toBeInTheDocument();
    for (const id of MANEUVER_ORDER) {
      const definition = MANEUVERS[id];
      expect(screen.getByText(definition.code)).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: `${definition.labelZh} ${definition.labelEn}（${definition.keyLabel}）`,
        }),
      ).toBeInTheDocument();
    }
  });

  it('renders the first-flight checklist with progress and every shortcut', () => {
    render(<StartupChecklist />);
    expect(screen.getByText(/FIRST FLIGHT CHECK/)).toBeInTheDocument();
    expect(screen.getByText('0/7')).toBeInTheDocument();
    expect(screen.getByText('俯仰 / 滚转')).toBeInTheDocument();
    expect(screen.getByText('使用机动')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭操作说明' })).toBeInTheDocument();
  });

  it('shows the completed checklist differently from the fresh one', () => {
    const flags = createTutorialFlags();
    for (const key of Object.keys(flags) as Array<keyof typeof flags>) flags[key] = true;
    render(<StartupChecklist tutorial={buildTutorialState(flags, false, true)} />);
    expect(screen.getByText('7/7')).toBeInTheDocument();
    expect(screen.getByText(/检查单完成/)).toBeInTheDocument();
  });

  it('hides the checklist once it has been dismissed', () => {
    const { container } = render(
      <StartupChecklist tutorial={buildTutorialState(createTutorialFlags(), true, true)} />,
    );
    expect(container.querySelector('.tv-tutorial')).toBeNull();
  });

  it('exposes the G meter and the post-stall flag', () => {
    render(<GLoadMeter />);
    expect(screen.getByText('3.2')).toBeInTheDocument();
  });

  it('describes every flight aid with a stable order', () => {
    const list = buildAssistStatus(
      { attitude: true, steering: false, throttle: true, terrain: true },
      true,
      ['steering'],
      { attitude: 0.4, steering: 0, throttle: 0.2, terrain: 0 },
    );
    expect(list.map((item) => item.id)).toEqual(ASSIST_ORDER);
    expect(list.find((item) => item.id === 'steering')?.enabled).toBe(false);
    expect(list.find((item) => item.id === 'attitude')?.enabled).toBe(true);
  });
});
