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
  const resolvedHref = typeof href === "string" ? href : "#";
  return (
    <a
      href={resolvedHref}
      {...rest}
      onClick={(event) => {
        rest.onClick?.(event);
        // Model the same-document transition that Next Link supplies in the app. Browser
        // component tests do not mount Next's router, but route-level contracts still need
        // the destination to render and browser history to become observable.
        if (event.defaultPrevented || !resolvedHref.startsWith("/")) return;
        event.preventDefault();
        window.history.pushState({}, "", resolvedHref);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      {children}
    </a>
  );
}
