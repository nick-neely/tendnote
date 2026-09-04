import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import type { ReminderRecordKind } from "@tendnote/domain/reminders";
import {
  BookmarkIcon,
  BookUserIcon,
  BoxIcon,
  CircleDotIcon,
  CircleUserRoundIcon,
  GiftIcon,
  HomeIcon,
  ListChecksIcon,
  NotebookPenIcon,
  UsersRoundIcon,
} from "@/components/icons";

export type AppDestinationId =
  | "account"
  | "account-about-you"
  | "account-about-you-import"
  | "account-contact-import"
  | "account-discord"
  | "account-household"
  | "account-household-context"
  | "onboarding-self-context"
  | "action-today"
  | "actions"
  | "asset"
  | "assets"
  | "assistant"
  | "gift-plan"
  | "gift-plans"
  | "household"
  | "people"
  | "person"
  | "reminder"
  | "review"
  | "saved-items"
  | "shared-record"
  | "today";

export type HomePanel = "review" | "today";
/**
 * Where a destination appears.
 *
 * `sidebar-primary` is the shell's standing rail: the destinations a member
 * moves between many times a day. `sidebar-secondary` is the quieter shelf at
 * the foot of the same rail - occasional destinations and the account - kept a
 * separate group rather than a position within one, so the split survives a
 * reordering. `menu` is the phone's Menu dialog, which is one flat list because
 * a full-screen sheet has the room the rail does not.
 */
export type DestinationGroup = "sidebar-primary" | "sidebar-secondary" | "menu";
export type DestinationReserveShape = "detail" | "ledger";

/**
 * Whether a destination exists for everyone, or only while the viewer holds a
 * standing that can end.
 *
 * One member of this union today, and the union rather than a boolean because
 * the question a gate asks is "which standing", not "gated or not" — a second
 * conditional destination would otherwise be tempted to reuse a field named for
 * households. Availability is decided from live state per request, never from a
 * role in a session or a value cached with the page.
 */
export type DestinationAvailability = "always" | "household-member";

/** The viewer standings navigation resolves before it renders a group. */
export type DestinationViewer = {
  householdMember?: boolean;
};

/**
 * The resolved form of {@link DestinationViewer}, streamed into the shell.
 *
 * Every standing is answered, so a navigation surface holding one of these is
 * never guessing. The shell passes it as a promise and each navigation region
 * unwraps it behind its own boundary, so resolving membership never delays the
 * destination the member is actually looking at.
 */
export type ViewerStandings = {
  householdMember: boolean;
};

/**
 * The standings a surface assumes when it has not been told any: none.
 *
 * A settled promise, and a module constant rather than a fresh one per render,
 * so `use` resolves on the first attempt instead of suspending navigation on
 * every pass. Assuming nothing is the fail-closed direction — a conditional
 * destination is missing rather than offered to someone who has lost it.
 */
