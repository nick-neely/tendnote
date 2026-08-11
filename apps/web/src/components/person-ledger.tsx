import type { Person } from "@tendnote/domain";
import { formatBirthday, formatMonthYear, titleCase } from "@/lib/person-format";

/**
 * The Personal Ledger primitives: a titled section, a flat divided list, and an
 * empty state.
 *
 * Actions, Assets, and Saved Items all borrow the list and empty state, so this
 * module deliberately holds nothing but presentation — no record family, no
 * mutation, no Server Action. The person ledger's own Memory and Logged-context
 * sections live in `person-ledger-records.tsx` for that reason.
 */
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
  // `scroll-mt-40` because these sections are the deep-link anchors (#memories,
  // #logged-context) and the person page's identity-plus-tabs bar is sticky -
  // without the offset a linked section lands underneath it.
  return (
    <section className="scroll-mt-40 flex flex-col gap-3" id={id}>
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
