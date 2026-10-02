"use client";

import { Button } from "@tendnote/ui/button";
import { cn } from "@tendnote/ui/cn";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@tendnote/ui/sheet";
import { TendnoteLogo } from "@tendnote/ui/tendnote-logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeSegmentedControl, ThemeSwitcher } from "@/components/theme-switcher";
import type { SiteLink } from "@/lib/site-links";

const linkClass =
  "rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring aria-[current=page]:text-foreground";

/**
 * The header's destinations. From `md` up they sit inline beside the theme
 * menu and Sign in. Below it they move into a sheet from the right, with the
 * appearance control and Sign in at its foot, so the bar keeps only the logo,
 * Sign in, and Menu. The sheet is a Radix dialog: it traps focus, closes on
 * Escape or the overlay and returns focus to Menu, and closes on every
 * navigation.
 */
export function SiteNav({ links, signInHref }: { links: SiteLink[]; signInHref: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownPath, setShownPath] = useState(pathname);

  // The menu never survives a navigation, whichever link caused it.
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }

  const current = (href: string) => (pathname === href ? "page" : undefined);

  return (
    <>
      <nav aria-label="Primary" className="hidden flex-1 items-center justify-end gap-1 md:flex">
        <ul className="flex items-center gap-1">
          {links.map((link) => (
            <li key={link.href}>
              <Link aria-current={current(link.href)} className={linkClass} href={link.href}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <ThemeSwitcher className="ml-2" />
        <Button asChild className="ml-1" variant="outline">
          <a href={signInHref}>Sign in</a>
        </Button>
      </nav>

      <div className="flex items-center gap-2 md:hidden">
        <Button asChild variant="outline">
          <a href={signInHref}>Sign in</a>
        </Button>
        <Sheet onOpenChange={setOpen} open={open}>
          <SheetTrigger asChild>
            <Button variant="ghost">Menu</Button>
          </SheetTrigger>
          <SheetContent className="w-[85%] gap-0 sm:max-w-sm" side="right">
            <SheetHeader className="border-b px-gutter py-3.5">
              <TendnoteLogo size="header" />
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Pages on tendnote.com</SheetDescription>
            </SheetHeader>
            <nav aria-label="Primary" className="px-gutter py-3">
              <ul className="flex flex-col">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      aria-current={current(link.href)}
                      className={cn(linkClass, "-mx-2.5 block py-3 text-lg")}
                      href={link.href}
                      onClick={() => setOpen(false)}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <SheetFooter className="gap-5 border-t px-gutter pt-5 pb-6">
              <ThemeSegmentedControl />
              <Button asChild size="lg" variant="outline">
                <a href={signInHref}>Sign in</a>
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
