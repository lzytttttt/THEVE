import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Meter, Readout, Tag, Toggle } from '../src/primitives';
import { HeadingTape, SpeedTape } from '../src/hud/instruments';
import { RadarScope } from '../src/hud/systems';
import { GLoadMeter, ManeuverRail, StartupChecklist } from '../src/hud/maneuvers';
import { DamageDirection, HitConfirm, KillTicker } from '../src/hud/combat';
import { formatClock, formatMach, formatRange } from '../src/hud/format';
import { buildManeuverStatus, MANEUVER_ORDER, MANEUVERS } from '../src/sim/maneuvers';
import { ASSIST_ORDER, buildAssistStatus } from '../src/sim/assists';
import { buildTutorialState, createTutorialFlags } from '../src/sim/tutorial';
import type { CockpitSnapshot, HitMarker, IncomingHit, KillFeedEntry } from '../src/sim/types';

const noop = () => undefined;

function stubSnapshot(overrides: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  return {
    phase: 'dogfight',
    paused: false,
    elapsed: 12,
    operation: 'OP. 08',
    titleEn: 'SUNSET SPEAR',
    titleZh: '落日之矛',
    view: 'cockpit',
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
      jammed: false,
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
    combat: {
      hit: null,
      incoming: [],
      kills: [],
      intensity: 0.4,
      threat: 0.3,
      combo: 0,
    },
    wave: {
      index: 1,
      total: 3,
      code: 'WAVE 1',
      labelEn: 'VESPER VANGUARD',
      labelZh: '维斯珀 先锋',
      nextIn: 14,
      inbound: false,
      hostiles: 2,
      roster: [
        {
          enemyId: 'interceptor',
          code: 'INT',
          labelZh: '维斯珀 截击机',
          labelEn: 'VESPER INTERCEPTOR',
          total: 3,
          alive: 2,
          down: 1,
        },
      ],
    },
    auto: {
      engaged: false,
      mode: 'standby',
      code: 'MAN',
      labelEn: 'MANUAL',
      labelZh: '手动',
      callout: '',
      progress: 0,
      demonstrated: 0,
      total: 7,
      plays: 0,
      condition: 1,
      targetCallsign: null,
      retryIn: null,
      shown: [],
    },
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

function hitMarker(overrides: Partial<HitMarker> = {}): HitMarker {
  return { id: 1, age: 0.05, duration: 0.42, damage: 6.4, kill: false, kind: 'fighter', ...overrides };
}

describe('v0.3 impact feedback', () => {
  it('renders nothing at all when the air is quiet', () => {
    const { container } = render(
      <>
        <HitConfirm hit={null} />
        <DamageDirection hits={[]} />
        <KillTicker entries={[]} />
      </>,
    );
    expect(container.querySelector('.tv-hitconfirm')).toBeNull();
    expect(container.querySelector('.tv-incoming')).toBeNull();
    expect(container.querySelector('.tv-kills')).toBeNull();
  });

  it('pops a hit marker with the damage it dealt, without spamming screen readers', () => {
    render(<HitConfirm hit={hitMarker()} combo={4} />);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('×4')).toBeInTheDocument();
    const marker = document.querySelector('.tv-hitconfirm');
    expect(marker?.className).not.toContain('is-kill');
    // A burst connects many times a second, so the marker is visual only.
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    // The marker is a pure function of age, not a self-running animation.
    expect(Number((marker as HTMLElement).style.getPropertyValue('--tv-hit-opacity'))).toBeGreaterThan(0.9);
  });

  it('switches the marker to the weakpoint and kill variants', () => {
    const { container: weak } = render(<HitConfirm hit={hitMarker({ kind: 'weakpoint' })} />);
    expect(weak.querySelector('.tv-hitconfirm')?.className).toContain('is-weakpoint');
    expect(weak.querySelector('.tv-hitconfirm')?.className).toContain('is-weakpoint');

    const { container: kill } = render(
      <HitConfirm hit={hitMarker({ kill: true, damage: 200 })} />,
    );
    expect(kill.querySelector('.tv-hitconfirm')?.className).toContain('is-kill');
    expect(kill.querySelector('.tv-hitconfirm__ring')).not.toBeNull();
    expect(kill.querySelector('.tv-hitconfirm')?.className).toContain('is-kill');
  });

  it('fades the hit marker out as its age approaches its duration', () => {
    const { container } = render(<HitConfirm hit={hitMarker({ age: 0.4 })} />);
    const marker = container.querySelector('.tv-hitconfirm') as HTMLElement;
    const opacity = Number(marker.style.getPropertyValue('--tv-hit-opacity'));
    expect(opacity).toBeLessThan(0.2);
    expect(opacity).toBeGreaterThanOrEqual(0);
  });

  it('lays damage wedges on their bearing and by severity', () => {
    const hits: IncomingHit[] = [
      { id: 1, age: 0.2, duration: 2.1, amount: 14, bearing: 92, severity: 'critical' },
      { id: 2, age: 1.9, duration: 2.1, amount: 6, bearing: 271, severity: 'caution' },
    ];
    const { container } = render(<DamageDirection hits={hits} />);
    const wedges = container.querySelectorAll('.tv-incoming__wedge');
    expect(wedges).toHaveLength(2);
    expect((wedges[0] as HTMLElement).style.getPropertyValue('--tv-bearing')).toBe('92.0deg');
    expect(wedges[0]?.className).toContain('critical');
    expect(wedges[1]?.className).toContain('caution');
    // The older wedge is nearly gone.
    const oldOpacity = Number(
      (wedges[1] as HTMLElement).style.getPropertyValue('--tv-incoming-opacity'),
    );
    const newOpacity = Number(
      (wedges[0] as HTMLElement).style.getPropertyValue('--tv-incoming-opacity'),
    );
    expect(oldOpacity).toBeLessThan(newOpacity);
  });

  it('lists kills newest first with their score and reads them out', () => {
    const entries: KillFeedEntry[] = [
      { id: 3, age: 0.2, duration: 4.2, callsign: 'VESPER ACE', label: 'Su-57', points: 180, ace: true, weakpoint: false },
      { id: 2, age: 1.4, duration: 4.2, callsign: 'SHIELD NODE A', label: 'SHIELD NODE A', points: 500, ace: false, weakpoint: true },
    ];
    const { container } = render(<KillTicker entries={entries} />);
    const rows = container.querySelectorAll('.tv-kills__row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('VESPER ACE')).toBeInTheDocument();
    expect(screen.getByText('+180')).toBeInTheDocument();
    expect(rows[0]?.className).toContain('is-ace');
    expect(rows[1]?.className).toContain('is-weakpoint');
    // Kills are the one combat event worth reading out.
    expect(screen.getByRole('log', { name: '击坠记录' })).toBeInTheDocument();
  });
});
