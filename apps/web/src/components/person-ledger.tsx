import type { Memory, Person, SourceRecord } from "@tendnote/domain";
import {
  formatBirthday,
  formatMonthYear,
  formatShortDate,
  humanize,
  titleCase,
} from "@/lib/person-format";

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

export function LedgerSection({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" id={id}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[length:var(--text-h2)] font-semibold leading-[var(--text-h2-line)]">
          {title}
        </h2>
        {description ? (
          <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function LedgerList({ children }: { children: React.ReactNode }) {
  return <div className="divide-y overflow-hidden rounded-xl border bg-surface">{children}</div>;
}

export function LedgerEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-5">
      <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        {children}
      </p>
    </div>
  );
}

export function MemoriesSection({ memories }: { memories: Memory[] }) {
  return (
    <LedgerSection description="Confirmed facts you've saved." id="memories" title="Memories">
      {memories.length ? (
        <LedgerList>
          {memories.map((memory) => (
            <article
              className="scroll-mt-36 flex flex-col gap-1.5 px-4 py-3.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              id={`memory-${encodeURIComponent(memory.id)}`}
              key={memory.id}
              tabIndex={-1}
            >
              <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                {memory.content}
              </p>
              <p className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
                {humanize(memory.memoryType)} · {memory.confidence} confidence
                {memory.sensitivity !== "normal" ? ` · ${memory.sensitivity}` : ""}
              </p>
            </article>
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>
          No confirmed memories yet. Save a suggestion, or add a note and review it.
        </LedgerEmpty>
      )}
    </LedgerSection>
  );
}

export function LoggedContextSection({ sourceRecords }: { sourceRecords: SourceRecord[] }) {
  return (
    <LedgerSection
      description="Notes and mentions, kept for grounding — not confirmed facts."
      id="logged-context"
      title="Logged context"
    >
      {sourceRecords.length ? (
        <LedgerList>
          {sourceRecords.map((sourceRecord) => (
            <article className="flex flex-col gap-1 px-4 py-3.5" key={sourceRecord.id}>
              <p className="text-[length:var(--text-small)] text-muted-foreground">
                {SOURCE_GROUNDING[sourceRecord.sourceType] ?? "Logged context"}
              </p>
              <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                {sourceRecord.content}
              </p>
              <p className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
                {formatShortDate(sourceRecord.createdAt)}
                {sourceRecord.sensitivity !== "normal" ? ` · ${sourceRecord.sensitivity}` : ""}
              </p>
            </article>
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>Nothing logged yet. Add a note to start grounding this profile.</LedgerEmpty>
      )}
    </LedgerSection>
  );
}

export function PersonDetailsCard({ person }: { person: Person }) {
  const rows: { label: string; value: string }[] = [
    { label: "Relationship", value: titleCase(person.relationshipType) },
  ];

  if (person.birthday) {
    rows.push({ label: "Birthday", value: formatBirthday(person.birthday) });
  }

  rows.push({ label: "Added", value: formatMonthYear(person.createdAt) });

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 text-[length:var(--text-small)] font-medium text-muted-foreground">
        Details
      </h2>
      <div className="divide-y overflow-hidden rounded-xl border bg-surface">
        {rows.map((row) => (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5" key={row.label}>
            <span className="text-[length:var(--text-small)] text-muted-foreground">
              {row.label}
            </span>
            <span className="text-[length:var(--text-small)] font-medium">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
