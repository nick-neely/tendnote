/** What the first run is decided from, read in one pass for one account. */
export type FirstRunFacts = {
  firstRunClosed: boolean;
  integrationOfferClosed: boolean;
  /** The owner has started an Assistant conversation from any surface. */
  hasConversation: boolean;
  hasPerson: boolean;
  /** The `first_value_reached` Activation Milestone is stamped (ADR 0242). */
  firstValueReached: boolean;
};

/** Storage seam for the first run (#639); a missing profile reads `null`. */
export type FirstRunStore = {
  readFacts(input: { userId: string }): Promise<FirstRunFacts | null>;
  /** One `exists` on people, for the check Eve makes on every turn. */
  hasPerson(input: { userId: string }): Promise<boolean>;
  closeFirstRun(input: { userId: string; at: Date }): Promise<void>;
  closeIntegrationOffer(input: { userId: string; at: Date }): Promise<void>;
};
