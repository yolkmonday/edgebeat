import { cn } from "@/lib/utils";

export type LogoProps = { wordmark?: boolean; size?: number; className?: string };

export const Logo = ({ wordmark = false, size = 32, className }: LogoProps) => (
  <span className={cn("inline-flex items-center gap-2.5", className)}>
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role={wordmark ? undefined : "img"} aria-label={wordmark ? undefined : "edgebeat"} aria-hidden={wordmark || undefined}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M5 20 H10.5 L13.5 11 L17.5 25 L20.5 20 H26.5 V6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {wordmark ? (
      <span className="font-semibold tracking-[-0.02em] text-text" style={{ fontSize: size * 0.75 }}>
        edgebeat
      </span>
    ) : null}
  </span>
);