export const NO_VIEWER_STANDINGS: ViewerStandings = { householdMember: false };
export const NO_VIEWER_STANDINGS_RESOLVED: Promise<ViewerStandings> =
  Promise.resolve(NO_VIEWER_STANDINGS);

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
  /** Defaults to `always`. See {@link DestinationAvailability}. */
  availability?: DestinationAvailability;
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
    groups: ["sidebar-primary"],
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
    /**
     * The Assistant as a destination rather than a column: the full-page
     * transcript with its own conversation list (ADR 0238).
     *
     * It sits beside Today because it is the other thing a member opens the app
     * to do. Today is what is waiting for you; the Assistant is where you write
     * something down or ask about someone, and on the dashboard the two are
     * already side by side. It owns no data collection of its own - threads are
     * titles over Eve sessions and every durable record a conversation produces
     * lives in the collection that owns it (ADR 0029) - so nothing here
     * invalidates on an assistant write.
     *
     * `/assistant/[sessionId]` deliberately has no row: `routeMatches` treats
     * `/assistant` as the parent of every thread URL, so one destination marks
     * the link current on both.
     */
    id: "assistant",
    route: "/assistant",
    label: "Assistant",
    icon: NotebookPenIcon,
    groups: ["sidebar-primary", "menu"],
    reserve: { heading: "Assistant", shape: "detail" },
    scopes: [],
  },
  {
    /**
     * The shared coordination surface: what we are jointly working on, as
     * against Today's what is relevant to me now.
     *
     * It sits near Today because those two are the same question asked of
     * two different subjects, and a member reads them together. Its own row
     * rather than a tab inside Today, because a collective "Household Today"
     * is precisely what the shared-home decision refuses.
     *
     * Available only while the viewer is an active Household Member. The
     * destination launches with Actions and Routines, the first domain to earn
     * a Phase Eight collaboration contract, and leaving or losing membership
     * removes it on the next request.
     */
    id: "household",
    route: "/household",
    label: "Household",
    icon: UsersRoundIcon,
    groups: ["sidebar-primary", "menu"],
    availability: "household-member",
    reserve: { heading: "Household", shape: "ledger" },
    scopes: [viewer("general-actions")],
  },
  {
    id: "people",
    route: "/people",
    label: "People",
    icon: BookUserIcon,
    groups: ["sidebar-primary", "menu"],
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
    groups: ["sidebar-primary", "menu"],
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
    groups: ["sidebar-primary", "menu"],
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
    id: "gift-plans",
    route: "/gift-plans",
    label: "Gift plans",
    icon: GiftIcon,
    /**
     * Secondary. Gift planning is occasional and deliberate — a few times a
     * year, not several times a day — so it sits on the rail's quiet shelf
     * rather than beside People, Today, and the Assistant.
     */
    groups: ["sidebar-secondary", "menu"],
    reserve: { heading: "Gift plans", shape: "ledger" },
    scopes: [owner("gift-plans"), viewer("gift-plans")],
  },
  {
    id: "gift-plan",
    route: "/gift-plans/[giftPlanId]",
    label: "Gift plan",
    icon: GiftIcon,
    groups: [],
    reserve: { heading: "Gift plan", shape: "detail" },
    scopes: [owner("gift-plans"), viewer("gift-plans")],
  },
  {
    id: "saved-items",
    route: "/saved-items",
    label: "Saved Items",
    icon: BookmarkIcon,
    groups: ["sidebar-primary", "menu"],
    reserve: { heading: "Saved Items", shape: "ledger" },
    scopes: [owner("saved-items"), viewer("saved-items")],
  },
  {
    id: "account",
    route: "/account",
    label: "Account",
    icon: CircleUserRoundIcon,
    /**
     * Secondary. Account is where a member goes to change something about the
     * app rather than to do the work the app is for, so it sits at the foot of
     * the rail with Gift plans instead of among the standing destinations.
     */
    groups: ["sidebar-secondary", "menu"],
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
    // Account owns who belongs to the workspace and how it is governed. The
    // global `household` row above is the working surface, not a relocation of
    // this one, so governance stays out of every navigation group and is reached
    // from Account or from the home's "Manage household" link.
    id: "account-household",
    route: "/account/household",
    label: "Household",
    icon: UsersRoundIcon,
    groups: [],
    reserve: { heading: "Household", shape: "ledger" },
    scopes: [owner("account")],
  },
  {
    // Household Context lives beneath Overview rather than becoming a fourth
    // durable Household destination, so it stays out of every group too.
    id: "account-household-context",
    route: "/account/household/context",
    label: "Household context",
    icon: UsersRoundIcon,
    groups: [],
    reserve: { heading: "Household context", shape: "ledger" },
    scopes: [owner("account"), owner("context-facts")],
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

/**
 * The destinations one navigation group shows this viewer.
 *
 * Availability is applied here rather than at each call site so the desktop
 * rail, the phone Menu, and the command palette cannot drift into offering
 * different sets. The viewer defaults to holding no standing: a caller that has
 * not resolved membership yet shows the destinations everyone has, which is the
 * fail-closed answer and the one a reserve should render.
 */
export function destinationsInGroup(
  group: DestinationGroup,
  viewer: DestinationViewer = {},
): AppDestination[] {
  return appDestinations.filter(
    (destination) =>
      destination.groups.some((candidate) => candidate === group) &&
      isDestinationAvailable(destination, viewer),
  );
}

function isDestinationAvailable(
  destination: Pick<AppDestination, "id" | "availability">,
  viewer: DestinationViewer,
): boolean {
  switch (destination.availability ?? "always") {
    case "always":
      return true;
    case "household-member":
      return viewer.householdMember === true;
  }
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
  viewer: DestinationViewer = {},
): boolean {
  const grouped = destinationsInGroup(group, viewer);
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
