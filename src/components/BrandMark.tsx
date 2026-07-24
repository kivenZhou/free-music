import { useId } from "react";

/** YinZhan mark — stacked shelves + equalizer, brand amber on charcoal. */
export function BrandMark({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const bg = `yz-bg-${uid}`;
  const bar = `yz-bar-${uid}`;

  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2a2218" />
          <stop offset="100%" stopColor="#141210" />
        </linearGradient>
        <linearGradient id={bar} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0bc6a" />
          <stop offset="100%" stopColor="#e8a84a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14.5"
        fill="none"
        stroke="rgba(232,168,74,0.3)"
        strokeWidth="1.5"
      />
      {/* Centered stack — 栈 shelves / equalizer */}
      <rect x="22" y="15" width="20" height="7" rx="3.5" fill={`url(#${bar})`} opacity="0.5" />
      <rect x="18" y="26" width="28" height="7" rx="3.5" fill={`url(#${bar})`} opacity="0.72" />
      <rect x="16" y="37" width="32" height="7" rx="3.5" fill={`url(#${bar})`} />
      <rect x="21" y="48" width="22" height="7" rx="3.5" fill={`url(#${bar})`} opacity="0.85" />
    </svg>
  );
}
