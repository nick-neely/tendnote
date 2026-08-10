import { describe, expect, it } from "vitest";
import {
  affectedScopesForDestination,
  appDestination,
  appDestinations,
  destinationsInGroup,
  explicitHomePanelForLocation,
  homePanelForLocation,
  isDestinationActive,
  isDestinationCurrentInGroup,
  reminderOpenDeepLink,
  reminderRecordDeepLink,
  serviceWorkerDestinationConfig,
} from "./app-destinations";

describe("app destinations", () => {
  it("uses explicit navigation groups instead of positional row meaning", () => {
    expect(destinationsInGroup("desktop-primary").map(({ id }) => id)).toEqual([
      "today",
      "people",
      "actions",
      "assets",
      "saved-items",
      "account",
    ]);
    expect(destinationsInGroup("menu").map(({ id }) => id)).toEqual([
      "people",
      "actions",
      "assets",
      // Occasional and deliberate: in the menu, deliberately not in the rail.
      "gift-plans",
      "saved-items",
      "account",
    ]);
  });

  it("adds the shared coordination destination for an active household member", () => {
    const viewer = { householdMember: true };

    expect(destinationsInGroup("desktop-primary", viewer).map(({ id }) => id)).toEqual([
      "today",
      // Beside Today: the same question, asked of the household.
      "household",
      "people",
      "actions",
      "assets",
      "saved-items",
      "account",
    ]);
    expect(destinationsInGroup("menu", viewer).map(({ id }) => id)).toEqual([
      "household",
      "people",
      "actions",
      "assets",
      "gift-plans",
      "saved-items",
      "account",
    ]);
  });

  it("keeps household governance out of navigation, where Account owns it", () => {
    for (const group of ["desktop-primary", "menu"] as const) {
      const ids = destinationsInGroup(group, { householdMember: true }).map(({ id }) => id);
      expect(ids).not.toContain("account-household");
      expect(ids).not.toContain("account-household-context");
    }
  });

  it("marks the Household link current on its own route without claiming Account's", () => {
    const viewer = { householdMember: true };
    const none = new URLSearchParams();

    expect(
      isDestinationCurrentInGroup("household", "desktop-primary", "/household", none, viewer),
    ).toBe(true);
    expect(
      isDestinationCurrentInGroup(
        "household",
        "desktop-primary",
        "/account/household",
        none,
        viewer,
      ),
    ).toBe(false);
    expect(
      isDestinationCurrentInGroup("account", "desktop-primary", "/account/household", none, viewer),
    ).toBe(true);
  });

  it("structurally keeps each Shaped Reserve heading aligned with its destination", () => {
    for (const destination of appDestinations) {
      expect(destination.reserve.heading).toBe(destination.label);
    }
  });

  /**
   * The narrow question the rail asks: only a URL carrying no panel falls
   * through to the content-aware default, so a link naming Today is obeyed
   * rather than silently treated as a bare `/`.
   */
  it("names the panel the URL asks for, and only then", () => {
    expect(explicitHomePanelForLocation("/", new URLSearchParams("tab=today"))).toBe("today");
    expect(explicitHomePanelForLocation("/", new URLSearchParams("tab=review"))).toBe("review");
    expect(explicitHomePanelForLocation("/", new URLSearchParams())).toBeNull();
    expect(explicitHomePanelForLocation("/", new URLSearchParams("tab=people"))).toBeNull();
    expect(explicitHomePanelForLocation("/people", new URLSearchParams("tab=today"))).toBeNull();
  });

  it("derives Home panel and active destination from one location resolver", () => {
    expect(homePanelForLocation("/", new URLSearchParams())).toBe("today");
    expect(homePanelForLocation("/", new URLSearchParams("tab=review"))).toBe("review");
    expect(isDestinationActive("today", "/", new URLSearchParams())).toBe(true);
    expect(isDestinationActive("today", "/", new URLSearchParams("tab=review"))).toBe(false);
    expect(isDestinationActive("review", "/", new URLSearchParams("tab=review"))).toBe(true);
    expect(isDestinationActive("people", "/people/person-1", new URLSearchParams())).toBe(false);
    expect(isDestinationActive("person", "/people/person-1", new URLSearchParams())).toBe(true);
    expect(
      isDestinationCurrentInGroup(
        "people",
        "desktop-primary",
        "/people/person-1",
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      isDestinationCurrentInGroup(
        "today",
        "desktop-primary",
        "/",
        new URLSearchParams("tab=review"),
      ),
    ).toBe(true);
  });

  it("answers affected data scopes for a destination", () => {
    expect(affectedScopesForDestination("review", "owner-1")).toEqual([
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
    ]);
    expect(affectedScopesForDestination("actions", "owner-1")).toEqual([
      { kind: "viewer-collection", collection: "general-actions", viewerUserId: "owner-1" },
    ]);
  });

  it("keeps About you focused beneath Account without adding it to primary navigation", () => {
    expect(appDestination("account-about-you")).toMatchObject({
      route: "/account/about-you",
      label: "About you",
      groups: [],
    });
    expect(affectedScopesForDestination("account-about-you", "owner-1")).toEqual([
      { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "context-facts", ownerUserId: "owner-1" },
    ]);
    expect(isDestinationActive("account", "/account/about-you", new URLSearchParams())).toBe(false);
    expect(
      isDestinationActive("account-about-you", "/account/about-you", new URLSearchParams()),
    ).toBe(true);
  });

  it("builds reminder record, notification and service-worker fallback links", () => {
    expect(
      reminderRecordDeepLink({
        recordKind: "follow_up",
        recordId: "follow-up",
        personId: "person",
      }),
    ).toBe("/people/person#followup-follow-up");
    expect(reminderRecordDeepLink({ recordKind: "general_action", recordId: "action" })).toBe(
      "/actions#action-action",
    );
    expect(reminderRecordDeepLink({ recordKind: "saved_item", recordId: "saved" })).toBe(
      "/saved-items#saved-item-saved",
    );
    expect(reminderOpenDeepLink("routine", "record")).toBe(
      "/reminders/open?kind=routine&id=record",
    );
    expect(serviceWorkerDestinationConfig.notificationFallback).toBe(
      appDestination("actions").route,
    );
  });
});
