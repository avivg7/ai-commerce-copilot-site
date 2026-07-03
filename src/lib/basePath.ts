/** GitHub Pages serves this app from a sub-path; use for raw <video>/<img> src/poster attributes that Next.js doesn't rewrite automatically (unlike next/image and next/link). */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
