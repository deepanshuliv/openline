import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

// Clerk's sign-in card, user menu and account modal, drawn in Openline's own
// language (app/globals.css): off-white card on a stone surface, near-black
// pill actions, Newsreader titles, Geist UI. Values are the page's CSS tokens,
// so the Dusk palette and any future token change carry through.
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "var(--ink)",
    colorPrimaryForeground: "var(--on-ink)",
    colorForeground: "var(--ink)",
    colorMutedForeground: "var(--ink-muted)",
    colorMuted: "var(--surface)",
    colorBackground: "var(--bg)",
    colorInput: "var(--bg)",
    colorInputForeground: "var(--ink)",
    colorNeutral: "var(--ink)",
    colorBorder: "var(--hairline)",
    colorRing: "var(--ink)",
    colorDanger: "var(--bad)",
    colorSuccess: "var(--good)",
    colorWarning: "var(--warn)",
    colorShadow: "rgba(40, 32, 20, 0.45)",
    colorModalBackdrop: "var(--ink)",
    fontFamily: "var(--font-ui)",
    fontFamilyButtons: "var(--font-ui)",
    fontSize: "14px",
    borderRadius: "16px",
  },
  options: {
    socialButtonsVariant: "blockButton",
    logoPlacement: "none",
  },
  elements: {
    // The card matches the "Connecting to Suzi" dialog (.connectDialog).
    cardBox: {
      width: "min(420px, calc(100vw - 32px))",
      borderRadius: "var(--radius-card)",
      border: "none",
      boxShadow: "0 30px 80px -30px rgba(40, 32, 20, 0.45)",
    },
    card: {
      padding: "32px 28px 24px",
      background: "var(--bg)",
      boxShadow: "none",
      border: "none",
    },
    headerTitle: {
      fontFamily: "var(--font-display)",
      fontWeight: 300,
      fontSize: "28px",
      lineHeight: 1.1,
      letterSpacing: "-0.03em",
    },
    headerSubtitle: { color: "var(--ink-muted)", fontSize: "15px", lineHeight: "22px" },
    // Pills, like every button on the site (.btn).
    socialButtonsBlockButton: {
      height: "44px",
      borderRadius: "var(--radius-pill)",
      border: "none",
      background: "var(--surface)",
      boxShadow: "none",
      "&::after": { display: "none" },
      "&:hover": { background: "#e8e6e0" },
    },
    socialButtonsBlockButtonText: { fontSize: "14px", fontWeight: 400, color: "var(--ink)" },
    // Flat ink, like .btn-primary: no gradient, sheen or arrow.
    formButtonPrimary: {
      height: "40px",
      borderRadius: "var(--radius-pill)",
      fontWeight: 400,
      textTransform: "none",
      background: "var(--ink)",
      backgroundImage: "none",
      boxShadow: "none",
      "&::after": { display: "none" },
      "& svg": { display: "none" },
      "&:hover, &:focus": { background: "#2a2a27", boxShadow: "none" },
    },
    // A stone pill, so it reads against the white card.
    formFieldInput: {
      height: "44px",
      borderRadius: "var(--radius-pill)",
      padding: "0 18px",
      background: "var(--surface)",
      boxShadow: "none",
      border: "none",
    },
    dividerLine: { background: "var(--hairline)" },
    dividerText: { color: "var(--ink-faint)" },
    footer: { background: "var(--surface)", "& + div": { background: "var(--surface)" } },
    footerActionLink: { color: "var(--ink)", fontWeight: 500 },
    // The avatar menu in the nav and the account modal it opens.
    userButtonAvatarBox: { width: "36px", height: "36px" },
    userButtonPopoverCard: {
      borderRadius: "var(--radius-inner)",
      border: "none",
      boxShadow: "0 30px 80px -30px rgba(40, 32, 20, 0.45)",
    },
    userButtonPopoverActionButton: { borderRadius: "12px" },
    modalContent: { borderRadius: "var(--radius-card)" },
    modalBackdrop: { backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" },
  },
};
