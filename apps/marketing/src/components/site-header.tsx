import { TendnoteLogo } from "@tendnote/ui/tendnote-logo";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { appLinks, primaryNav } from "@/lib/site-links";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-gutter sm:px-6">
        <Link
          aria-label="Tendnote home"
          className="-mx-1 rounded-lg px-1 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring"
          href="/"
        >
          <TendnoteLogo size="header" />
        </Link>
        <SiteNav links={primaryNav} signInHref={appLinks().signIn} />
      </div>
    </header>
  );
}
