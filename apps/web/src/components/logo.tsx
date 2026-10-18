import type { SVGProps } from "react";

interface LogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
  variant?: "badge" | "glyph" | "mono";
  className?: string;
}

/**
 * Shapewise Master Logo Mark
 *
 * Geometric, industrial identity representing modular manufacturing molds,
 * precision blueprint datum points, and dynamic continuous workflow.
 */
export function Logo({
  size = 22,
  variant = "badge",
  className = "",
  ...props
}: LogoProps) {
  if (variant === "glyph") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={`shrink-0 ${className}`}
        {...props}
      >
        {/* Core continuous S-ribbon with precision geometric arcs */}
        <path
          d="M17.5 5.5H8.75A3.25 3.25 0 0 0 8.75 12h6.5a3.25 3.25 0 0 1 0 6.5H6.5"
          stroke="var(--sw-accent)"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Blueprint registration / datum points */}
        <circle cx="6.5" cy="5.5" r="1.4" fill="var(--sw-accent)" />
        <circle cx="17.5" cy="18.5" r="1.4" fill="var(--sw-accent)" />
      </svg>
    );
  }

  if (variant === "mono") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={`shrink-0 ${className}`}
        {...props}
      >
        <rect width="24" height="24" rx="6.5" fill="currentColor" />
        <path
          d="M17.5 5.5H8.75A3.25 3.25 0 0 0 8.75 12h6.5a3.25 3.25 0 0 1 0 6.5H6.5"
          stroke="var(--sw-surface)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="6.5" cy="5.5" r="1.3" fill="var(--sw-surface)" />
        <circle cx="17.5" cy="18.5" r="1.3" fill="var(--sw-surface)" />
      </svg>
    );
  }

  // Default "badge" variant: signature cobalt rounded squircle with crisp white geometry
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...props}
    >
      {/* Precision container squircle */}
      <rect width="24" height="24" rx="6.5" fill="var(--sw-accent)" />

      {/* S-flow curve */}
      <path
        d="M17.5 5.5H8.75A3.25 3.25 0 0 0 8.75 12h6.5a3.25 3.25 0 0 1 0 6.5H6.5"
        stroke="var(--sw-accent-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Blueprint datum coordinates */}
      <circle cx="6.5" cy="5.5" r="1.3" fill="var(--sw-accent-ink)" />
      <circle cx="17.5" cy="18.5" r="1.3" fill="var(--sw-accent-ink)" />
    </svg>
  );
}

/**
 * Full Shapewise Wordmark with integrated logo
 */
export function BrandWordmark({
  size = 22,
  variant = "badge",
  className = "",
}: {
  size?: number;
  variant?: "badge" | "glyph" | "mono";
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-2.5 font-medium tracking-tight ${className}`}>
      <Logo size={size} variant={variant} />
      <span className="text-[15px] font-medium leading-none">Shapewise</span>
    </div>
  );
}
