export const BACKGROUND_JOB_TOPICS = {
  extraction: "tendnote.extraction.v1",
  embedding: "tendnote.embedding.v1",
} as const;

export type BackgroundJobKind = keyof typeof BACKGROUND_JOB_TOPICS;

export function topicForBackgroundJob(kind: BackgroundJobKind) {
  return BACKGROUND_JOB_TOPICS[kind];
}
