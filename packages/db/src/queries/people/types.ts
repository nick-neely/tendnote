import type {
  CreatePersonInput,
  Followup,
  Memory,
  Person,
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

export type PersonProfile = {
  person: Person;
  memories: Memory[];
  followups: Followup[];
  sourceRecords: SourceRecord[];
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

export type PeopleStore = {
  createPerson: (person: PersistPersonInput) => Promise<Person>;
  updatePerson: (input: {
    ownerUserId: string;
    personId: string;
    patch: UpdatePersonPatch;
  }) => Promise<Person | null>;
  createAuditLogEntry: (auditLogEntry: PersonAuditLogEntry) => Promise<void>;
  searchPeople: (input: SearchPeopleStoreInput) => Promise<Person[]>;
  getPersonProfile: (input: GetPersonProfileInput) => Promise<PersonProfile | null>;
};
