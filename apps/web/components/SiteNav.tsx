"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone, Waveform } from "@phosphor-icons/react";
import { AGENT_NAME, PRODUCT_NAME } from "@/lib/shared";

const LINKS = [
  { href: "/staff", label: "Staff console" },
  { href: "/calls", label: "Call history" },
];

// The product mark, shared by the site nav and the call screen's top bar.
export function Wordmark() {
  return (
    <>
      <Waveform size={22} weight="regular" className="wordmarkGlyph" aria-hidden="true" />
      {PRODUCT_NAME}
    </>
  );
}

// Single-line top bar. Pages pass their own primary action; elsewhere it
// links back home to start a call, styled the same as the home page's button.
export function SiteNav({ action }: { action?: ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="container">
      <nav className="siteNav" aria-label="Main">
        <Link href="/" className="wordmark">
          <Wordmark />
        </Link>
        <div className="navLinks">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="navLink" aria-current={pathname?.startsWith(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
          <span className="navCta">
            {action ?? (
              <Link href="/" className="btn btn-primary">
                <Phone size={16} weight="regular" aria-hidden="true" />
                Call {AGENT_NAME}
              </Link>
            )}
          </span>
        </div>
      </nav>
    </header>
  );
}
