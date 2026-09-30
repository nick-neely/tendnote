import { plexFontVariables } from "@tendnote/ui/fonts";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReversibleMutationProvider } from "@/lib/reversible-mutation";
import "./globals.css";

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
    <html lang="en" className={`${plexFontVariables} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <ReversibleMutationProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </ReversibleMutationProvider>
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
