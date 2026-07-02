/**
 * A person's saved email contact method, minimized to what the Gmail draft
 * recipient picker needs (Phase 2D, ADR-0085). Reading a saved method never
 * mutates it, and a manually entered recipient is never turned into one of these.
 */
export type PersonEmailContactMethod = {
  id: string;
  /** Canonical sendable address used by Gmail draft approval and matching. */
  value: string;
  /** Human-readable provider/user formatting, when different from `value`. */
  displayValue?: string | null;
  normalizedValue?: string | null;
  isPrimary: boolean;
};

export type ContactMethodDuplicateLookupInput = {
  ownerUserId: string;
  methods: Array<{
    type: "email" | "phone";
    value: string;
    normalizedValue: string | null;
  }>;
};

export type ContactMethodDuplicateMatch = {
  id: string;
  personId: string;
  type: "email" | "phone";
  value: string;
  displayValue: string | null;
  normalizedValue: string | null;
};

export type CreateContactMethodInput = {
  ownerUserId: string;
  personId: string;
  type: "email" | "phone";
  value: string;
  displayValue: string | null;
  normalizedValue: string | null;
  isPrimary?: boolean;
  source?: "manual" | "agent" | "contact_import" | "calendar" | "gmail" | "seed";
};

export type ContactMethodStore = {
  /** An owner's saved email contact methods for a person, primary first. */
  listPersonEmailContactMethods: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<PersonEmailContactMethod[]>;

  /** Owner-wide duplicate lookup for Contacts import matching and conflict flags. */
  findOwnerContactMethodDuplicates: (
    input: ContactMethodDuplicateLookupInput,
  ) => Promise<ContactMethodDuplicateMatch[]>;

  createContactMethod: (input: CreateContactMethodInput) => Promise<ContactMethodDuplicateMatch>;
};

export function toPersonEmailContactMethod(row: {
  id: string;
  value: string;
  displayValue?: string | null;
  normalizedValue?: string | null;
  isPrimary: boolean;
}): PersonEmailContactMethod {
  return {
    id: row.id,
    value: row.value,
    displayValue: row.displayValue ?? row.value,
    normalizedValue: row.normalizedValue ?? null,
    isPrimary: row.isPrimary,
  };
}
