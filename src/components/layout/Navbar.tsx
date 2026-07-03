"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { navLinks } from "@/data/nav";
import { Logomark } from "./Logomark";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled || menuOpen
          ? "border-b border-line bg-bg/95 shadow-[0_4px_30px_-10px_rgb(15_23_42_/_0.15)] backdrop-blur-xl"
          : "bg-transparent",
      )}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8" aria-label="Primary">
        <Link href="#top" className="flex items-center gap-2.5" onClick={() => setMenuOpen(false)}>
          <Logomark />
          <span className="text-base font-semibold tracking-tight text-ink">AI Commerce Copilot</span>
        </Link>

        <ul className="hidden items-center gap-6 lg:flex xl:gap-8">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {link.label}
                {link.badge && (
                  <span className="rounded-full bg-secondary/10 px-1.5 py-0.5 text-[10px] font-semibold text-secondary-bright">
                    {link.badge}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Button href="#get-started" size="md" className="hidden sm:inline-flex">
            Get Started
          </Button>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg lg:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-line lg:hidden"
          >
            <ul className="flex flex-col gap-1 px-6 py-4">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2 py-3 text-base font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {link.label}
                    {link.badge && (
                      <span className="rounded-full bg-secondary/10 px-1.5 py-0.5 text-[10px] font-semibold text-secondary-bright">
                        {link.badge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
              <li className="pt-2 sm:hidden">
                <Button href="#get-started" size="md" className="w-full" onClick={() => setMenuOpen(false)}>
                  Get Started
                </Button>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
