"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { TrendingUp, MousePointerClick, Sparkles, Lightbulb, Package } from "lucide-react";
import { useCursorParallax } from "@/lib/useCursorParallax";
import { GradientGlow } from "@/components/ui/GradientGlow";

const chips = [
  { icon: TrendingUp, label: "+ Revenue", className: "left-[-6%] top-[8%]", delay: "0s", speed: "animate-float-slow" },
  { icon: MousePointerClick, label: "CTR 18.6%", className: "right-[-8%] top-[18%]", delay: "0.6s", speed: "animate-float-slower" },
  { icon: Sparkles, label: "Recommendations", className: "left-[-4%] bottom-[22%]", delay: "1.1s", speed: "animate-float-slower" },
  { icon: Lightbulb, label: "Insights", className: "right-[-4%] bottom-[8%]", delay: "0.3s", speed: "animate-float-slow" },
  { icon: Package, label: "Bundles", className: "left-[18%] bottom-[-6%]", delay: "1.5s", speed: "animate-float-slow" },
];

export function RecoHeroVideo() {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { rotateX, rotateY } = useCursorParallax(frameRef, 6);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative mx-auto flex max-w-lg items-center justify-center py-10 [perspective:1200px] sm:max-w-xl">
      <GradientGlow tone="primary" className="left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2" />

      <motion.div
        ref={frameRef}
        style={{ rotateX, rotateY }}
        className="relative aspect-square w-full max-w-md [transform-style:preserve-3d]"
      >
        <video
          ref={videoRef}
          className="fade-radial h-full w-full scale-110 object-contain drop-shadow-[0_30px_60px_rgba(30,58,138,0.25)]"
          src="/videos/reco-hero.mp4"
          poster="/images/reco/reco-hero-poster.jpg"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        />

        {chips.map(({ icon: Icon, label, className, delay, speed }) => (
          <div
            key={label}
            className={`absolute ${className} ${speed} hidden sm:block`}
            style={{ animationDelay: delay }}
          >
            <div className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-ink shadow-lg">
              <Icon className="h-3.5 w-3.5 text-primary-bright" strokeWidth={2.5} />
              {label}
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
