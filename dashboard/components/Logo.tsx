export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  // Three peer nodes in a mesh — no centre node on purpose.
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <path
        d="M20 6 L33 28 L7 28 Z"
        fill="none"
        stroke="url(#lg)"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <circle cx="20" cy="6" r="4" fill="#22D3EE" />
      <circle cx="33" cy="28" r="4" fill="#3B82F6" />
      <circle cx="7" cy="28" r="4" fill="#22C55E" />
      <circle cx="20" cy="21" r="2" fill="#0B1220" stroke="#22D3EE" strokeWidth="1" opacity="0.7" />
    </svg>
  );
}
