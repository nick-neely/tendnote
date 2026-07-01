/**
 * A person's saved email contact method, minimized to what the Gmail draft
 * recipient picker needs (Phase 2D, ADR-0085). Reading a saved method never
 * mutates it, and a manually entered recipient is never turned into one of these.
 */
export type PersonEmailContactMethod = {
  id: string;
  value: string;
  isPrimary: boolean;
};

export type ContactMethodStore = {
  /** An owner's saved email contact methods for a person, primary first. */
  listPersonEmailContactMethods: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<PersonEmailContactMethod[]>;
};
