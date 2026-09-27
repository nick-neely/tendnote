"use client";

import { Button } from "@tendnote/ui/button";
import { cn } from "@tendnote/ui/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { SiteLink } from "@/lib/site-links";

const linkClass =
  "rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring aria-[current=page]:text-foreground";

/**
 * The header's destinations. From `md` up they sit inline; below it they fold
 * behind a Menu disclosure so Sign in stays in reach on a phone. The disclosure
 * closes on Escape (returning focus to its button) and on every navigation.
 */
export function SiteNav({ links, signInHref }: { links: SiteLink[]; signInHref: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownPath, setShownPath] = useState(pathname);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // The menu never survives a navigation, whichever link caused it.
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
        <Button asChild className="ml-3" variant="outline">
          <a href={signInHref}>Sign in</a>
        </Button>
      </nav>

      <div className="flex items-center gap-2 md:hidden">
        <Button asChild variant="outline">
          <a href={signInHref}>Sign in</a>
        </Button>
        <Button
          aria-controls={panelId}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          ref={toggleRef}
          variant="ghost"
        >
          Menu
        </Button>
      </div>

      <nav
        aria-label="Primary"
        className={cn(
          "absolute inset-x-0 top-full border-b bg-background px-gutter pt-2 pb-4 md:hidden",
          !open && "hidden",
        )}
        id={panelId}
      >
        <ul className="flex flex-col">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                aria-current={current(link.href)}
                className={cn(linkClass, "-mx-2.5 block py-3 text-base")}
                href={link.href}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
