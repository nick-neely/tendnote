import type {
  CreatePersonInput,
  Followup,
  Memory,
  Person,
  PersonUpdateStatus,
  PersonUpdateSummary,
  PersonUpdateTarget,
  PersonUpdateUndoStatus,
  RelationshipType,
  SearchPeopleInput,
  SourceRecord,
  UpdatePersonInput,
} from "@tendnote/domain";

export type CreatePersonMutationInput = CreatePersonInput & { ownerUserId: string };

export type UpdatePersonMutationInput = UpdatePersonInput & {
  ownerUserId: string;
  personId: string;
};

export type DeletePersonMutationInput = {
  ownerUserId: string;
  personId: string;
};

export type DeleteCaptureOnlyPersonInput = DeletePersonMutationInput & {
  sourceRecordId: string;
};

/** Defined-only editable fields handed to the store (undefined keys are dropped). */
export type UpdatePersonPatch = Partial<
  Pick<
    Person,
    | "displayName"
    | "firstName"
    | "lastName"
    | "birthday"
    | "relationshipType"
    | "closenessLevel"
    | "profileBlurb"
  >
>;

export type SearchPeopleQueryInput = SearchPeopleInput & { ownerUserId: string };

export type GetPersonProfileInput = {
  ownerUserId: string;
  personId: string;
};

export type GetPersonInput = {
  ownerUserId: string;
  personId: string;
};

export type PersonProfile = {
  person: Person;
  memories: Memory[];
  followups: Followup[];
  sourceRecords: SourceRecord[];
};

/**
 * One count per person-detail tab. Each field is defined as exactly what its
 * tab label claims, so a badge can never disagree with the list underneath it:
 * `memories` counts *confirmed* memories (the ones `canUseMemoryProactively`
 * admits, which is what the Memories section renders), while suggestions still
 * waiting on the owner are counted separately under `review`.
 */
export type PersonDetailCounts = {
  /** Approved, non-restricted memories - the confirmed facts on the ledger. */
  memories: number;
  /** Suggested memories still waiting to be reviewed. */
  review: number;
  /** Follow-ups asking for something: active reminders plus tentative proposals. */
  followups: number;
  /** Drafts still in play - written or approved, not yet sent or dismissed. */
  drafts: number;
};

/**
 * The small, visible detail projection that can safely sit behind a route
 * cache. Unlike `PersonProfile`, it never materializes a person's ledgers.
 */
export type PersonDetailCore = {
  person: Person;
  counts: PersonDetailCounts;
};

export type PersistPersonInput = Omit<Person, "id" | "createdAt" | "updatedAt">;

export type SearchPeopleStoreInput = {
  ownerUserId: string;
  query?: string;
  relationshipType?: RelationshipType;
  limit: number;
};

export type PersonAuditLogEntry = {
  ownerUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
};

export type PersonUpdateResult = Person & { update?: PersonUpdateSummary | null };
export type UndoPersonUpdateInput = PersonUpdateTarget & { ownerUserId: string };
export type UndoPersonUpdateResult = { status: PersonUpdateUndoStatus };

export type PeopleStore = {
  getPersonUpdateStatus: (input: UndoPersonUpdateInput) => Promise<{ status: PersonUpdateStatus }>;
  getLatestPersonUpdate: (input: GetPersonInput) => Promise<PersonUpdateSummary | null>;
  undoPersonUpdate: (input: UndoPersonUpdateInput) => Promise<UndoPersonUpdateResult>;
  createPerson: (person: PersistPersonInput) => Promise<Person>;
  updatePerson: (input: {
    ownerUserId: string;
    personId: string;
    patch: UpdatePersonPatch;
  }) => Promise<PersonUpdateResult | null>;
  deletePerson: (input: { ownerUserId: string; personId: string }) => Promise<Person | null>;
  createAuditLogEntry: (auditLogEntry: PersonAuditLogEntry) => Promise<void>;
  searchPeople: (input: SearchPeopleStoreInput) => Promise<Person[]>;
  getPerson: (input: GetPersonInput) => Promise<Person | null>;
  getPersonDetailCore: (input: GetPersonProfileInput) => Promise<PersonDetailCore | null>;
  getPersonProfile: (input: GetPersonProfileInput) => Promise<PersonProfile | null>;
};
