"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Thin client wrapper around next-themes, per the shadcn Next.js recipe. Mounted
 * once in the root layout with attribute="class" so the `.dark` token set in
 * globals.css follows the user's choice, defaultTheme="system" + enableSystem so
 * light and dark are system-aware out of the box (PRODUCT.md: both themes
 * first-class, system-aware with a user toggle), and disableTransitionOnChange so
 * a theme switch swaps tokens instantly instead of animating every color at once.
 *
 * next-themes injects a tiny pre-hydration script that sets the class (and
 * `color-scheme`) on <html> before paint, which is why layout.tsx marks <html>
 * suppressHydrationWarning — the server renders no class, the script adds one, and
 * that single expected mismatch is silenced without silencing real ones.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
