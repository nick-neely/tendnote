import type { GuestLibrary } from "@tendnote/domain/guest-library";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  isCheckoutOpen: vi.fn(),
  readGuestLibrary: vi.fn(),
  orientationCookie: { value: undefined as string | undefined },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "tn_guest_oriented" && mocks.orientationCookie.value !== undefined
        ? { name, value: mocks.orientationCookie.value }
        : undefined,
  }),
}));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess: mocks.getCurrentAccess }));
vi.mock("@/lib/billing/checkout-availability", () => ({ isCheckoutOpen: mocks.isCheckoutOpen }));
vi.mock("@/lib/household/guest-library", () => ({ readGuestLibrary: mocks.readGuestLibrary }));
vi.mock("@/app/actions/guest-orientation", () => ({ finishGuestOrientationAction: vi.fn() }));
vi.mock("@/components/auth/auth-scaffold", () => ({
  AuthScaffold: ({ title, subtitle, children }: Record<string, React.ReactNode>) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </main>
  ),
}));
vi.mock("@/components/service-notice-banner", () => ({ ServiceNotice: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/auth/sign-out-button", () => ({ SignOutButton: () => <b>Sign out</b> }));
vi.mock("@/components/account/delete-account-button", () => ({
  DeleteAccountButton: () => <b>Delete account</b>,
}));

import GuestPage from "./page";

const user = { id: "guest-1", email: "guest@example.com", name: "Tilly" };

const library: GuestLibrary = {
  householdName: "The Reyes-Okonkwo household",
  shelves: [
    {
      domain: "people",
      unavailable: false,
      records: [
        {
          id: "adaeze",
          title: "Adaeze Okonkwo",
          context: "Household Owner",
          body: null,
          belongsTo: null,
          reason: "household_native",
          date: null,
        },
      ],
    },
    {
      domain: "memories",
      unavailable: false,
      records: [
        {
          id: "m1",
          title: "June is moving to a ground-floor flat in April",
          context: "About June Okonkwo",
          body: null,
          belongsTo: "Adaeze Okonkwo",
          reason: "shared_scope",
          date: new Date("2026-09-12T00:00:00Z"),
        },
      ],
    },
    ...(
      [
        "followUps",
        "generalActions",
        "assets",
        "giftPlans",
        "householdContext",
        "calendarEvents",
      ] as const
    ).map((domain) => ({ domain, records: [], unavailable: domain === "calendarEvents" })),
  ],
};

async function renderGuest(params: { shelf?: string; record?: string } = {}) {
  return renderToStaticMarkup(await GuestPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAccess.mockResolvedValue({ state: "guest", user, householdId: "household-1" });
  mocks.isCheckoutOpen.mockResolvedValue(true);
  mocks.readGuestLibrary.mockResolvedValue(library);
  mocks.orientationCookie.value = user.id;
});

describe("the guest orientation (#636)", () => {
  it("comes first, once: whose household, read-only, what they can and cannot see", async () => {
    mocks.orientationCookie.value = undefined;
    const html = await renderGuest();

    expect(html).toContain("You&#x27;re a guest of The Reyes-Okonkwo household");
    expect(html).toMatch(/You can read/);
    expect(html).toMatch(/You can&#x27;t change anything/);
    expect(html).toMatch(/Private records aren&#x27;t part of this view/);
    expect(html).toContain("Open the library");
    expect(html).not.toContain("June is moving");
  });

  it("is shown again to a different account on the same browser", async () => {
    mocks.orientationCookie.value = "someone-else";

    expect(await renderGuest()).toContain("Open the library");
  });
});

describe("the guest library (#636)", () => {
  it("names the household in a read-only band with the only Subscribe link", async () => {
    const html = await renderGuest();

    expect(html).toContain("Read-only.");
    expect(html).toContain("The Reyes-Okonkwo household");
    expect(html).toMatch(/belong to its members/);
    expect(html.match(/Subscribe/g)).toHaveLength(1);
    expect(html).toContain('href="/guest/subscribe"');
    expect(mocks.readGuestLibrary).toHaveBeenCalledWith(user.id);
  });

  it("shows every read-set shelf with its count, zero included, and says when one is unavailable", async () => {
    const html = await renderGuest();

    for (const label of [
      "People",
      "Memories",
      "Follow-ups",
      "Actions",
      "Assets",
      "Gift plans",
      "Household context",
      "Calendar",
    ]) {
      expect(html).toContain(`<span class="lg:flex-1">${label}</span>`);
    }
    expect(html).toContain("0</span>");
    expect(html).toContain("(unavailable)");
  });

  it("offers no paid or writing affordance, only the account's own exits", async () => {
    const html = await renderGuest({ shelf: "memories", record: "m1" });

    expect(html).not.toMatch(/\b(Eve|assistant|export|capture|remind\w*|edit|connect\w*)\b/i);
    expect(html).not.toMatch(/<form/);
    expect(html).toContain("Sign out");
    expect(html).toContain("Delete account");
  });

  it("states a record's owner, why it is visible, its date, and the read-only right", async () => {
    const html = await renderGuest({ shelf: "memories", record: "m1" });

    expect(html).toContain("June is moving to a ground-floor flat in April");
    expect(html).toContain("About June Okonkwo");
    expect(html).toContain("Belongs to");
    expect(html).toContain("Adaeze Okonkwo shared it with you.");
    expect(html).toContain("Sep 12, 2026");
    expect(html).toContain("Read only");
  });

  it("opens the shelf, not an error, for a record the guest cannot read", async () => {
    const html = await renderGuest({ shelf: "memories", record: "withheld" });

    expect(html).not.toContain("Belongs to");
    expect(html).toContain("Choose one to read it.");
  });

  it("hides Subscribe while Checkout is closed", async () => {
    mocks.isCheckoutOpen.mockResolvedValue(false);

    expect(await renderGuest()).not.toContain("Subscribe");
  });

  it("sends a guest whose membership just ended to the pending area", async () => {
    mocks.readGuestLibrary.mockResolvedValue(null);

    await expect(renderGuest()).rejects.toThrow("REDIRECT:/pending");
  });

  it.each([
    [{ state: "pending", user }, "/pending"],
    [{ state: "admitted", user, ownerUserId: user.id }, "/"],
    [{ state: "unauthenticated" }, "/sign-in"],
  ])("sends %o where it belongs", async (access, to) => {
    mocks.getCurrentAccess.mockResolvedValue(access);

    await expect(renderGuest()).rejects.toThrow(`REDIRECT:${to}`);
    expect(mocks.readGuestLibrary).not.toHaveBeenCalled();
  });
});
