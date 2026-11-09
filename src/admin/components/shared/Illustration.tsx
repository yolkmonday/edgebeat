import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type IllustrationName = "welcome" | "done" | "all-good" | "stale" | "error" | "empty-monitors" | "heartbeat";

const HAS_TRANSPARENT: ReadonlySet<IllustrationName> = new Set(["welcome", "done", "all-good", "stale", "error"]);

const useIsDark = () => {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
};

export type IllustrationProps = { name: IllustrationName; className?: string };

/**
 * Decorative image. Uses the transparent cut-out when one exists (the opaque files have a faint off-white square);
 * otherwise the opaque image, on a light plate in the dark theme.
 */
export const Illustration = ({ name, className }: IllustrationProps) => {
  const dark = useIsDark();
  const transparent = HAS_TRANSPARENT.has(name);
  const src = `/admin/illustrations/${transparent ? "transparent/" : ""}${name}.webp`;
  const img = <img src={src} alt="" width={640} height={480} loading="lazy" decoding="async" className={cn("h-auto", className)} />;
  if (dark && !transparent) return <span className="inline-block rounded-lg bg-[#EDEDF0] p-2">{img}</span>;
  return img;
};
