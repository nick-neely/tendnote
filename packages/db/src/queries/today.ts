import { formatLocalDate } from "@tendnote/domain";
import { listAssetReviewGroups } from "./assets";
import { createDrizzleBriefScheduleStore } from "./brief-schedules/drizzle-store";
import { createDefaultGoogleCalendarReader, readConnectedOwnerCalendar } from "./calendar";
import { listCalendarSuggestedFollowups } from "./calendar-followups";
import { listActiveGeneralActions, listSuggestedGeneralActionReviews } from "./general-actions";
import { getRelationshipAgenda } from "./relationship-agenda";
import { listSavedItems } from "./saved-items";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";
import { createTodayCandidateLoaders } from "./today/candidate-loaders";
import { createDrizzleTodayFeedbackStore } from "./today/drizzle-store";
import { createAiSdkTodayRanker, hasTodayRankerCredentials } from "./today/ranker";
import { createTodayShortlistService } from "./today/service";

export { createTodayCandidateLoaders } from "./today/candidate-loaders";
export { createDrizzleTodayFeedbackStore } from "./today/drizzle-store";
export { createInMemoryTodayFeedbackStore } from "./today/in-memory-store";
export { createAiSdkTodayRanker, hasTodayRankerCredentials } from "./today/ranker";
export { createTodayShortlistService } from "./today/service";
export type * from "./today/types";

const sourceRecords = createDrizzleSourceRecordStore();
const briefScheduleStore = createDrizzleBriefScheduleStore();
const candidateLoaders = createTodayCandidateLoaders({
  loadRelationshipAgenda: getRelationshipAgenda,
  listActions: (input) => listActiveGeneralActions(input),
  listSavedItems: (input) => listSavedItems(input),
  getSourceRecord: (input) => sourceRecords.getSourceRecord(input),
  async readCalendar(input) {
    return readConnectedOwnerCalendar(
      {
        ownerUserId: input.ownerUserId,
        providerKey: "google",
        capabilityKey: "calendar",
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        maxResults: 20,
      },
      { reader: createDefaultGoogleCalendarReader() },
    );
  },
  async listAdditionalReviews(input) {
    const settled = await Promise.allSettled([
      listSuggestedGeneralActionReviews({ ownerUserId: input.ownerUserId, limit: input.limit }),
      listAssetReviewGroups({ ownerUserId: input.ownerUserId, limit: input.limit }),
      listCalendarSuggestedFollowups(input.ownerUserId),
    ]);
    const actionReviews = settled[0]?.status === "fulfilled" ? settled[0].value : [];
    const assetReviews = settled[1]?.status === "fulfilled" ? settled[1].value : [];
    const calendarReviews = settled[2]?.status === "fulfilled" ? settled[2].value : [];
    return [
      ...actionReviews.map((review) => ({
        id: `suggested-general-action:${review.action.id}`,
        title: `Review ${review.action.title}`,
        createdAt: review.action.createdAt,
        href: "/?tab=review",
        sourceRefs: [
          { kind: "general_action", id: review.action.id },
          ...(review.sourceRecord ? [{ kind: "source_record", id: review.sourceRecord.id }] : []),
        ],
        sensitivity: review.sourceRecord?.sensitivity ?? ("normal" as const),
      })),
      ...assetReviews.map((review) => ({
        id: `asset-review-group:${review.group.id}`,
        title: `Review ${review.asset.name}`,
        createdAt: review.group.createdAt,
        href: "/?tab=review",
        sourceRefs: [
          { kind: "asset_review_group", id: review.group.id },
          ...(review.sourceRecord ? [{ kind: "source_record", id: review.sourceRecord.id }] : []),
        ],
        sensitivity: review.sourceRecord?.sensitivity ?? ("normal" as const),
      })),
      ...calendarReviews.map((review) => ({
        id: `calendar-suggestion:${review.id}`,
        title: review.personDisplayName
          ? `Review follow-up for ${review.personDisplayName}`
          : "Review Calendar follow-up",
        createdAt: review.createdAt,
        href: "/?tab=review",
        sourceRefs: [
          { kind: "calendar_event", id: `${review.calendarId}:${review.providerEventId}` },
        ],
        sensitivity: "normal" as const,
      })),
    ];
  },
});

const defaultTodayService = createTodayShortlistService({
  feedbackStore: createDrizzleTodayFeedbackStore(),
  loadCandidateFamilies: candidateLoaders,
  rankOptional: hasTodayRankerCredentials() ? createAiSdkTodayRanker() : undefined,
});

export async function getOwnerTodayContext(input: { ownerUserId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const schedule = await briefScheduleStore.getBriefScheduleForOwner({
    ownerUserId: input.ownerUserId,
    cadence: "daily",
  });
  const timeZone = schedule?.timezone ?? process.env.TENDNOTE_OWNER_TIMEZONE ?? "UTC";
  return { localDate: formatLocalDate(timeZone, now), timeZone, now };
}

export function getTodayShortlist(input: {
  ownerUserId: string;
  localDate: string;
  timeZone?: string;
  now?: Date;
  forceRefresh?: boolean;
}) {
  return defaultTodayService.getTodayShortlist(input);
}

export function getTodayCandidate(input: {
  ownerUserId: string;
  localDate: string;
  timeZone?: string;
  candidateIdentity: string;
  reasonKey: string;
  now?: Date;
}) {
  return defaultTodayService.getTodayCandidate(input);
}

export function suppressTodayCandidate(input: {
  ownerUserId: string;
  localDate: string;
  timeZone?: string;
  candidateIdentity: string;
  reasonKey: string;
  kind: "later" | "not_today";
  suppressUntil: Date | null;
  now?: Date;
}) {
  return defaultTodayService.suppressTodayCandidate(input);
}

export function restoreTodayCandidate(input: {
  ownerUserId: string;
  localDate: string;
  candidateIdentity: string;
  reasonKey: string;
  kind: "later" | "not_today";
}) {
  return defaultTodayService.restoreTodayCandidate(input);
}
