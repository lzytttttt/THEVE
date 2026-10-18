import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, Meter, Readout, Tag, Toggle } from '../src/primitives';
import { HeadingTape, SpeedTape } from '../src/hud/instruments';
import { RadarScope } from '../src/hud/systems';
import { formatClock, formatMach, formatRange } from '../src/hud/format';

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
