import { plexFontVariables } from "@tendnote/ui/fonts";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { PublicActivity } from "@/components/public-activity";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { appLinks, publicActivityEndpoint } from "@/lib/site-links";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tendnote - a Personal OS that starts with the people in your life",
    template: "%s - Tendnote",
  },
  description:
    "Keep what people tell you, and reach out at the right time. Tendnote is a private Personal OS that starts with your relationships.",
  icons: {
    icon: [
      {
        url: "/icons/tendnote-favicon-light.png",
        sizes: "64x64",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icons/tendnote-favicon-dark.png",
        sizes: "64x64",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: [{ url: "/icons/tendnote-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#171a18", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexFontVariables} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        {/* Follows the visitor's system theme until they pick one in the header. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <a
            className="sr-only z-50 rounded-lg border bg-background text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus-visible:ring-3 focus-visible:ring-ring"
            href="#main"
          >
            Skip to content
          </a>
          <PublicActivity endpoint={publicActivityEndpoint()} signupHref={appLinks().subscribe}>
            <SiteHeader />
            <main className="flex-1" id="main" tabIndex={-1}>
              {children}
            </main>
            <SiteFooter />
          </PublicActivity>
        </ThemeProvider>
      </body>
    </html>
  );
}
