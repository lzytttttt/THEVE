import type {
  ButtonHTMLAttributes,
  ElementType,
  HTMLAttributes,
  ReactNode,
} from 'react';

export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* ------------------------------ TheveRoot ------------------------------ */
export interface TheveRootProps extends HTMLAttributes<HTMLDivElement> {
  density?: 'standard' | 'compact';
  motion?: 'system' | 'reduced';
}

export function TheveRoot({
  density = 'standard',
  motion = 'system',
  className,
  children,
  ...rest
}: TheveRootProps) {
  return (
    <div
      className={cx('tv-root', className)}
      data-density={density}
      data-motion={motion === 'reduced' ? 'reduced' : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------- Panel -------------------------------- */
export type PanelTone = 'console' | 'glass' | 'warning' | 'bare';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  as?: ElementType;
  tone?: PanelTone;
  label?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  brackets?: boolean;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Panel({
  as: Tag = 'div',
  tone = 'console',
  label,
  title,
  actions,
  brackets = true,
  className,
  bodyClassName,
  children,
  ...rest
}: PanelProps) {
  const hasMeta = label != null || actions != null;
  return (
    <Tag
      className={cx(
        'tv-panel',
        `tv-panel--${tone}`,
        brackets && 'tv-panel--brackets',
        className,
      )}
      {...rest}
    >
      {hasMeta && (
        <div className="tv-panel__label">
          <span className="tv-panel__label-text">{label ?? 'System'}</span>
          <span className="tv-panel__label-line" aria-hidden="true" />
          {actions != null && <span className="tv-panel__label-actions">{actions}</span>}
        </div>
      )}
      {title != null && (
        <div className="tv-panel__head">
          <h2 className="tv-panel__title">{title}</h2>
        </div>
      )}
      <div className={cx('tv-panel__body', bodyClassName)}>{children}</div>
    </Tag>
  );
}

/* -------------------------------- Button ------------------------------- */
export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  kbd?: string;
  block?: boolean;
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  kbd,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'tv-btn',
        variant !== 'default' && `tv-btn--${variant}`,
        size !== 'md' && `tv-btn--${size}`,
        block && 'tv-btn--block',
        className,
      )}
      {...rest}
    >
      {icon != null && <span className="tv-btn__icon">{icon}</span>}
      <span className="tv-btn__label">{children}</span>
      {kbd != null && <Keycap>{kbd}</Keycap>}
    </button>
  );
}

/* ------------------------------ IconButton ----------------------------- */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('tv-icon-btn', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Tag --------------------------------- */
export type TagTone =
  | 'cyan'
  | 'nominal'
  | 'caution'
  | 'warning'
  | 'hostile'
  | 'ally'
  | 'offline'
  | 'plain';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
}

export function Tag({ tone = 'cyan', className, children, ...rest }: TagProps) {
  return (
    <span className={cx('tv-tag', tone !== 'cyan' && `tv-tag--${tone}`, className)} {...rest}>
      {children}
    </span>
  );
}

/* ------------------------------- Readout ------------------------------- */
export type ReadoutTone = 'cyan' | 'ice' | 'amber' | 'red' | 'green' | 'mute';

export interface ReadoutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: ReadoutTone;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
}

export function Readout({
  label,
  value,
  unit,
  hint,
  tone = 'cyan',
  size = 'md',
  align = 'left',
  className,
  ...rest
}: ReadoutProps) {
  return (
    <div
      className={cx(
        'tv-readout',
        tone !== 'cyan' && `tv-readout--${tone}`,
        size !== 'md' && `tv-readout--${size}`,
        align === 'right' && 'tv-readout--right',
        className,
      )}
      {...rest}
    >
      <span className="tv-readout__label">{label}</span>
      <span className="tv-readout__value">
        {value}
        {unit != null && <span className="tv-readout__unit">{unit}</span>}
      </span>
      {hint != null && <span className="tv-readout__hint">{hint}</span>}
    </div>
  );
}

/* -------------------------------- Meter -------------------------------- */
export interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number;
  max?: number;
  segments?: number;
  tone?: 'cyan' | 'green' | 'amber' | 'red';
  label?: ReactNode;
  ariaLabel?: string;
  showValue?: boolean;
  continuous?: boolean;
  valueSuffix?: string;
}

export function Meter({
  value,
  max = 100,
  segments = 12,
  tone = 'cyan',
  label,
  ariaLabel,
  showValue = false,
  continuous = false,
  valueSuffix,
  className,
  ...rest
}: MeterProps) {
  const safeMax = max <= 0 ? 1 : max;
  const ratio = Math.min(Math.max(value / safeMax, 0), 1);
  const active = Math.round(ratio * segments);
  const readableLabel =
    ariaLabel ?? (typeof label === 'string' ? label : 'Level');
  return (
    <div
      className={cx(
        'tv-meter',
        tone !== 'cyan' && `tv-meter--${tone}`,
        continuous && 'tv-meter--continuous',
        className,
      )}
      role="meter"
      aria-label={readableLabel}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Number(value.toFixed(1))}
      aria-valuetext={`${Number(value.toFixed(1))}${valueSuffix ? ` ${valueSuffix}` : ''}`}
      {...rest}
    >
      {(label != null || showValue) && (
        <div className="tv-meter__head">
          {label != null && <span className="tv-meter__label">{label}</span>}
          {showValue && (
            <span className="tv-meter__value">
              {Math.round(value)}
              {valueSuffix ? ` ${valueSuffix}` : ''}
            </span>
          )}
        </div>
      )}
      <div className="tv-meter__track" aria-hidden="true">
        {continuous ? (
          <span className="tv-meter__fill" style={{ width: `${ratio * 100}%` }} />
        ) : (
          Array.from({ length: segments }, (_, index) => (
            <span
              key={index}
              className={cx('tv-meter__seg', index < active && 'is-on')}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Keycap ------------------------------- */
export interface KeycapProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Keycap({ className, children, ...rest }: KeycapProps) {
  return (
    <kbd className={cx('tv-keycap', className)} {...rest}>
      {children}
    </kbd>
  );
}

/* -------------------------------- Toggle ------------------------------- */
export interface ToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  className,
  type = 'button',
  ...rest
}: ToggleProps) {
  return (
    <button
      type={type}
      className={cx('tv-toggle', className)}
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      {...rest}
    >
      <span className="tv-toggle__track" aria-hidden="true">
        <span className="tv-toggle__thumb" />
      </span>
      <span className="tv-toggle__label">{label}</span>
    </button>
  );
}

/* ------------------------------ StatusLamp ----------------------------- */
export interface StatusLampProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode;
  tone?: 'nominal' | 'caution' | 'warning' | 'offline';
  pulse?: boolean;
}

export function StatusLamp({ label, tone = 'nominal', pulse, className, ...rest }: StatusLampProps) {
  return (
    <span
      className={cx(
        'tv-status-lamp',
        tone !== 'offline' && `tv-status-lamp--${tone}`,
        tone === 'offline' && 'tv-status-lamp--offline',
        pulse && 'tv-status-lamp--pulse',
        className,
      )}
      {...rest}
    >
      <span className="tv-status-lamp__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/* ------------------------------- Dividers ------------------------------ */
export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
}

export function Divider({ label, className, ...rest }: DividerProps) {
  return (
    <div className={cx('tv-divider', className)} role="separator" {...rest}>
      {label != null && <span>{label}</span>}
    </div>
  );
}

export function HazardStripe({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('tv-hazard', className)} aria-hidden="true" {...rest} />;
}
