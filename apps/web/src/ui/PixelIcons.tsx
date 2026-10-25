import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export function PixelHomeIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M14 2h2v5h-2zM9 2h2v2H9zm-2 2h6v2H7zm-2 2h10v2H5zm-2 2h14v2H3zm-2 2h18v2H1zm2 2h5v7H3zm9 0h5v7h-5zm-4 0h4v2H8z" />
    </svg>
  );
}

export function PixelFriendsIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 2h4v4H4zM2 6h8v4H2zm1 4h2v5H3zm4 0h2v5H7zm5-6h4v4h-4zm-2 4h8v4h-8zm1 4h2v5h-2zm4 0h2v5h-2z" />
    </svg>
  );
}

export function PixelChatIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 2h14v2H3zm13 2h2v8h-2zM2 4h2v8H2zm1 8h5v2H3zm5 2h2v2H8zm-2 2h2v2H6zm4-4h7v-2h-7zM5 7h2v2H5zm4 0h2v2H9zm4 0h2v2h-2z" />
    </svg>
  );
}

export function PixelProfileIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 2h6v6H7zM5 8h10v2H5zm-2 3h14v3H3zm-1 3h16v4H2z" />
    </svg>
  );
}

export function PixelDocsIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 8h2v2H5zm-2 2h2v2H3zm2 2h2v2H5zm6-6h2v2h-2zm-1 3h2v2h-2zm-1 3h2v2H9zm-1 3h2v2H8zm5-4h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2z" />
    </svg>
  );
}

export function PixelMoreIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon nav-more-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="5" height="5" />
      <rect x="12" y="3" width="5" height="5" />
      <rect x="3" y="12" width="5" height="5" />
      <rect x="12" y="12" width="5" height="5" />
    </svg>
  );
}

export function PixelBellIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 1h2v2H9zM8 3h4v2H8zm-2 2h8v6H6zm-2 6h12v3H4zm-1 3h14v2H3zm5 2h4v2H8z" />
    </svg>
  );
}

export function PixelSearchIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 2h6v2H5zm6 2h2v6h-2zm-6 6h6v2H5zm-2-6h2v6H3zm7 7h2v2h-2zm2 2h2v2h-2zm2 2h3v3h-3z" />
    </svg>
  );
}

export function PixelErrorIcon({ size = 20, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 1h2v2H9zm-2 2h2v2H7zm6 0h-2v2h2zm-8 4h2v4H5zm10 0h-2v4h2zm-12 6h16v2H3zm6-7h2v5H9zm0 6h2v2H9z" />
    </svg>
  );
}

export function PixelCrownIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 14h16v3H2zm1-8h2v8H3zm12 0h2v8h-2zM9 4h2v10H9zm-3 4h2v6H6zm6 0h2v6h-2z" />
    </svg>
  );
}

export function PixelBotIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 1h2v2H9zm-4 4h10v10H5zm-2 3h2v4H3zm12 0h2v4h-2zm-8 1h2v2H7zm6 0h-2v2h2zm-5 4h6v1H8z" />
    </svg>
  );
}

export function PixelCheckIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 10h2v2H3zm2 2h2v2H5zm2 2h2v2H7zm2-2h2v2H9zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2z" />
    </svg>
  );
}

export function PixelCopyIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 2h10v2H6zm9 2h2v9h-2zm-5 4h2v2h-2zM3 6h10v2H3zm9 2h2v10h-2zM3 16h10v2H3zm-2-9h2v10H1z" />
    </svg>
  );
}

export function PixelCoinIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 2h8v2H6zm8 2h2v2h-2zm2 2h2v8h-2zm-2 8h2v2h-2zm-8 2h8v2H6zm-2-2h2v2H4zm-2-8h2v8H2zm2-2h2v2H4zm4 2h4v4H8z" />
    </svg>
  );
}

export function PixelTrophyIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 2h12v2H4zm1 2h10v5H5zm2 5h6v2H7zm2 2h2v3H9zm-4 3h10v2H5zM2 4h2v4H2zm0 4h3v1H2zm16-4h-2v4h2zm0 4h-3v1h3z" />
    </svg>
  );
}

