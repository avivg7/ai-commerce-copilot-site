/** Prefix for hand-built URLs (raw <a>, <img>, script text). next/link and next/image add it themselves. Kept in its own tiny module so a client component that only needs it (the 404 page) does not pull in the whole of site.ts. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
