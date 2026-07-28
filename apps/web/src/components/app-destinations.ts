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
} from "@/components/icons";

export type AppDestinationId =
  | "account"
  | "account-contact-import"
  | "account-discord"
  | "action-today"
  | "actions"
  | "asset"
  | "assets"
  | "people"
  | "person"
  | "reminder"
  | "review"
  | "saved-items"
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
    id: "account-contact-import",
    route: "/account/contacts/import",
    label: "Contact import",
    icon: CircleUserRoundIcon,
    groups: [],
    reserve: { heading: "Contact import", shape: "ledger" },
    scopes: [owner("account"), owner("people")],
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
  return pathname === "/" && searchParams.get("tab") === "review" ? "review" : "today";
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
