import type { Memory, SourceRecord } from "@tendnote/domain";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { LockIcon } from "@/components/icons";
import { LedgerEmpty, LedgerList, LedgerSection } from "@/components/person-ledger";
import { RestrictedMemoriesDisclosure } from "@/components/person-restricted-memories";
import { RelationshipShareControl } from "@/components/relationship-share-control";
import { formatShortDate, humanize } from "@/lib/person-format";

/**
 * The person ledger's own record sections, kept apart from the ledger
 * primitives next door.
 *
 * The split is load-bearing rather than tidiness: these sections reach a Server
 * Action through the sharing control, and the Actions, Assets, and Saved Items
 * surfaces all borrow `LedgerList` and `LedgerEmpty`. Leaving these here means
 * borrowing a list container does not also drag the owner-action module graph
 * into a surface that never wanted it.
 */

// Source-grounded lead per provenance: user-authored notes read as "you noted",
// while imported/synced sources state where the context came from rather than
// claiming the user wrote it (issue #8 trust framing).
const SOURCE_GROUNDING: Record<string, string> = {
  manual: "You noted",
  agent: "You noted",
  contact_import: "From an imported contact",
  calendar: "From your calendar",
  gmail: "From an email",
  seed: "Sample context",
};

/**
 * What the ledger needs to offer a Relationship Share on a row.
 *
 * Absent when the owner has no household: sharing controls do not appear on a
 * solo ledger, because there is nobody to share with and the affordance would
 * only be a question the surface cannot answer.
 */
export type LedgerSharing = {
  members: ShareableActionMember[];
  /** Record id to the members it is currently shared with. */
  audiences: Record<string, string[]>;
  householdName: string | null;
};

/**
 * One memory on the ledger. Restricted memories render through the same row as
 * confirmed ones - the only difference is the marker, so a revealed memory reads
 * as the same kind of record it has always been rather than a second class of
 * thing. The marker is an icon plus the word, never a color on its own (DESIGN
 * §6 badges, §8 accessibility).
 */
function MemoryRow({
  memory,
  restricted = false,
  sharing,
}: {
  memory: Memory;
  restricted?: boolean;
  sharing?: LedgerSharing;
}) {
  const caption = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[length:var(--text-caption)] text-muted-foreground">
      <span>
        {humanize(memory.memoryType)} · {memory.confidence} confidence
        {/* A restricted row already says so in its marker; repeating the raw
            sensitivity here would only make the caption longer. */}
        {!restricted && memory.sensitivity !== "normal" ? ` · ${memory.sensitivity}` : ""}
      </span>
      {restricted ? (
        <span className="inline-flex items-center gap-1 font-sans font-medium text-foreground">
          <LockIcon aria-hidden className="size-3 shrink-0" />
          Restricted
        </span>
      ) : null}
    </span>
  );

  return (
    <article
      className="scroll-mt-36 flex flex-col gap-1.5 px-4 py-3.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      id={`memory-${encodeURIComponent(memory.id)}`}
      tabIndex={-1}
    >
      <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
        {memory.content}
      </p>
      {sharing ? (
        <RelationshipShareControl
          householdName={sharing.householdName}
          recordId={memory.id}
          recordKind="memory"
          scope={memory.scope}
          selectedUserIds={sharing.audiences[memory.id] ?? []}
          sensitivity={memory.sensitivity}
          shareableMembers={sharing.members}
        >
          {caption}
        </RelationshipShareControl>
      ) : (
        caption
      )}
    </article>
  );
}

export function MemoriesSection({
  memories,
  restrictedMemories = [],
  sharing,
}: {
  memories: Memory[];
  /**
   * Approved memories held back from proactive use. They are the owner's own
   * facts, so the page they belong to can reach them - behind the reveal below
   * the confirmed list, never mixed into it, and never counted by the Memory tab
   * badge, which promises confirmed facts.
   */
  restrictedMemories?: Memory[];
  sharing?: LedgerSharing;
}) {
  return (
    <LedgerSection description="Confirmed facts you've saved." id="memories" title="Memories">
      {memories.length ? (
        <LedgerList>
          {memories.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} sharing={sharing} />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>
          No confirmed memories yet. Save a suggestion, or add a note and review it.
        </LedgerEmpty>
      )}
      {restrictedMemories.length ? (
        <RestrictedMemoriesDisclosure count={restrictedMemories.length}>
          <LedgerList>
            {restrictedMemories.map((memory) => (
              // Restricted memories keep their sharing control. Sensitivity and
              // visibility are independent: the owner may deliberately show one
              // to their household, and the control is where that costs a
              // second, named confirmation rather than being quietly impossible.
              <MemoryRow key={memory.id} memory={memory} restricted sharing={sharing} />
            ))}
          </LedgerList>
        </RestrictedMemoriesDisclosure>
      ) : null}
    </LedgerSection>
  );
}

export function LoggedContextSection({
  sourceRecords,
  sharing,
}: {
  sourceRecords: SourceRecord[];
  sharing?: LedgerSharing;
}) {
  return (
    <LedgerSection
      description="Notes and mentions, kept for grounding. Not confirmed facts."
      id="logged-context"
      title="Logged context"
    >
      {sourceRecords.length ? (
        <LedgerList>
          {sourceRecords.map((sourceRecord) => {
            const caption = (
              <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
                {formatShortDate(sourceRecord.createdAt)}
                {sourceRecord.sensitivity !== "normal" ? ` · ${sourceRecord.sensitivity}` : ""}
              </span>
            );
            return (
              <article className="flex flex-col gap-1 px-4 py-3.5" key={sourceRecord.id}>
                <p className="text-[length:var(--text-small)] text-muted-foreground">
                  {SOURCE_GROUNDING[sourceRecord.sourceType] ?? "Logged context"}
                </p>
                <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                  {sourceRecord.content}
                </p>
                {sharing ? (
                  <RelationshipShareControl
                    householdName={sharing.householdName}
                    recordId={sourceRecord.id}
                    recordKind="source_record"
                    scope={sourceRecord.scope}
                    selectedUserIds={sharing.audiences[sourceRecord.id] ?? []}
                    sensitivity={sourceRecord.sensitivity}
                    shareableMembers={sharing.members}
                  >
                    {caption}
                  </RelationshipShareControl>
                ) : (
                  caption
                )}
              </article>
            );
          })}
        </LedgerList>
      ) : (
        <LedgerEmpty>Nothing logged yet.</LedgerEmpty>
      )}
    </LedgerSection>
  );
}
