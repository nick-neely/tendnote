/**
 * Every destination the marketing chrome links to, in one place.
 *
 * Marketing pages are relative paths on this origin. Sign in and Subscribe
 * cross to the product, which lives on its own app origin; they are built here
 * from `TENDNOTE_APP_ORIGIN` so a preview deployment can point at a preview app.
 */

const PRODUCTION_APP_ORIGIN = "https://app.tendnote.com";
export const REPOSITORY_URL = "https://github.com/nick-neely/tendnote";
// Pinned to the commit that published it, so the account it gives cannot drift.
export const CASE_STUDY_URL = `${REPOSITORY_URL}/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/case-studies/tendnote-agent-built-privacy.md`;
export const SELF_HOSTING_GUIDE_URL = `${REPOSITORY_URL}/blob/main/docs/self-hosting/vercel-operator-runbook.md`;
export const COMMUNITY_SUPPORT_URL = `${REPOSITORY_URL}/blob/main/docs/support.md`;

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

/**
 * The old product entry points that emails and bookmarks still hold on this
 * origin: Household Invitation links, sign-in, and sign-up. Once marketing takes
 * `tendnote.com`, only these move permanently (308) to the same path on the app,
 * query included. Every other path belongs to marketing; an unknown one is a
 * 404 that links to the app.
 */
export function legacyAppRedirects(env: Env = process.env) {
  const origin = appOrigin(env);
  return ["/join/:path+", "/sign-in", "/sign-up"].map((source) => ({
    source,
    destination: `${origin}${source}`,
    permanent: true,
  }));
}

/**
 * Where the site reports anonymous public activity (#646), or `undefined` when
 * it should report nothing. Only a production deployment reports to the
 * production default; a local or preview build reports only to an app origin
 * it was explicitly given, so testing the site never moves the real counters.
 */
export function publicActivityEndpoint(env: Env = process.env): string | undefined {
  if (!env.TENDNOTE_APP_ORIGIN?.trim() && env.VERCEL_ENV !== "production") return undefined;
  return `${appOrigin(env)}/api/public-activity`;
}

export const primaryNav: SiteLink[] = [
  { label: "Product", href: "/product" },
  { label: "Demo", href: "/demo" },
  { label: "Pricing", href: "/pricing" },
  { label: "Privacy & AI", href: "/privacy-and-ai" },
];

/** The independently hosted status page, once it exists. */
export function statusPageUrl(env: Env = process.env): string | undefined {
  return env.TENDNOTE_STATUS_PAGE_URL?.trim() || undefined;
}

/**
 * The status page is hosted independently of the product. Until its address is
 * configured the footer leaves it out rather than linking somewhere unowned.
 */
export function footerGroups(env: Env = process.env): FooterGroup[] {
  const statusUrl = statusPageUrl(env);
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
        { label: "Case study", href: CASE_STUDY_URL },
        { label: "Self-hosting guide", href: SELF_HOSTING_GUIDE_URL },
        { label: "Source code", href: REPOSITORY_URL },
      ],
    },
  ];
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
