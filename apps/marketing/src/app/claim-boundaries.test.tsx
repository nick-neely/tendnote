import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "./about/page";
import DemoPage from "./demo/page";
import FairUsePage from "./fair-use/page";
import PricingPage from "./pricing/page";
import PrivacyAndAiPage from "./privacy-and-ai/page";
import ProductPage from "./product/page";
import SupportPage from "./support/page";

/*
 * The spec's claim boundaries, checked against what each page actually
 * renders: no uptime figure, no unlimited use, no fifteen-minute promise, and
 * no number for the lighter model's turns until qualification measures it.
 */
const pages = {
  "/about": AboutPage,
  "/demo": DemoPage,
  "/fair-use": FairUsePage,
  "/pricing": PricingPage,
  "/privacy-and-ai": PrivacyAndAiPage,
  "/product": ProductPage,
  "/support": SupportPage,
};

function text(Page: () => React.ReactNode): string {
  return renderToStaticMarkup(createElement(Page))
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
}

describe.each(Object.entries(pages))("%s", (_path, Page) => {
  const rendered = text(Page);

  it("publishes no uptime figure, unlimited use, or fifteen-minute claim", () => {
    expect(rendered).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(rendered).not.toMatch(/\bunlimited\b/i);
    expect(rendered).not.toMatch(/\b(fifteen|15)[ -]minutes?\b/i);
  });

  it("gives no turn count for the lighter model", () => {
    expect(rendered).not.toMatch(/\d+\s*(more|further|extra)\s+turns/i);
    expect(rendered).not.toMatch(/lighter model[^.]*\b\d{2,}\b[^.]*turns/i);
  });
});

describe("pricing disclosures", () => {
  const rendered = text(PricingPage);

  it.each([
    ["the price and tax", /\$20 a month.*\$200 a year.*plus applicable sales tax/i],
    ["one account per subscription", /One subscription covers one account/],
    ["eligibility", /eighteen or older who live in the United States/],
    ["payment first, no trial", /There is no free trial/],
    ["the guarantee", /full refund/],
    ["period-end cancellation", /keep access until the end of the period/],
    ["the support promise", /within 2 business days, Central Time/],
    ["the household note", /Sharing with a household/],
    ["the self-hosting alternative", /Or run it yourself, free/],
  ])("states %s", (_name, pattern) => {
    expect(rendered).toMatch(pattern);
  });
});

describe("demo boundaries", () => {
  const rendered = text(DemoPage);

  it("never reaches for the product's development demo session", () => {
    expect(rendered).not.toMatch(/demo-session/);
  });
});

describe("tracking disclosure", () => {
  const rendered = text(PrivacyAndAiPage);

  it.each([
    ["no cookies on this site", /This site sets no cookies\./],
    ["the anonymous page counters", /keeps a daily count of which pages are viewed/],
    ["the demo and signup counters", /demo is started and finished, and how often Subscribe/],
    [
      "no identifier and no join",
      /no visitor ID and nothing that ties a count to you or to an account/,
    ],
    ["US-only page counts", /Counted only for visits from the United States/],
    ["page count retention from the constant", /kept 13 months/],
    ["the account funnel", /notes when your account first reaches a few steps/],
    ["what it never holds", /never records your notes or the people in them/],
    [
      "the same no-cookie, no-third-party boundary",
      /stays inside Tendnote: no cookie, no third party/,
    ],
    ["US-only collection", /Only for accounts in the United States/],
    ["retention from the constant", /Deleted after 90 days, or when you delete your account/],
    ["the opt-out setting", /Turn it off any time under Account, Analytics and error reports/],
  ])("states %s", (_name, pattern) => {
    expect(rendered).toMatch(pattern);
  });
});
