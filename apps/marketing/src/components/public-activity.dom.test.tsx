// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoStory } from "./demo/demo-story";
import { PublicActivity } from "./public-activity";

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/" } }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

const ENDPOINT = "https://app.tendnote.test/api/public-activity";
const SIGNUP = "https://app.tendnote.test/sign-up";

const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response(null));

/** Every report sent, as the event and page it named. */
function reported() {
  return fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
}

function visit(
  path: string,
  children: React.ReactNode = null,
  { endpoint }: { endpoint: string | undefined } = { endpoint: ENDPOINT },
) {
  pathname.current = path;
  window.history.replaceState(null, "", path);
  return render(
    <PublicActivity endpoint={endpoint} signupHref={SIGNUP}>
      {children}
    </PublicActivity>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

describe("PublicActivity", () => {
  it("reports a page view by its fixed name", () => {
    visit("/privacy-and-ai");

    expect(reported()).toEqual([{ event: "page_viewed", page: "privacy_and_ai" }]);
  });

  it("sends no cookie, no referrer, and nothing else about the visit", () => {
    visit("/pricing");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    });
    expect(init?.headers).toBeUndefined();
    expect(Object.keys(JSON.parse(String(init?.body)))).toEqual(["event", "page"]);
  });

  it("counts each arrival once, and a new page as a new view", () => {
    const { rerender } = visit("/");
    rerender(
      <PublicActivity endpoint={ENDPOINT} signupHref={SIGNUP}>
        {null}
      </PublicActivity>,
    );
    pathname.current = "/product";
    rerender(
      <PublicActivity endpoint={ENDPOINT} signupHref={SIGNUP}>
        {null}
      </PublicActivity>,
    );

    expect(reported()).toEqual([
      { event: "page_viewed", page: "home" },
      { event: "page_viewed", page: "product" },
    ]);
  });

  it("never counts a path that is not an approved page", () => {
    visit("/no-such-page");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports nothing without an endpoint", async () => {
    visit("/pricing", <a href={SIGNUP}>Subscribe</a>, { endpoint: undefined });
    await userEvent.setup().click(screen.getByRole("link", { name: "Subscribe" }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a signup click on the page it came from, and no other link", async () => {
    const user = userEvent.setup();
    visit(
      "/pricing",
      <>
        <a href={SIGNUP}>
          <span>Subscribe</span>
        </a>
        <a href="https://app.tendnote.test/sign-in">Sign in</a>
      </>,
    );
    fetchSpy.mockClear();

    for (const link of screen.getAllByRole("link")) {
      // Keep jsdom from attempting the cross-origin navigation.
      link.addEventListener("click", (event) => event.preventDefault());
    }
    await user.click(screen.getByText("Subscribe"));
    await user.click(screen.getByRole("link", { name: "Sign in" }));

    expect(reported()).toEqual([{ event: "signup_clicked", page: "pricing" }]);
  });

  it("reports the demo starting and completing, and nothing in between", async () => {
    const user = userEvent.setup();
    visit("/demo", <DemoStory />);
    fetchSpy.mockClear();

    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: "Approve suggestion for Sam Rivera" }));
    await user.click(screen.getByRole("radio", { name: "Saturday" }));
    await user.click(
      screen.getByRole("button", { name: "Accept suggested follow-up for Sam Rivera" }),
    );
    await user.click(screen.getByRole("button", { name: "What was Sam nervous about?" }));
    expect(reported()).toEqual([{ event: "demo_started", page: "demo" }]);

    await user.click(screen.getByRole("button", { name: "Skip ahead to Saturday" }));
    expect(reported()).toEqual([
      { event: "demo_started", page: "demo" },
      { event: "demo_completed", page: "demo" },
    ]);
  });
});