export function PixelDiceIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 3h14v14H3zM5 5h2v2H5zm8 0h2v2h-2zm-4 4h2v2H9zm-4 4h2v2H5zm8 0h2v2h-2z" />
    </svg>
  );
}

export function PixelSpinnerIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`pixel-spinner ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="9" y="1" width="6" height="4" opacity="1" />
      <rect x="17" y="3" width="4" height="4" opacity="0.85" />
      <rect x="19" y="9" width="4" height="6" opacity="0.7" />
      <rect x="17" y="17" width="4" height="4" opacity="0.55" />
      <rect x="9" y="19" width="6" height="4" opacity="0.4" />
      <rect x="3" y="17" width="4" height="4" opacity="0.28" />
      <rect x="1" y="9" width="4" height="6" opacity="0.18" />
      <rect x="3" y="3" width="4" height="4" opacity="0.1" />
    </svg>
  );
}

export function PixelNotFoundIllustration() {
  return (
    <svg
      width="100"
      height="100"
      viewBox="0 0 100 100"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Background shadow & ground */}
      <rect x="10" y="80" width="80" height="4" fill="var(--line)" />
      <rect x="20" y="84" width="60" height="2" fill="var(--line-strong)" />

      {/* Meeple body */}
      <path d="M30 38h16v6h2v14h4v6h3v5h-7v-4h-2v8h-6v-6h-4v6h-6v-8h-2v4h-7v-5h3v-6h4V44h2v-6z" fill="var(--line-strong)" />
      <path d="M32 40h12v4h1v12h4v5h2v3h-5v-3h-2v7h-4v-5h-4v5h-4v-7h-2v3h-5v-3h2v-5h4V44h1v-4z" fill="var(--accent)" />
      {/* Meeple face / eyes looking puzzled */}
      <rect x="34" y="44" width="2" height="3" fill="var(--accent-text)" />
      <rect x="40" y="44" width="2" height="3" fill="var(--accent-text)" />
      <rect x="36" y="48" width="4" height="1" fill="var(--accent-text)" />

      {/* Tumbling 3D Die beside meeple */}
      <rect x="60" y="48" width="24" height="24" fill="var(--panel-raised)" />
      <path d="M60 48h24v2H60zm0 22h24v2H60zm0-22h2v24h-2zm22 0h2v24h-2z" fill="var(--line-strong)" />
      {/* Die pips */}
      <rect x="64" y="52" width="3" height="3" fill="var(--danger)" />
      <rect x="77" y="52" width="3" height="3" fill="var(--danger)" />
      <rect x="70.5" y="58.5" width="3" height="3" fill="var(--danger)" />
      <rect x="64" y="65" width="3" height="3" fill="var(--danger)" />
      <rect x="77" y="65" width="3" height="3" fill="var(--danger)" />

      {/* Floating 404 pixel badge */}
      <rect x="22" y="14" width="56" height="18" fill="var(--panel)" />
      <path d="M22 14h56v2H22zm0 16h56v2H22zm0-16h2v18h-2zm54 0h2v18h-2z" fill="var(--line-strong)" />
      {/* "404" pixel text */}
      {/* 4 */}
      <path d="M30 18h2v4h3v-4h2v10h-2v-4h-5v-6zm3 4v-2h-1v2h1z" fill="var(--line-strong)" />
      {/* 0 */}
      <path d="M42 18h6v10h-6v-10zm4 8v-6h-2v6h2z" fill="var(--line-strong)" />
      {/* 4 */}
      <path d="M52 18h2v4h3v-4h2v10h-2v-4h-5v-6zm3 4v-2h-1v2h1z" fill="var(--line-strong)" />

      {/* Pixel question mark */}
      <path d="M72 10h6v2h2v4h-2v2h-2v2h-2v-4h2v-2h2v-2h-4v-2h-2v-2h2zm2 12h2v2h-2z" fill="var(--warning)" />
    </svg>
  );
}
