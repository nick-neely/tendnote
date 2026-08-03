import type {
  AcceptSuggestedContextFactInput,
  ArchiveContextFactInput,
  ArchiveSelfContextFactInput,
  ContextFact,
  ContextFactDeleteResult,
  ContextFactLifecycle,
  ContextFactMutationDecision,
  ContextFactReviewDismissResult,
  ContextFactView,
  CreateContextFactInput,
  CreateSelfContextFactInput,
  CreateSuggestedContextFactInput,
  CreateSuggestedSelfContextFactInput,
  DeleteSelfContextFactInput,
  DismissSuggestedContextFactInput,
  PersistContextFact,
  RestoreSelfContextFactInput,
  UpdateContextFactInput,
  UpdateSelfContextFactInput,
} from "@tendnote/domain";
import type { OrientationContextBuildResult } from "@tendnote/domain/context-fact-orientation";
import type { SelfContextCategory } from "@tendnote/domain/context-facts";
import type { MutationOutcome } from "../affected-scopes";
import type { HouseholdStore } from "../households/types";

export type { ContextFact, ContextFactView } from "@tendnote/domain";

export type ContextFactAuditLogEntry = {
  id: string;
  ownerUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
};

export type ContextFactAuditLogInput = Omit<ContextFactAuditLogEntry, "id" | "createdAt">;

type UnscopedContextFactFilter = {
  subjectUserId?: never;
  householdIds?: never;
  activeHouseholdMemberUserId?: never;
};

type SelfContextFactFilter = {
  subjectUserId: string;
  householdIds?: never;
  activeHouseholdMemberUserId?: never;
};

type HouseholdContextFactFilter = {
  subjectUserId?: string;
  householdIds: string[];
  /** Household rows always require a caller whose active membership is checked. */
  activeHouseholdMemberUserId: string;
};

export type ContextFactSubjectFilter =
  | UnscopedContextFactFilter
  | SelfContextFactFilter
  | HouseholdContextFactFilter;

export type ContextFactCreateInput = PersistContextFact & {
  /** Household creates lock and re-check this member row in the persistence transaction. */
  activeHouseholdMemberUserId?: string;
};

export type ContextFactUpdatePatch = Pick<
  ContextFact,
  | "category"
  | "content"
  | "sensitivity"
  | "lastActorUserId"
  | "updatedAt"
  | "lifecycle"
  | "archivedAt"
  | "reviewedAt"
  | "suggestionEvidence"
>;

export type ContextFactStore = {
  createContextFact: (input: ContextFactCreateInput) => Promise<ContextFact>;
  updateContextFact: (
    input: ContextFactSubjectFilter & {
      contextFactId: string;
      lifecycle?: ContextFactLifecycle;
      expectedUpdatedAt?: Date;
      expectedArchivedAt?: Date;
      patch: Partial<ContextFactUpdatePatch>;
    },
  ) => Promise<ContextFact | null>;
  deleteContextFact: (
    input: {
      contextFactId: string;
      lifecycle?: ContextFactLifecycle;
      expectedUpdatedAt?: Date;
      auditLogEntry?: ContextFactAuditLogInput;
    } & ContextFactSubjectFilter,
  ) => Promise<boolean>;
  getContextFact: (
    input: { contextFactId: string } & ContextFactSubjectFilter,
  ) => Promise<ContextFact | null>;
  listContextFacts: (
    input: ContextFactSubjectFilter & {
      lifecycle?: ContextFactLifecycle;
      lifecycles?: readonly ContextFactLifecycle[];
    },
  ) => Promise<ContextFact[]>;
  createAuditLogEntry: (input: ContextFactAuditLogInput) => Promise<ContextFactAuditLogEntry>;
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<ContextFactAuditLogEntry[]>;
};

export type ContextFactHouseholdAccess = Pick<
  HouseholdStore,
  "listActiveHouseholdMembershipsForUser" | "listHouseholdMemberships"
>;

/** Resolves the authenticated caller independently of request payload fields. */
export type ContextFactCallerVerification = () => Promise<string | null>;

export type ContextFactQueryDependencies = {
  householdAccess?: ContextFactHouseholdAccess;
  resolveVerifiedCaller?: ContextFactCallerVerification;
  /** Optional bounded queue policy used by ambient/background suggestion producers. */
  maxPendingSuggestedContextFacts?: number;
};

export type CreateContextFactMutationInput = CreateContextFactInput;
export type CreateSelfContextFactMutationInput = CreateSelfContextFactInput;
export type UpdateSelfContextFactMutationInput = UpdateSelfContextFactInput;
export type ArchiveSelfContextFactMutationInput = ArchiveSelfContextFactInput;
export type RestoreSelfContextFactMutationInput = RestoreSelfContextFactInput;
export type DeleteSelfContextFactMutationInput = DeleteSelfContextFactInput;
export type UpdateContextFactMutationInput = UpdateContextFactInput;
export type ArchiveContextFactMutationInput = ArchiveContextFactInput;

export type ListContextFactsInput = {
  callerUserId: string;
  /** Management reads include the caller's restricted facts; orientation reads do not. */
  includeRestricted?: boolean;
  /** Management reads may progressively disclose archived facts. */
  includeArchived?: boolean;
};

export type SearchSelfContextFactsInput = ListContextFactsInput & {
  query: string;
  /** Restricted facts are eligible only after Global Recall authorizes a direct request. */
  directlyRequested: boolean;
  limit: number;
};

export type SelfContextExactResult = {
  fact: Omit<ContextFact, "category"> & { category: SelfContextCategory };
  matchedFields: Array<"content" | "category">;
  rank: number;
};

export type GetOrientationContextInput = {
  callerUserId: string;
  /** Testable override; production uses the shared measured default. */
  maxBytes?: number;
};

export type OrientationContextResult = OrientationContextBuildResult;

export type GetContextFactInput = ListContextFactsInput & { contextFactId: string };

export type ContextFactMutationOutcome = MutationOutcome<ContextFactView> & {
  decision: ContextFactMutationDecision;
};

export type ContextFactDeleteMutationOutcome = MutationOutcome<ContextFactDeleteResult>;

export type ContextFactReviewMatch = {
  kind: "duplicate" | "conflict";
  fact: ContextFact;
};

export type SuggestedContextFactReviewResult = {
  fact: ContextFact;
  evidence: string;
  activeMatch: ContextFactReviewMatch | null;
};

export type SuggestedContextFactMutationOutcome =
  MutationOutcome<SuggestedContextFactReviewResult> & {
    decision: "created" | "existing";
  };

export type ContextFactReviewMutationOutcome = MutationOutcome<ContextFactView> & {
  decision: "accepted" | "existing";
};

export type ContextFactReviewDismissMutationOutcome =
  MutationOutcome<ContextFactReviewDismissResult>;

export type CreateSuggestedContextFactMutationInput = CreateSuggestedContextFactInput;
export type CreateSuggestedSelfContextFactMutationInput = CreateSuggestedSelfContextFactInput;
export type AcceptSuggestedContextFactMutationInput = AcceptSuggestedContextFactInput;
export type DismissSuggestedContextFactMutationInput = DismissSuggestedContextFactInput;
