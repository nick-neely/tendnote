import type {
  ConversationalCaptureClarification,
  ConversationalCaptureConfirmation,
  ConversationalCaptureRequest,
  FollowupStatus,
  GeneralActionRecurrence,
  GeneralActionStatus,
  SourceRecord,
} from "@tendnote/domain";
import type { SavedItemWithContext } from "../../saved-items/types";

export type ConversationalCaptureInput = ConversationalCaptureRequest;

export type ConversationalCaptureResult = {
  sourceRecord: SourceRecord;
  clarification?: ConversationalCaptureClarification;
  confirmation?: ConversationalCaptureConfirmation;
  savedItem?: SavedItemWithContext;
  generalAction?: CaptureGeneralAction;
  followup?: CaptureFollowup;
};

export type CaptureGeneralAction = {
  id: string;
  status: GeneralActionStatus;
  sourceRecordId?: string | null;
  recurrence?: GeneralActionRecurrence | null;
};

export type CaptureFollowup = {
  id: string;
  status: FollowupStatus;
  personId?: string;
  sourceRecordId?: string | null;
};

export type ResolvedCapturePerson = { id: string; displayName: string };

export type ConversationalCaptureDeps = {
  createGeneralAction?: (input: {
    id: string;
    ownerUserId: string;
    title: string;
    dueAt: Date | null;
    recurrence: GeneralActionRecurrence | null;
    sourceRecordId: string;
    scope: "private";
  }) => Promise<CaptureGeneralAction>;
  getGeneralAction?: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<CaptureGeneralAction | null>;
  editGeneralAction?: (input: {
    actorUserId: string;
    generalActionId: string;
    edit: {
      title: string;
      dueAt?: Date | null;
      recurrence?: GeneralActionRecurrence | null;
    };
  }) => Promise<CaptureGeneralAction>;
  archiveGeneralAction?: (input: {
    actorUserId: string;
    generalActionId: string;
  }) => Promise<CaptureGeneralAction>;
  createFollowup?: (input: {
    id: string;
    ownerUserId: string;
    personId: string;
    reason: string;
    dueAt: Date;
    sourceRecordId: string;
    scope: "private";
  }) => Promise<CaptureFollowup>;
  getFollowup?: (input: {
    ownerUserId: string;
    followupId: string;
  }) => Promise<CaptureFollowup | null>;
  editFollowup?: (input: {
    actorUserId: string;
    followupId: string;
    edit: { reason: string; dueAt?: Date };
  }) => Promise<CaptureFollowup>;
  archiveFollowup?: (input: {
    actorUserId: string;
    followupId: string;
  }) => Promise<CaptureFollowup>;
  searchPeople?: (input: {
    ownerUserId: string;
    query: string;
    limit: number;
  }) => Promise<ResolvedCapturePerson[]>;
  now?: () => Date;
  ownerTimeZone?: (ownerUserId: string) => string | Promise<string>;
};
