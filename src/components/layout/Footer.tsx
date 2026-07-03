import Link from "next/link";
import { Logomark } from "./Logomark";

const columns = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it Works", href: "#how-it-works" },
      { label: "Insights", href: "#insights" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "#documentation" },
      { label: "GitHub", href: "#github" },
      { label: "Contact", href: "#contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "#privacy" },
      { label: "Terms", href: "#terms" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-navy text-white/70">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Logomark />
              <span className="text-base font-semibold text-white">AI Commerce Copilot</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed">
              AI-powered commerce intelligence for WooCommerce. Meet Reco, your AI merchandising copilot.
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.heading}>
              <h3 className="text-sm font-semibold text-white">{col.heading}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="rounded text-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-white/10 pt-8 text-sm">
          © {new Date().getFullYear()} AI Commerce Copilot. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
