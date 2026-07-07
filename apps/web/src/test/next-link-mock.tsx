import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * A plain-anchor stand-in for `next/link`, shared by the component DOM tests. `next/link`
 * reaches for an app-router context to prefetch, which a bare RTL client tree does not
 * provide, so a card/surface that deep-links (`/actions#action-<id>`) needs it stubbed to
 * render. Redirect the module in a test with:
 *
 *   vi.mock("next/link", () => import("@/test/next-link-mock"));
 *
 * so the default export below becomes `next/link`'s default — the href is preserved for
 * `getByRole("link")` href assertions, all other props pass through.
 */
export default function NextLinkMock({
  href,
  children,
  ...rest
}: { href: unknown; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  );
}
