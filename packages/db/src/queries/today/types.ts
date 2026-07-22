import type { TodayCandidate, TodayFeedback, TodayShortlistResponse } from "@tendnote/domain";

export type TodayFeedbackRecord = TodayFeedback & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TodayFeedbackAuditEntry = {
  ownerUserId: string;
  action: "today.feedback_saved";
  entityType: "today_candidate";
  entityId: string;
  metadataJson: {
    kind: TodayFeedback["kind"];
    reasonKey: string;
    localDate: string;
    suppressUntil: string | null;
  };
};

export type TodayFeedbackStore = {
  listFeedback: (input: { ownerUserId: string }) => Promise<TodayFeedbackRecord[]>;
  saveFeedback: (input: TodayFeedback) => Promise<TodayFeedbackRecord>;
};

export type TodayCandidateLoader = (input: {
  ownerUserId: string;
  localDate: string;
  timeZone: string;
  now: Date;
}) => Promise<TodayCandidate[]>;

export type TodayOptionalRanker = (input: {
  ownerUserId: string;
  localDate: string;
  candidates: TodayCandidate[];
}) => Promise<{
  orderedIdentities: string[];
}>;

export type { TodayShortlistResponse };
