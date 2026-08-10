import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import type { ReminderRecordKind } from "@tendnote/domain/reminders";
import {
  BookmarkIcon,
  BookUserIcon,
  BoxIcon,
  CircleDotIcon,
  CircleUserRoundIcon,
  HomeIcon,
  ListChecksIcon,
  UsersRoundIcon,
} from "@/components/icons";

export type AppDestinationId =
  | "account"
  | "account-about-you"
  | "account-about-you-import"
  | "account-contact-import"
  | "account-discord"
  | "account-household"
  | "onboarding-self-context"
  | "action-today"
  | "actions"
  | "asset"
  | "assets"
  | "people"
  | "person"
  | "reminder"
  | "review"
  | "saved-items"
  | "shared-record"
  | "today";

export type HomePanel = "review" | "today";
export type DestinationGroup = "desktop-primary" | "menu";
export type DestinationReserveShape = "detail" | "ledger";

type DestinationScope =
  | {
      kind: "owner-collection";
      collection: Extract<AffectedScope, { kind: "owner-collection" }>["collection"];
    }
  | {
      kind: "viewer-collection";
      collection: Extract<AffectedScope, { kind: "viewer-collection" }>["collection"];
    };

export type AppDestination = {
  id: AppDestinationId;
  route: string;
  label: string;
  icon: typeof HomeIcon;
  groups: readonly DestinationGroup[];
  reserve: {
    heading: string;
    shape: DestinationReserveShape;
  };
  scopes: readonly DestinationScope[];
};

const owner = (
  collection: Extract<AffectedScope, { kind: "owner-collection" }>["collection"],
): DestinationScope => ({ kind: "owner-collection", collection });
const viewer = (
  collection: Extract<AffectedScope, { kind: "viewer-collection" }>["collection"],
): DestinationScope => ({ kind: "viewer-collection", collection });

/**
 * The admitted destination table.
 *
 * Navigation, reserves, route headings, cache scope discovery and deep links
 * all resolve through this table. Groups are explicit: no caller relies on a
 * row's position to decide that Today belongs in primary navigation but not Menu.
 */
