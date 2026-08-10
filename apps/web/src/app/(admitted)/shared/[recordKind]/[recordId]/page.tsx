import { readSharedRelationshipRecord } from "@tendnote/db/queries/relationship-shares";
import { relationshipRecordKindSchema } from "@tendnote/domain";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { AdmittedRoute } from "@/components/admitted-route";
import {
  SharedRelationshipRecord,
  SharedRelationshipRecordUnavailable,
} from "@/components/shared-relationship-record";
import { requireAdmittedOwner } from "@/lib/access/current-access";

type SharedRecordParams = { recordKind: string; recordId: string };

export default function SharedRecordPage({ params }: { params: Promise<SharedRecordParams> }) {
  return (
    <AdmittedRoute destination="shared-record">
      <SharedRecordContent params={params} />
    </AdmittedRoute>
  );
}

/**
 * The direct, targeted request for one shared relationship record.
 *
 * This is the only way to read another member's record, and it is a URL rather
 * than a feed on purpose: there is no Household relationship dashboard, no
 * people list, and nothing here to browse. Naming the record *is* the request,
 * which is also what makes restricted content reachable here and nowhere
 * ambient.
 *
 * The URL is not the permission. Every load re-proves access against current
 * membership and the record's current audience, so a link that worked yesterday
 * — bookmarked, forwarded, or left open in a tab — stops working the moment the
 * owner takes the record back or the reader leaves the household (ADR 0219).
 */
export async function SharedRecordContent({ params }: { params: Promise<SharedRecordParams> }) {
  if (process.env.NODE_ENV !== "test") await connection();
  const { recordKind, recordId } = await params;
  // The concrete URL, not the destination's route template: someone following a
  // link here while signed out must land back on the record they were sent, not
  // on a literal `[recordKind]` path.
  const callerUserId = await requireAdmittedOwner({
    returnTo: `/shared/${encodeURIComponent(recordKind)}/${encodeURIComponent(recordId)}`,
  });

  const parsedKind = relationshipRecordKindSchema.safeParse(recordKind);
  if (!parsedKind.success) {
    // A kind outside the three relationship families is refused exactly like an
    // unauthorized one: a malformed URL must not be distinguishable from a
    // forbidden record.
    return <SharedRecordShell>{<SharedRelationshipRecordUnavailable />}</SharedRecordShell>;
  }

  try {
    const view = await readSharedRelationshipRecord({
      callerUserId,
      recordKind: parsedKind.data,
      recordId,
      purpose: "direct",
    });

    return (
      <SharedRecordShell>
        {view ? <SharedRelationshipRecord view={view} /> : <SharedRelationshipRecordUnavailable />}
      </SharedRecordShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    // Including a malformed record id, which Postgres rejects as a uuid. The
    // failure reads the same as every other refusal.
    return <SharedRecordShell>{<SharedRelationshipRecordUnavailable />}</SharedRecordShell>;
  }
}

function SharedRecordShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">{children}</div>;
}
