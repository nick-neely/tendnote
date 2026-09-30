/**
 * Every destination the marketing chrome links to, in one place.
 *
 * Marketing pages are relative paths on this origin. Sign in and Subscribe
 * cross to the product, which lives on its own app origin; they are built here
 * from `TENDNOTE_APP_ORIGIN` so a preview deployment can point at a preview app.
 */

const PRODUCTION_APP_ORIGIN = "https://app.tendnote.com";
const REPOSITORY_URL = "https://github.com/nick-neely/tendnote";

export type SiteLink = { label: string; href: string };

export type FooterGroup = { heading: string; links: SiteLink[] };

type Env = Record<string, string | undefined>;

/** The product's origin. Anything but a bare http(s) origin is a configuration error. */
export function appOrigin(env: Env = process.env): string {
  const configured = env.TENDNOTE_APP_ORIGIN?.trim();
  if (!configured) return PRODUCTION_APP_ORIGIN;
  const url = new URL(configured);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== configured) {
    throw new Error(`TENDNOTE_APP_ORIGIN must be a bare origin, got "${configured}"`);
  }
  return url.origin;
}

export function appLinks(env: Env = process.env) {
  const origin = appOrigin(env);
  return {
    signIn: `${origin}/sign-in`,
    // Account before payment: Subscribe starts at hosted sign-up, which owns checkout.
    subscribe: `${origin}/sign-up`,
  };
}

export const primaryNav: SiteLink[] = [
  { label: "Product", href: "/product" },
  { label: "Demo", href: "/demo" },
  { label: "Pricing", href: "/pricing" },
  { label: "Privacy & AI", href: "/privacy-and-ai" },
];

/**
 * The status page is hosted independently of the product. Until its address is
 * configured the footer leaves it out rather than linking somewhere unowned.
 */
export function footerGroups(env: Env = process.env): FooterGroup[] {
  const statusUrl = env.TENDNOTE_STATUS_PAGE_URL?.trim();
  return [
    {
      heading: "Product",
      links: [
        { label: "Product", href: "/product" },
        { label: "Demo", href: "/demo" },
        { label: "Pricing", href: "/pricing" },
        { label: "Fair Use", href: "/fair-use" },
      ],
    },
    {
      heading: "Company and help",
      links: [
        { label: "About", href: "/about" },
        { label: "Support", href: "/support" },
        ...(statusUrl ? [{ label: "Status", href: statusUrl }] : []),
      ],
    },
    {
      heading: "Privacy and legal",
      links: [
        { label: "Privacy & AI", href: "/privacy-and-ai" },
        { label: "Terms", href: "/terms" },
        { label: "Privacy Policy", href: "/privacy" },
      ],
    },
    {
      heading: "Open source",
      links: [
        {
          label: "Case study",
          href: `${REPOSITORY_URL}/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/case-studies/tendnote-agent-built-privacy.md`,
        },
        {
          label: "Self-hosting guide",
          href: `${REPOSITORY_URL}/blob/main/docs/self-hosting/vercel-operator-runbook.md`,
        },
        { label: "Source code", href: REPOSITORY_URL },
      ],
    },
  ];
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
