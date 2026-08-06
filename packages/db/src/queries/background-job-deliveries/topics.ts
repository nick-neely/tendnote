export const BACKGROUND_JOB_TOPICS = {
  extraction: "tendnote-extraction-v1",
  embedding: "tendnote-embedding-v1",
  // Action extraction shares the extraction topic and its consumer route: the consumer
  // dispatches by the payload's `jobKind`, so one route handles both memory and action
  // extraction without a second Vercel queue. They stay distinct delivery rows (jobKind
  // differs) and carry their own per-kind rate-limit budget.
  action_extraction: "tendnote-extraction-v1",
  context_fact_extraction: "tendnote-extraction-v1",
  reminder_push: "tendnote-reminder-push-v1",
} as const;

export type BackgroundJobKind = keyof typeof BACKGROUND_JOB_TOPICS;

export function topicForBackgroundJob(kind: BackgroundJobKind) {
  return BACKGROUND_JOB_TOPICS[kind];
}
