import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmittedOwner, resolveBetterAuthBaseUrl, unstable_rethrow } = vi.hoisted(() => ({
  requireAdmittedOwner: vi.fn(),
  resolveBetterAuthBaseUrl: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@tendnote/auth", () => ({ resolveBetterAuthBaseUrl }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("next/navigation", () => ({ unstable_rethrow }));
vi.mock("@/components/account/context-fact-import-surface", () => ({
  ContextFactImportSurface: ({
    backHref,
    backLabel,
    options,
    prompt,
  }: {
    backHref: string;
    backLabel: string;
    options: { id: string; href: string; prefilled: boolean }[];
    prompt: string;
  }) => (
    <div data-testid="import-surface">
      <span data-back={backHref}>{backLabel}</span>
      {options.map((option) => (
        <span key={option.id}>{`${option.id}|${option.prefilled}|${option.href}`}</span>
      ))}
      <pre>{prompt}</pre>
    </div>
  ),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { RouteReserve } from "@/components/route-reserve";
import { ContextFactImportContent } from "./page";

async function renderRoute(searchParams: { from?: string } = {}) {
  return renderToStaticMarkup(
    await ContextFactImportContent({ searchParams: Promise.resolve(searchParams) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwner.mockResolvedValue("owner-1");
  resolveBetterAuthBaseUrl.mockReturnValue("https://tendnote.test");
});

describe("Self Context import route", () => {
  it("has a truthful loading reserve for the destination", () => {
    expect(renderToStaticMarkup(<RouteReserve destination="account-about-you-import" />)).toContain(
      "Import from an assistant",
    );
  });

  it("admits the owner with an exact return before building anything", async () => {
    await renderRoute();

    expect(requireAdmittedOwner).toHaveBeenCalledWith({ returnTo: "/account/about-you/import" });
  });

  it("points the assistant at this page on the canonical public origin", async () => {
    const markup = await renderRoute();

    expect(markup).toContain("https://tendnote.test/account/about-you/import");
  });

  it("prefills only the provider that reads a prompt parameter", async () => {
    const markup = await renderRoute();

    expect(markup).toMatch(/chatgpt\|true\|https:\/\/chatgpt\.com\/\?q=\S+/);
    expect(markup).toContain("claude|false|https://claude.ai/new");
    expect(markup).toContain("gemini|false|https://gemini.google.com/app");
  });

  it("returns to About you by default", async () => {
    expect(await renderRoute()).toContain('data-back="/account/about-you"');
  });

  it("returns to setup when the offer came from onboarding", async () => {
    const markup = await renderRoute({ from: "onboarding" });

    expect(markup).toContain('data-back="/onboarding/self-context"');
    expect(markup).toContain("Back to setup");
  });

  it("keeps the onboarding return on the link the assistant echoes back", async () => {
    // The owner may follow that link hours later. Dropping `from` would land them
    // on the import page with the wrong way out of it.
    const markup = await renderRoute({ from: "onboarding" });

    expect(markup).toContain("https://tendnote.test/account/about-you/import?from=onboarding");
  });

  it("ignores a return target it does not own", async () => {
    // `from` is a closed enum, so a crafted value cannot turn this page — which
    // opens external tabs — into an open redirect.
    const markup = await renderRoute({ from: "https://evil.test" });

    expect(markup).toContain('data-back="/account/about-you"');
    expect(markup).not.toContain("evil.test");
  });

  it("degrades to a calm unavailable state rather than a crash", async () => {
    resolveBetterAuthBaseUrl.mockImplementation(() => {
      throw new Error("BETTER_AUTH_URL is required in production.");
    });

    const markup = await renderRoute();

    expect(markup).toContain("Import is temporarily unavailable.");
    expect(markup).toContain("Your existing facts are unchanged.");
  });
});
