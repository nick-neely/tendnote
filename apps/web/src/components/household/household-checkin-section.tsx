import { HOUSEHOLD_CHECKIN_HEADING } from "@tendnote/domain/household-checkin";
import type { HouseholdHomeRecord } from "@tendnote/domain/household-home";
import {
  HOUSEHOLD_SECTION_HEADING_CLASS,
  HouseholdRecordRow,
  HouseholdRecordRowReserve,
  ReserveLine,
} from "@/components/household/household-record-row";

/**
 * The heading the check-in wears where it is a guest.
 *
 * On the Household page it is a peer of "Ready now" and "Coming up", so it
 * takes their H2 exactly — one page, one heading treatment. Inside a brief or an
 * Eve surface it sits among sections whose own headings are Small and muted, and
 * a 20px section heading dropped into a 380px rail reads as a page that wandered
 * in. Title is the deliberate secondary treatment there, decided by the same
 * `context` prop that already decides the line beneath it.
 */
const AWAY_HEADING_CLASS =
  "font-semibold text-[length:var(--text-title)] leading-[var(--text-title-line)] tracking-normal";

/**
 * One member's private Household check-in.
 *
 * Read-first and deliberately quieter than the Household home it draws from: no
 * inline mutation, no count, no badge, no severity colour. The home is where a
 * household acts together; this is a member glancing at what is going on before
 * their day starts, inside their own briefing, and the only affordance a row
 * needs is the canonical link to the record itself. Anything consequential opens
 * that record — which is also what keeps this from becoming an assignment
 * surface (ADR 0220).
 *
 * Quieter is a matter of what a row can do, not of how a row is set: the records
 * here are the same objects the home lists, so they wear the same
 * {@link HouseholdRecordRow} anatomy at the same sizes. A shared chore that
 * shrinks by three points between two lists on one page is not calm, it is two
 * designs.
 *
 * It is not the Household home's third section and not a digest: at most three
 * rows, chosen deterministically before this component sees them, and rendered
 * identically for every member with the same access.
 *
 * The whole section is absent when there is nothing timely. An empty check-in is
 * a small standing request to go and find something, and this product does not
 * make those — so the caller asks {@link householdCheckinIsWorthShowing} rather
 * than rendering an empty state here.
 */
export function HouseholdCheckinSection({
  householdName,
  records,
  limitations,
  headingId,
  context = "away",
}: {
  householdName: string;
  records: readonly HouseholdHomeRecord[];
  limitations: readonly string[];
  headingId: string;
  /**
   * Where this instance is being read, which is the only thing that differs
   * between the two.
   *
   * On a small household the check-in genuinely repeats rows sitting one scroll
   * above it on the Household page. Suppressing it there was the other option and
   * it is worse: the section would appear and disappear as the household's record
   * count crossed the cap, so the one place a member goes to *find* their
   * check-in would be the place most likely not to have one — and the offer to
   * turn it on would sit under an example of it that had vanished.
   *
   * So both instances stay and the copy carries the difference. `away` (a brief,
   * Eve) has to name the household, because the reader has no other context for
   * whose records these are. `home` is already under the household's own name, so
   * repeating it is noise; there the line says what the section is *for* — the
   * short version they will see elsewhere — which turns the repetition from a
   * duplicate into a preview of the thing being offered.
   */
  context?: "home" | "away";
}) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          className={context === "home" ? HOUSEHOLD_SECTION_HEADING_CLASS : AWAY_HEADING_CLASS}
          id={headingId}
        >
          {HOUSEHOLD_CHECKIN_HEADING}
        </h2>
        {/* The boundary, said once and in words: whose records these are, and
            that the list is this member's own view of them. Naming the household
            is what stops a shared row reading as a private obligation. */}
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {context === "home"
            ? "The short version, in your own brief. Only you see it."
            : `What ${householdName} is coordinating, as you can see it.`}
        </p>
      </div>

      {records.length > 0 ? (
        <ul className="flex list-none flex-col divide-y border-t border-b">
          {records.map((record) => (
            <HouseholdRecordRow key={record.identity} record={record} />
          ))}
        </ul>
      ) : null}

      {limitations.map((limitation) => (
        <p
          className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
          key={limitation}
          role="status"
        >
          {limitation}
        </p>
      ))}
    </section>
  );
}

/**
 * A check-in-shaped reserve: the heading it will have, and rows the size of rows.
 *
 * The Household page is the only surface that reserves this — a brief renders the
 * check-in behind a fallback of nothing, because a placeholder for someone
 * else's household is not worth a member's attention — so it wears the home
 * heading, and reserves the subtitle line that heading always carries.
 */
export function HouseholdCheckinReserve() {
  return (
    <section
      aria-busy="true"
      aria-label={`Loading ${HOUSEHOLD_CHECKIN_HEADING}`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 className={HOUSEHOLD_SECTION_HEADING_CLASS}>{HOUSEHOLD_CHECKIN_HEADING}</h2>
        <ReserveLine bar="h-3" box="h-5" width="w-56" />
      </div>
      <div className="flex flex-col divide-y border-t border-b">
        {[0, 1].map((row) => (
          <HouseholdRecordRowReserve key={row} />
        ))}
      </div>
    </section>
  );
}
