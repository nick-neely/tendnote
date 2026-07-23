import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