export const appDestinations = [
  {
    id: "today",
    route: "/",
    label: "Today",
    icon: HomeIcon,
    groups: ["desktop-primary"],
    reserve: { heading: "Today", shape: "ledger" },
    scopes: [owner("today"), owner("briefs")],
  },
  {
    id: "review",
    route: "/?tab=review",
    label: "Review",
    icon: ListChecksIcon,
    groups: [],
    reserve: { heading: "Review", shape: "ledger" },
    scopes: [owner("review")],
  },
  {
    id: "people",
    route: "/people",
    label: "People",
    icon: BookUserIcon,
    groups: ["desktop-primary", "menu"],
    reserve: { heading: "People", shape: "ledger" },
    scopes: [owner("people")],
  },
  {
    id: "person",
    route: "/people/[personId]",
    label: "Person",
    icon: BookUserIcon,
    groups: [],
    reserve: { heading: "Person", shape: "detail" },
    scopes: [owner("people")],
  },
  {
    id: "actions",
    route: "/actions",
    label: "Actions",
    icon: CircleDotIcon,
    groups: ["desktop-primary", "menu"],
    reserve: { heading: "Actions", shape: "ledger" },
    scopes: [viewer("general-actions")],
  },
  {
    id: "action-today",
    route: "/actions/today",
    label: "Today",
    icon: CircleDotIcon,
    groups: [],
    reserve: { heading: "Today", shape: "ledger" },
    scopes: [viewer("general-actions"), owner("today")],
  },
  {
    id: "assets",
    route: "/assets",
    label: "Assets",
    icon: BoxIcon,
    groups: ["desktop-primary", "menu"],
    reserve: { heading: "Assets", shape: "ledger" },
    scopes: [owner("assets")],
  },
  {
    id: "asset",
    route: "/assets/[assetId]",
    label: "Asset",
    icon: BoxIcon,
    groups: [],
    reserve: { heading: "Asset", shape: "detail" },
    scopes: [owner("assets")],
  },
  {
    id: "saved-items",
    route: "/saved-items",
    label: "Saved Items",
    icon: BookmarkIcon,
    groups: ["desktop-primary", "menu"],
    reserve: { heading: "Saved Items", shape: "ledger" },
    scopes: [owner("saved-items"), viewer("saved-items")],
  },
  {
    id: "account",
    route: "/account",
    label: "Account",
    icon: CircleUserRoundIcon,
    groups: ["desktop-primary", "menu"],
    reserve: { heading: "Account", shape: "ledger" },
    scopes: [owner("account")],
  },
  {
    id: "account-about-you",
    route: "/account/about-you",
    label: "About you",
    icon: CircleUserRoundIcon,
    groups: [],
    reserve: { heading: "About you", shape: "ledger" },
    scopes: [owner("account"), owner("context-facts")],
  },
  {
    id: "account-about-you-import",
    route: "/account/about-you/import",
    label: "Import from an assistant",
    icon: CircleUserRoundIcon,
    groups: [],
    reserve: { heading: "Import from an assistant", shape: "ledger" },
    scopes: [owner("account"), owner("context-facts")],
  },
  {
    id: "account-contact-import",
    route: "/account/contacts/import",
    label: "Contact import",
    icon: CircleUserRoundIcon,
    groups: [],
    reserve: { heading: "Contact import", shape: "ledger" },
    scopes: [owner("account"), owner("people")],
  },
  {
    // Account owns the durable Household entry and return point; there is no
    // top-level Household destination, so this row stays out of every group.
    id: "account-household",
    route: "/account/household",
    label: "Household",
    icon: UsersRoundIcon,
    groups: [],
    reserve: { heading: "Household", shape: "ledger" },
    scopes: [owner("account")],
  },
  {
    id: "account-discord",
    route: "/account/discord",
    label: "Discord delivery",
    icon: CircleUserRoundIcon,
    groups: [],
    reserve: { heading: "Discord delivery", shape: "ledger" },
    scopes: [owner("account")],
  },
  {
    id: "onboarding-self-context",
    route: "/onboarding/self-context",
    label: "Self Context setup",
    icon: CircleUserRoundIcon,
    groups: [],
    reserve: { heading: "Self Context setup", shape: "detail" },
    scopes: [owner("account"), owner("context-facts")],
  },
  {
    /**
     * A single relationship record another member shared. It is deliberately
     * not in any navigation group and belongs to no collection: there is no
     * browsable set of other people's shared records, only the one record a
     * direct request names (ADR 0218).
     */
    id: "shared-record",
    route: "/shared/[recordKind]/[recordId]",
    label: "Shared with you",
    icon: UsersRoundIcon,
    groups: [],
    reserve: { heading: "Shared with you", shape: "detail" },
    scopes: [],
  },
  {
    id: "reminder",
    route: "/reminders/open",
    label: "Reminder",
    icon: CircleDotIcon,
    groups: [],
    reserve: { heading: "Reminder", shape: "detail" },
    scopes: [owner("account"), owner("today")],
  },
] as const satisfies readonly AppDestination[];

const destinationById = new Map(
  appDestinations.map((destination) => [destination.id, destination]),
);

export function appDestination(id: AppDestinationId): AppDestination {
  const destination = destinationById.get(id);
  if (!destination) throw new Error(`Unknown app destination: ${id}`);
  return destination;
}

export function destinationsInGroup(group: DestinationGroup): AppDestination[] {
  return appDestinations.filter((destination) =>
    destination.groups.some((candidate) => candidate === group),
  );
}

type SearchParamsReader = Pick<URLSearchParams, "get">;

export function homePanelForLocation(
  pathname: string,
  searchParams: SearchParamsReader,
): HomePanel {
  return explicitHomePanelForLocation(pathname, searchParams) ?? "today";
}

