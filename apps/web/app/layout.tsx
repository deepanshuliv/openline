import type { Metadata } from "next";
import { Geist, Newsreader } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AGENT_NAME, CLINIC, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/shared";
import { clerkAppearance } from "@/lib/clerkAppearance";
import "./globals.css";

// Light display serif for headlines, paired with Geist (below) for UI and body.
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

// Geist for UI and body copy: quieter and more precise than Inter.
const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME}: ${PRODUCT_TAGLINE}`,
  description: `${PRODUCT_NAME} answers every patient call with ${AGENT_NAME}, an AI receptionist: booking, rescheduling, insurance checks, refills and live hand-off to staff. Demo for ${CLINIC.name}, a fictional clinic. Synthetic data only.`,
};

const PALETTE_SCRIPT = `try{var p=new URLSearchParams(location.search).get("palette");if(p)localStorage.setItem("palette",p);p=p||localStorage.getItem("palette");if(p&&p!=="lagoon")document.documentElement.dataset.palette=p}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        {/* Palette preview: ?palette=dusk (or lagoon) switches and remembers it. */}
        <script dangerouslySetInnerHTML={{ __html: PALETTE_SCRIPT }} />
      </head>
      <body>
        <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signInFallbackRedirectUrl="/" afterSignOutUrl="/sign-in">
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
