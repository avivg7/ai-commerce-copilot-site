"use client";
import { useEffect } from "react";

/** Opens the FAQ answer an in-page link points to (#q41, or a retired id such as #q07 that now lives in #q51). Without JavaScript the anchor still scrolls to it. */
export function FaqHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      const d = target?.tagName === "DETAILS" ? (target as HTMLDetailsElement) : (document.querySelector(`details[data-aliases~="${CSS.escape(id)}"]`) as HTMLDetailsElement | null);
      if (d) { d.open = true; if (d.id !== id) d.scrollIntoView({ block: "start" }); }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
