"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useMotionValue, useMotionValueEvent } from "framer-motion";
import { useReducedMotionSafe } from "@/lib/useReducedMotionSafe";

interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

export function AnimatedCounter({ value, prefix = "", suffix = "", decimals = 0, className }: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const reducedMotion = useReducedMotionSafe();
  const motionValue = useMotionValue(0);
  const [display, setDisplay] = useState("0");

  useMotionValueEvent(motionValue, "change", (latest) => {
    setDisplay(latest.toFixed(decimals));
  });

  useEffect(() => {
    if (!isInView) return;
    if (reducedMotion) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration: 1.8, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [isInView, reducedMotion, value, decimals, motionValue]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {Number(display).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
