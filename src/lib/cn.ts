import { clsx, type ClassValue } from "clsx";

/** Join class names. Components use semantic .aicc-* classes, so no Tailwind conflict resolution is needed. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
