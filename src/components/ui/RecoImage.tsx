import { cn } from "@/lib/cn";
import { kitAsset } from "@/lib/brand";

const POSES = {
  hero: { w: 960, h: 540, set: [[960, "reco-hero-960.webp"]] },
  celebrate: { w: 480, h: 522, set: [[480, "reco-celebrate-480.webp"], [960, "reco-celebrate-960.webp"]] },
  thinking: { w: 480, h: 687, set: [[480, "reco-thinking-480.webp"], [960, "reco-thinking-960.webp"]] },
  concerned: { w: 480, h: 705, set: [[480, "reco-concerned-480.webp"], [960, "reco-concerned-960.webp"]] },
} as const;

export type RecoPose = keyof typeof POSES;

/**
 * Reco the mascot. Decorative by default (alt=""): pass `alt` only if the picture carries information the text does not.
 * Always has width/height (no layout shift); lazy unless `priority` (the hero is the only priority image).
 */
export function RecoImage({
  pose,
  alt = "",
  priority = false,
  sizes,
  className,
  displayWidth,
}: {
  pose: RecoPose;
  alt?: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
  displayWidth?: number;
}) {
  const p = POSES[pose];
  const srcSet = p.set.map(([w, f]) => `${kitAsset(f)} ${w}w`).join(", ");
  const src = kitAsset(p.set[0][1]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      srcSet={p.set.length > 1 ? srcSet : undefined}
      sizes={sizes}
      width={p.w}
      height={p.h}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      {...(priority ? { fetchPriority: "high" as const } : {})}
      className={cn(className)}
      style={displayWidth ? { inlineSize: displayWidth, blockSize: "auto" } : undefined}
    />
  );
}
