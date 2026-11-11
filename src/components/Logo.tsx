export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="11" fill="var(--accent)" />
      <ellipse cx="32" cy="32" rx="26" ry="9" fill="none" stroke="var(--accent-2)" strokeWidth="3.5" transform="rotate(-25 32 32)" />
      <circle cx="52" cy="17" r="3" fill="var(--text)" />
      <circle cx="12" cy="46" r="2" fill="var(--text)" />
    </svg>
  );
}
