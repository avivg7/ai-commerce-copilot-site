"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
// The kit is plain ES modules in brand/js (shared byte-for-byte with the Control Plane theme). React only calls them.
import { initBrand } from "../../../brand/js/index.js";
import { kitAsset } from "@/lib/brand";

/** Wires every kit component present in the document (header, language menu, Reco hero, demo, modal). Idempotent; re-runs after soft navigation. */
export function BrandInit() {
  const pathname = usePathname();
  useEffect(() => {
    initBrand({ assetsBase: kitAsset("").replace(/\/$/, "") });
  }, [pathname]);
  return null;
}
