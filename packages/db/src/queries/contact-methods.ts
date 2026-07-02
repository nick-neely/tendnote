import { createDrizzleContactMethodStore } from "./contact-methods/drizzle-store";

export { createDrizzleContactMethodStore } from "./contact-methods/drizzle-store";
export type { InMemoryContactMethodSeed } from "./contact-methods/in-memory-store";
export { createInMemoryContactMethodStore } from "./contact-methods/in-memory-store";
export type * from "./contact-methods/types";

const defaultContactMethodStore = createDrizzleContactMethodStore();

/** An owner's saved email contact methods for a person, primary first (ADR-0085). */
export function listPersonEmailContactMethods(input: { ownerUserId: string; personId: string }) {
  return defaultContactMethodStore.listPersonEmailContactMethods(input);
}

export function findOwnerContactMethodDuplicates(input: {
  ownerUserId: string;
  methods: Array<{ type: "email" | "phone"; value: string; normalizedValue: string | null }>;
}) {
  return defaultContactMethodStore.findOwnerContactMethodDuplicates(input);
}

export function createContactMethod(input: {
  ownerUserId: string;
  personId: string;
  type: "email" | "phone";
  value: string;
  displayValue: string | null;
  normalizedValue: string | null;
  isPrimary?: boolean;
  source?: "manual" | "agent" | "contact_import" | "calendar" | "gmail" | "seed";
}) {
  return defaultContactMethodStore.createContactMethod(input);
}