/**
 * The Home panel the URL actually names, or null when it names none.
 *
 * `homePanelForLocation` answers "which panel does this URL show", and Today is
 * the right answer there. A caller that has its own default (the rail, which
 * opens on whichever panel holds something) needs the narrower question, so that
 * a bare `/` does not read as an instruction to show Today.
 *
 * `?tab=today` names Today as plainly as `?tab=review` names Review, so it is
 * honored: only a URL carrying no panel at all falls through to the caller's
 * content-aware default.
 */
export function explicitHomePanelForLocation(
  pathname: string,
  searchParams: SearchParamsReader,
): HomePanel | null {
  if (pathname !== "/") return null;
  const tab = searchParams.get("tab");
  return tab === "review" || tab === "today" ? tab : null;
}

function routeMatches(route: string, pathname: string): boolean {
  const pattern = route.split("?")[0] ?? route;
  if (pattern.includes("[personId]")) return /^\/people\/[^/]+$/.test(pathname);
  if (pattern.includes("[assetId]")) return /^\/assets\/[^/]+$/.test(pathname);
  if (pattern === "/") return pathname === "/";
  return pathname === pattern || pathname.startsWith(`${pattern}/`);
}

export function isDestinationActive(
  id: AppDestinationId,
  pathname: string,
  searchParams: SearchParamsReader,
): boolean {
  if (id === "today" || id === "review") {
    return pathname === "/" && homePanelForLocation(pathname, searchParams) === id;
  }
  const destination = appDestination(id);
  if (!routeMatches(destination.route, pathname)) return false;
  const moreSpecific = appDestinations.some(
    (candidate) =>
      candidate.id !== id &&
      candidate.route.length > destination.route.length &&
      routeMatches(candidate.route, pathname),
  );
  return !moreSpecific;
}

/**
 * Marks one current link within a navigation group. Detail destinations and
 * mobile-only Home panels roll up to their nearest visible parent, so desktop
 * navigation still communicates location without duplicating every route.
 */
export function isDestinationCurrentInGroup(
  id: AppDestinationId,
  group: DestinationGroup,
  pathname: string,
  searchParams: SearchParamsReader,
): boolean {
  const grouped = destinationsInGroup(group);
  const exact = appDestinations.find((candidate) =>
    isDestinationActive(candidate.id, pathname, searchParams),
  );
  if (exact?.groups.some((candidate) => candidate === group)) return exact.id === id;

  const nearestParent = grouped
    .filter((candidate) => routeMatches(candidate.route, pathname))
    .sort((left, right) => right.route.length - left.route.length)[0];
  return nearestParent?.id === id;
}

export function affectedScopesForDestination(
  id: AppDestinationId,
  ownerUserId: string,
): AffectedScope[] {
  return appDestination(id).scopes.map((scope) =>
    scope.kind === "owner-collection"
      ? { ...scope, ownerUserId }
      : { ...scope, viewerUserId: ownerUserId },
  );
}

export type ReminderDeepLinkTarget = {
  recordKind: ReminderRecordKind;
  recordId: string;
  personId?: string | null;
};

export function reminderRecordDeepLink(target: ReminderDeepLinkTarget): string | null {
  const id = encodeURIComponent(target.recordId);
  if (target.recordKind === "follow_up") {
    return target.personId
      ? `${appDestination("people").route}/${encodeURIComponent(target.personId)}#followup-${id}`
      : null;
  }
  if (target.recordKind === "saved_item") {
    return `${appDestination("saved-items").route}#saved-item-${id}`;
  }
  return `${appDestination("actions").route}#action-${id}`;
}

export function reminderOpenDeepLink(recordKind: ReminderRecordKind, recordId: string): string {
  const route = appDestination("reminder").route;
  return `${route}?kind=${encodeURIComponent(recordKind)}&id=${encodeURIComponent(recordId)}`;
}

export const serviceWorkerDestinationConfig = {
  notificationFallback: appDestination("actions").route,
} as const;
