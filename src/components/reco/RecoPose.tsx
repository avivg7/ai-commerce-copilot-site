import Image from "next/image";
import { cn } from "@/lib/cn";
import { basePath } from "@/lib/basePath";
import { GradientGlow } from "@/components/ui/GradientGlow";

export type RecoPoseName = "celebrate" | "thinking" | "concerned";

const poseMeta: Record<RecoPoseName, { src: string; width: number; height: number; alt: string; glow: "primary" | "secondary" | "accent" }> = {
  celebrate: {
    src: `${basePath}/images/reco/reco-celebrate.png`,
    width: 2096,
    height: 2280,
    alt: "Reco the AI Commerce Copilot mascot celebrating rising revenue",
    glow: "secondary",
  },
  thinking: {
    src: `${basePath}/images/reco/reco-thinking.png`,
    width: 1592,
    height: 2280,
    alt: "Reco the AI Commerce Copilot mascot thinking and pointing at a recommended product",
    glow: "accent",
  },
  concerned: {
    src: `${basePath}/images/reco/reco-concerned.png`,
    width: 1552,
    height: 2280,
    alt: "Reco the AI Commerce Copilot mascot looking curious and concerned",
    glow: "primary",
  },
};

interface RecoPoseProps {
  pose: RecoPoseName;
  size?: number;
  className?: string;
  float?: boolean;
  priority?: boolean;
}

export function RecoPose({ pose, size = 220, className, float = true, priority = false }: RecoPoseProps) {
  const meta = poseMeta[pose];
  return (
    <div
      className={cn("relative flex items-center justify-center", float && "animate-float-slow", className)}
      style={{ width: size, height: size * (meta.height / meta.width) }}
    >
      <GradientGlow tone={meta.glow} className="left-1/2 top-1/2 h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2 opacity-80" />
      <div className="relative h-full w-full overflow-hidden rounded-[1.75rem] bg-white p-3 shadow-[0_20px_45px_-15px_rgba(15,23,42,0.25)] ring-1 ring-black/5">
        <Image
          src={meta.src}
          alt={meta.alt}
          width={meta.width}
          height={meta.height}
          priority={priority}
          className="h-full w-full object-contain"
        />
      </div>
    </div>
  );
}
