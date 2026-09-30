import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";

// IBM Plex superfamily — one voice, three registers (DESIGN.md §4). next/font
// pins these into self-hosted files and exposes a CSS variable per family; the
// theme tokens in theme.css point --font-sans/-mono/-display at these vars.
// display: "swap" so the fallback shows immediately and text never goes blank
// (no FOIT). Non-variable Google fonts need explicit weight arrays.

// Sans carries all UI: 400 body, 500 medium labels, 600 semibold headings.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Serif is display-only (greeting, person name, auth title). Every display
// surface renders semibold, so we ship only the one weight they use — 600.
const plexSerif = IBM_Plex_Serif({
  variable: "--font-plex-serif",
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

// Mono is machine facts only: timestamps, IDs, source labels. 400 default, 500
// for the occasional emphasized value.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/** The three font variables, for each app's root `<html>`. */
export const plexFontVariables = `${plexSans.variable} ${plexSerif.variable} ${plexMono.variable}`;
