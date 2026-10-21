import geometry from "./brand-geometry.json";

/** Shared vector artwork: the website and exported assets use the same paths. */
export function BrandLogo({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <svg
      className={markOnly ? "skiva-logo skiva-logo-mark" : "skiva-logo"}
      viewBox={markOnly ? "0 0 94 124" : "0 0 480 124"}
      width={markOnly ? 26 : 112}
      height={32}
      role="img"
      aria-label="Skiva"
      focusable="false"
    >
      <path className="skiva-logo-symbol" d={geometry.mark} />
      {!markOnly && (
        <path
          fill="currentColor"
          fillRule="evenodd"
          d={geometry.wordmark}
          transform="translate(35 0)"
        />
      )}
    </svg>
  );
}
