import type { SourceRecordReviewComponent, SourceRecordReviewResult } from "@tendnote/db/queries/source-records";
import type { SourceRecord } from "@tendnote/domain";

export type SourceRecordReviewView = {
  component: SourceRecordReviewComponent;
  sourceRecord: Omit<SourceRecord, "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };
};

export function toSourceRecordReviewView(result: SourceRecordReviewResult): SourceRecordReviewView {
  return {
    component: result.component,
    sourceRecord: {
      ...result.sourceRecord,
      createdAt: result.sourceRecord.createdAt.toISOString(),
      updatedAt: result.sourceRecord.updatedAt.toISOString(),
    },
  };
}
