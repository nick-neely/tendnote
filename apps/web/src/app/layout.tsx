import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// IBM Plex superfamily — one voice, three registers (DESIGN.md §4). next/font
// pins these into self-hosted files and exposes a CSS variable per family; the
// theme tokens in globals.css point --font-sans/-mono/-display at these vars.
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

export const metadata: Metadata = {
  title: "Tendnote",
  description: "A private relationship memory and follow-up assistant.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tendnote",
  },
  icons: {
    icon: [
      {
        url: "/icons/tendnote-favicon-light.png?asset=v2",
        sizes: "64x64",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icons/tendnote-favicon-dark.png?asset=v2",
        sizes: "64x64",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    shortcut: [{ url: "/favicon.ico?asset=v2", type: "image/x-icon" }],
    apple: [
      {
        url: "/icons/tendnote-192.png?asset=v2",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#171a18", media: "(prefers-color-scheme: dark)" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
