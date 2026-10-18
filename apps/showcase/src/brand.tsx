import { cx } from '@theve/ui';

export interface BrandProps {
  compact?: boolean;
  className?: string;
  href?: string;
}

export function Brand({ compact = false, className, href = '#/' }: BrandProps) {
  return (
    <a className={cx('brand', compact && 'brand--compact', className)} href={href}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M20 2 38 20 20 38 2 20Z" stroke="currentColor" strokeWidth="1.1" />
          <path d="M20 8 26 20 20 32 14 20Z" fill="currentColor" />
          <path d="M8 20h6M26 20h6" stroke="currentColor" strokeWidth="1" />
          <path d="M20 2v4M20 34v4" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
        </svg>
      </span>
      <span className="brand__text">
        <strong>
          THEVE <span>//</span> TACS-8
        </strong>
        {!compact && <small>TACTICAL AVIONICS · 战术航电</small>}
      </span>
    </a>
  );
}

export function BrandRule() {
  return <span className="brand-rule" aria-hidden="true" />;
}
