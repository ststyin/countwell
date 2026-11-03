export default function BrandIcon({ className = '', size = 32 }: { className?: string; size?: number }) {
  return <svg className={`brand-icon ${className}`.trim()} width={size} height={size} viewBox="96 96 320 320" fill="none" aria-hidden="true" focusable="false">
    <path d="M335 176a112 112 0 1 0 0 160" stroke="currentColor" strokeWidth="46" strokeLinecap="round" />
    <rect x="279" y="235" width="77" height="42" rx="21" fill="currentColor" />
  </svg>
}
