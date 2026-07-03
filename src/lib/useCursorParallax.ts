"use client";

import { type RefObject, useEffect } from "react";
import { useMotionValue, useSpring } from "framer-motion";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

/**
 * Tracks pointer position relative to a container and returns spring-smoothed
 * rotateX/rotateY values so the element gently tilts toward the cursor.
 * Disabled on touch devices and when the user prefers reduced motion.
 */
export function useCursorParallax(ref: RefObject<HTMLElement | null>, intensity = 8) {
  const reducedMotion = useReducedMotionSafe();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const rotateX = useSpring(rawX, { stiffness: 120, damping: 16, mass: 0.4 });
  const rotateY = useSpring(rawY, { stiffness: 120, damping: 16, mass: 0.4 });

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    function handleMove(e: PointerEvent) {
      const rect = el!.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      rawY.set(px * intensity);
      rawX.set(-py * intensity);
    }

    function handleLeave() {
      rawX.set(0);
      rawY.set(0);
    }

    window.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerleave", handleLeave);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerleave", handleLeave);
    };
  }, [ref, reducedMotion, intensity, rawX, rawY]);

  return { rotateX, rotateY };
}
