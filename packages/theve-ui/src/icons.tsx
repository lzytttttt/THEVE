import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number | string;
  strokeWidth?: number;
}

function createIcon(name: string, paths: ReactNode) {
  function Icon({ size = 16, strokeWidth = 1.5, ...rest }: IconProps) {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
        className="tv-icon"
        {...rest}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const IconCrosshair = createIcon(
  'IconCrosshair',
  <>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </>,
);

export const IconLock = createIcon(
  'IconLock',
  <>
    <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
);

export const IconRadar = createIcon(
  'IconRadar',
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 12 18 6M12 3.5V5" />
    <circle cx="15.5" cy="15" r="1" fill="currentColor" stroke="none" />
  </>,
);

export const IconMissile = createIcon(
  'IconMissile',
  <>
    <path d="M13 4c2.5 1.5 4 4 4 7l-3.5 2H8l-1.5 3H4l1-5V8l4-1c1-1.5 2.5-2.5 4-3Z" />
    <path d="M13 4v9M8 13l-2 5M4 20l2.5-2.5" />
  </>,
);

export const IconShield = createIcon(
  'IconShield',
  <>
    <path d="M12 3 20 6v5c0 4.8-3.4 8-8 10-4.6-2-8-5.2-8-10V6l8-3Z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>,
);

export const IconWarning = createIcon(
  'IconWarning',
  <>
    <path d="M12 3 22 20H2L12 3Z" />
    <path d="M12 9v5M12 17v.5" />
  </>,
);

export const IconPlane = createIcon(
  'IconPlane',
  <>
    <path d="m12 2 2.2 7 7.8 4v2l-7.8-1.4L13 20l2 2h-6l2-2-1.2-6.4L2 15v-2l7.8-4L12 2Z" />
  </>,
);

export const IconFlame = createIcon(
  'IconFlame',
  <>
    <path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 .5C17 9 15 6 15 6s2 1 3 3c1 3.2-1.5 6.5-6 6.5S6 12 6 9c0-3 3-4 6-7Z" />
    <path d="M12 12c.8 1.5 2 2 2 3.5a2 2 0 1 1-4 0c0-1.5 1.2-2 2-3.5Z" />
  </>,
);

export const IconTarget = createIcon(
  'IconTarget',
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </>,
);

export const IconSoundOn = createIcon(
  'IconSoundOn',
  <>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16 8c1.8 1.5 1.8 6.5 0 8M19 5c3.2 3 3.2 11 0 14" />
  </>,
);

export const IconSoundOff = createIcon(
  'IconSoundOff',
  <>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </>,
);

export const IconGear = createIcon(
  'IconGear',
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
  </>,
);

export const IconExpand = createIcon(
  'IconExpand',
  <>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </>,
);

export const IconPause = createIcon(
  'IconPause',
  <>
    <path d="M8 5v14M16 5v14" />
  </>,
);

export const IconPlay = createIcon('IconPlay', <path d="m7 4 13 8-13 8V4Z" />);

export const IconArrowRight = createIcon(
  'IconArrowRight',
  <>
    <path d="M4 12h16M14 6l6 6-6 6" />
  </>,
);

export const IconChevronRight = createIcon('IconChevronRight', <path d="m9 5 7 7-7 7" />);

export const IconScan = createIcon(
  'IconScan',
  <>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    <path d="M4 12h16" />
  </>,
);

export const IconBolt = createIcon('IconBolt', <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />);

export const IconCheck = createIcon('IconCheck', <path d="m4 12 5 5L20 6" />);

export const IconClose = createIcon('IconClose', <path d="M5 5l14 14M19 5 5 19" />);

export const IconChevronLeft = createIcon('IconChevronLeft', <path d="m15 5-7 7 7 7" />);

export const IconHelp = createIcon(
  'IconHelp',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.2a2.5 2.5 0 1 1 3.8 2.2c-.9.5-1.4 1.1-1.4 2.3" />
    <path d="M12 17v.6" />
  </>,
);

/** v0.4 AUTO ACE — a winged chevron inside a guidance circle. */
export const IconAuto = createIcon(
  'IconAuto',
  <>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 2.4" />
    <path d="M12 5.4 14 11l4.6 3v1.3L14 14.2 13 18l1.4 1.4h-4.8L11 18l-1-3.8-4.6 1.1V14l4.6-3L12 5.4Z" />
  </>,
);

/** v0.4 wave director — a stacked inbound formation. */
export const IconWave = createIcon(
  'IconWave',
  <>
    <path d="M2 15.5c2.6 0 3.4-3 6-3s3.4 3 6 3 3.4-3 6-3" />
    <path d="M2 19.5c2.6 0 3.4-3 6-3s3.4 3 6 3 3.4-3 6-3" />
    <path d="M12 3 15 9h-6l3-6Z" />
  </>,
);

/**
 * v0.5 camera. `cockpit` draws the HUD frame; `chase` draws the same aircraft
 * from behind. Two silhouettes rather than a generic "camera" glyph, because
 * the deck button has to say which way you are about to be looking.
 */
export function IconView({ size = 16, mode = 'cockpit', ...rest }: IconProps & { mode?: 'cockpit' | 'chase' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className="tv-icon"
      {...rest}
    >
      {mode === 'cockpit' ? (
        <>
          <path d="M3 18V9l9-5 9 5v9" />
          <path d="M3 18h18" />
          <path d="M9 18v-6h6v6" />
          <path d="M12 2v2" />
        </>
      ) : (
        <>
          <path d="m12 6 2 5 8 3.6v1.6L14 15l-1 4.4 1.8 1.6h-5.6L11 19.4 10 15l-8-.8v-1.6L10 9l2-3Z" />
          <path d="M4.5 5.5a9 9 0 0 1 15 0" strokeDasharray="2.4 2.2" />
        </>
      )}
    </svg>
  );
}
