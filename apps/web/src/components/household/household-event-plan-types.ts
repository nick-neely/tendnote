import type {
  HouseholdEventPlan,
  HouseholdEventPlanLinkKind,
} from "@tendnote/domain/household-event-plans";
import type { HouseholdEventPlanResult } from "@/app/actions/household-event-plans";
import type {
  HouseholdEventPlanGroups,
  HouseholdEventPlanLinkCandidate,
  HouseholdEventPlanRecord,
} from "@/lib/household/household-event-plan-view";

export type HouseholdCalendarEventAddress = {
  connectionId: string;
  calendarId: string;
  providerEventId: string;
};

export type HouseholdEventPlanDraftInput = {
  title: string;
  details: string | null;
  plannedFor: string | null;
  calendarEvent: HouseholdCalendarEventAddress | null;
};

export type HouseholdEventPlanActions = {
  create?: (input: { draft: HouseholdEventPlanDraftInput }) => Promise<HouseholdEventPlanResult>;
  update?: (input: {
    planId: string;
    expectedVersion: number;
    draft: HouseholdEventPlanDraftInput;
  }) => Promise<HouseholdEventPlanResult>;
  archive?: (input: {
    planId: string;
    expectedVersion: number;
  }) => Promise<HouseholdEventPlanResult>;
  restore?: (input: {
    planId: string;
    expectedVersion: number;
  }) => Promise<HouseholdEventPlanResult>;
  link?: (input: {
    planId: string;
    linkKind: HouseholdEventPlanLinkKind;
    recordId: string;
  }) => Promise<HouseholdEventPlanResult>;
  unlink?: (input: { planId: string; linkId: string }) => Promise<HouseholdEventPlanResult>;
};

/**
 * One member's press of "Plan this event", handed across from the calendars.
 *
 * It carries the event's address and enough of its wording to show what the new
 * Plan is about. It deliberately does not seed the title: a Plan that opened
 * pre-filled with the provider's words would be a copy of the event on the day
 * it was made, which is the one thing a Plan must never be.
 */
export type PendingHouseholdCalendarEvent = {
  /** Bumped on every press, so pressing the same event again reopens the form. */
  nonce: number;
  calendarLabel: string;
  eventTitle: string;
  whenLabel: string;
  address: HouseholdCalendarEventAddress;
};

export type HouseholdEventPlansPanelProps = {
  groups: HouseholdEventPlanGroups;
  /** True when this household's Plans could not be read at all this time. */
  unavailable: boolean;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  /** The reader's own records, for the link picker on an active Plan. */
  linkCandidates: readonly HouseholdEventPlanLinkCandidate[];
  pendingCalendarEvent: PendingHouseholdCalendarEvent | null;
  actions?: HouseholdEventPlanActions;
  /** A whole refreshed list, after a write that landed. */
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  /** One Plan's current value, after a write that lost its fence. */
  onPlanRefreshed: (plan: HouseholdEventPlan) => void;
  onAnnounce: (message: string) => void;
};
