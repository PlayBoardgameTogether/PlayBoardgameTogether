import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export function PixelHomeIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1h4v-5.5a1.5 1.5 0 0 1 3 0V21h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function PixelFriendsIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0" />
      <circle cx="17" cy="9.5" r="2.5" />
      <path d="M16.5 14.5a4.5 4.5 0 0 1 5 5" />
    </svg>
  );
}

export function PixelChatIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.8 8.8 0 0 1-3.8-.9L3 21l1.9-5.2A8.5 8.5 0 1 1 21 11.5Z" />
      <circle cx="9" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PixelProfileIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function PixelDocsIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 9 4 12l4 3" />
      <path d="m16 9 4 3-4 3" />
      <path d="m13.5 6-3 12" />
    </svg>
  );
}

export function PixelMoreIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon nav-more-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  );
}

export function PixelBellIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.8 6.2 2.5 7H3.5C4.2 15.2 6 13.5 6 9Z" />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

export function PixelSearchIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function PixelErrorIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PixelCrownIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m3 8 4.5 4 4.5-6 4.5 6L21 8l-2 10H5L3 8Z" />
    </svg>
  );
}

export function PixelBotIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3v3" />
      <rect x="4" y="6" width="16" height="13" rx="4" />
      <circle cx="9.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9.5 15.5h5" />
    </svg>
  );
}

export function PixelCheckIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function PixelCopyIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

export function PixelCoinIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
}

export function PixelTrophyIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 4h10v6a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4.5a2 2 0 0 0 0 4H7" />
      <path d="M17 6h2.5a2 2 0 0 1 0 4H17" />
      <path d="M12 15v4" />
      <path d="M8 19h8" />
    </svg>
  );
}

export function PixelDiceIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PixelSpinnerIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`pixel-spinner ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3.5" />
      <path
        d="M16 4a12 12 0 0 1 12 12"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PixelNotFoundIllustration() {
  return (
    <svg width="112" height="112" viewBox="0 0 112 112" fill="none" aria-hidden="true">
      <ellipse cx="56" cy="96" rx="34" ry="6" fill="var(--line-strong)" opacity="0.45" />
      <rect
        x="22"
        y="22"
        width="46"
        height="46"
        rx="14"
        transform="rotate(-10 22 22)"
        fill="var(--panel-raised)"
        stroke="var(--line-strong)"
        strokeWidth="2.5"
      />
      <circle cx="38" cy="36" r="3.5" fill="var(--accent)" />
      <circle cx="54" cy="48" r="3.5" fill="var(--accent)" />
      <circle cx="42" cy="52" r="3.5" fill="var(--accent)" />
      <rect
        x="52"
        y="40"
        width="42"
        height="42"
        rx="12"
        transform="rotate(8 52 40)"
        fill="var(--panel)"
        stroke="var(--line-strong)"
        strokeWidth="2.5"
      />
      <text
        x="71"
        y="69"
        textAnchor="middle"
        fontSize="16"
        fontWeight="900"
        fill="var(--text)"
        fontFamily="system-ui, sans-serif"
      >
        404
      </text>
    </svg>
  );
}

export function PixelLoadingDice({
  size = 56,
  className = '',
  label = '正在加载…',
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`pixel-loading-dice ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label={label}
    >
      <svg className="c3-loading-die-svg" viewBox="0 0 56 56" fill="none" aria-hidden="true">
        <ellipse className="c3-loading-die-shadow" cx="28" cy="49" rx="14" ry="3.5" fill="currentColor" opacity="0.16" />
        <g className="c3-loading-die-cube">
          <rect x="12" y="8" width="32" height="32" rx="9" fill="#ea580c" stroke="#c2410c" strokeWidth="2" />
          <rect x="14" y="10" width="28" height="10" rx="6" fill="#ffffff" fillOpacity="0.18" />
          <circle cx="21" cy="17" r="2.6" fill="#ffffff" />
          <circle cx="35" cy="17" r="2.6" fill="#ffffff" />
          <circle cx="28" cy="24" r="2.6" fill="#ffffff" />
          <circle cx="21" cy="31" r="2.6" fill="#ffffff" />
          <circle cx="35" cy="31" r="2.6" fill="#ffffff" />
        </g>
      </svg>
    </div>
  );
}
