import { TendnoteLogo } from "@tendnote/ui/tendnote-logo";
import Link from "next/link";
import { footerGroups, isExternal, type SiteLink } from "@/lib/site-links";

const linkClass =
  "rounded-sm text-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring";

function FooterLink({ link }: { link: SiteLink }) {
  if (isExternal(link.href)) {
    return (
      <a className={linkClass} href={link.href}>
        {link.label}
      </a>
    );
  }
  return (
    <Link className={linkClass} href={link.href}>
      {link.label}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto max-w-6xl px-gutter py-12 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-3">
            <Link
              aria-label="Tendnote home"
              className="-mx-1 w-fit rounded-lg px-1 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring"
              href="/"
            >
              <TendnoteLogo size="header" />
            </Link>
            <p className="max-w-xs text-sm text-muted-foreground">
              A Personal OS that starts with the people in your life.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {footerGroups().map((group) => (
              <div className="flex flex-col gap-3" key={group.heading}>
                <h2 className="text-sm font-semibold">{group.heading}</h2>
                <ul className="flex flex-col gap-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <FooterLink link={link} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          Tendnote is operated by Neely Solutions LLC and published as open source under the
          AGPL-3.0.
        </p>
      </div>
    </footer>
  );
}
