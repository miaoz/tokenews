/** Tokenews directory-T mark. Keep its geometry in sync with public/favicon.svg. */
export default function BrandIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="brand-icon"
    >
      <rect x="4" y="4" width="24" height="6" rx="1.5" />
      <rect x="13" y="9" width="6" height="19" rx="1.5" />
      <rect x="4" y="14" width="6" height="5" rx="1" />
      <rect x="4" y="23" width="6" height="5" rx="1" />
      <rect x="22" y="14" width="6" height="5" rx="1" />
      <rect x="22" y="23" width="6" height="5" rx="1" />
    </svg>
  );
}
