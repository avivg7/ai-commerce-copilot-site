"use client";

import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";
import { fadeUp, viewportOnce } from "@/lib/motion";

interface RevealProps {
  children: ReactNode;
  className?: string;
  variants?: Variants;
  delay?: number;
  as?: "div" | "li";
}

/** Scroll-triggered reveal wrapper. Respects prefers-reduced-motion via globals.css overrides. */
export function Reveal({ children, className, variants = fadeUp, delay = 0, as = "div" }: RevealProps) {
  const MotionTag = as === "li" ? motion.li : motion.div;
  const show = variants.show;
  const showObj = typeof show === "object" ? (show as Record<string, unknown>) : null;
  const delayedVariants: Variants =
    delay && showObj
      ? {
          ...variants,
          show: {
            ...showObj,
            transition: { ...(showObj.transition as Record<string, unknown>), delay },
          },
        }
      : variants;

  return (
    <MotionTag className={className} initial="hidden" whileInView="show" viewport={viewportOnce} variants={delayedVariants}>
      {children}
    </MotionTag>
  );
}
