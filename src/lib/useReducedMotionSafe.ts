"use client";

import { useReducedMotion } from "framer-motion";

/** Wraps framer-motion's hook so callers get a plain boolean, defaulting to false during SSR. */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}
