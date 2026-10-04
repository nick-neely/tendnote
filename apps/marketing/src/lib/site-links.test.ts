import { describe, expect, it } from "vitest";
import {
  appLinks,
  appOrigin,
  footerGroups,
  legacyAppRedirects,
  primaryNav,
  publicActivityEndpoint,
} from "./site-links";

describe("app links", () => {
  it("send Sign in and Subscribe to the production app origin by default", () => {
    expect(appLinks({})).toEqual({
      signIn: "https://app.tendnote.com/sign-in",
      subscribe: "https://app.tendnote.com/sign-up",
    });
  });

  it("follow a configured app origin, such as a preview deployment", () => {
    expect(appLinks({ TENDNOTE_APP_ORIGIN: "https://preview.example.com" }).signIn).toBe(
      "https://preview.example.com/sign-in",
    );
  });

  it("refuse an app origin that carries a path or another scheme", () => {
    expect(() => appOrigin({ TENDNOTE_APP_ORIGIN: "https://app.tendnote.com/" })).toThrow();
    expect(() => appOrigin({ TENDNOTE_APP_ORIGIN: "javascript:alert(1)" })).toThrow();
  });
});

describe("legacy app redirects", () => {
  it("move only invitation, sign-in, and sign-up links permanently to the same path on the app", () => {
    expect(legacyAppRedirects({})).toEqual([
      {
        source: "/join/:path+",
        destination: "https://app.tendnote.com/join/:path+",
        permanent: true,
      },
      { source: "/sign-in", destination: "https://app.tendnote.com/sign-in", permanent: true },
      { source: "/sign-up", destination: "https://app.tendnote.com/sign-up", permanent: true },
    ]);
  });

  it("follow a configured app origin", () => {
    const [join] = legacyAppRedirects({ TENDNOTE_APP_ORIGIN: "http://localhost:3000" });
    expect(join?.destination).toBe("http://localhost:3000/join/:path+");
  });
});

describe("the public activity endpoint", () => {
  it("reports to the production app from a production deployment", () => {
    expect(publicActivityEndpoint({ VERCEL_ENV: "production" })).toBe(
      "https://app.tendnote.com/api/public-activity",
    );
  });

  it("reports to an app origin it was explicitly given", () => {
    expect(publicActivityEndpoint({ TENDNOTE_APP_ORIGIN: "http://localhost:3000" })).toBe(
      "http://localhost:3000/api/public-activity",
    );
  });

  it.each([
    ["a local build", {}],
    ["a preview build", { VERCEL_ENV: "preview" }],
  ])("reports nothing from %s with no app origin", (_name, env) => {
    expect(publicActivityEndpoint(env)).toBeUndefined();
  });
});

describe("site navigation", () => {
  it("puts Product, Demo, Pricing, and Privacy & AI in the header, in that order", () => {
    expect(primaryNav.map((link) => link.label)).toEqual([
      "Product",
      "Demo",
      "Pricing",
      "Privacy & AI",
    ]);
  });

  it("groups the footer as decided and links Status only once it is hosted", () => {
    const withoutStatus = footerGroups({});
    expect(withoutStatus.map((group) => [group.heading, group.links.map((l) => l.label)])).toEqual([
      ["Product", ["Product", "Demo", "Pricing", "Fair Use"]],
      ["Company and help", ["About", "Support"]],
      ["Privacy and legal", ["Privacy & AI", "Terms", "Privacy Policy"]],
      ["Open source", ["Case study", "Self-hosting guide", "Source code"]],
    ]);

    const help = footerGroups({ TENDNOTE_STATUS_PAGE_URL: "https://status.example.com" })[1];
    expect(help?.links.at(-1)).toEqual({ label: "Status", href: "https://status.example.com" });
  });
});
