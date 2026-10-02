import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthMeter } from "@/components/fair-use/month-meter";
import {
  inlineLink,
  pageTitle,
  Section,
  SplitSection,
  sectionTitle,
  smallText,
  TermList,
} from "@/components/page-section";
import { approximateFullQualityTurns, FAIR_USE, formatDollars } from "@/lib/offer";

export const metadata: Metadata = {
  title: "Fair use",
  description:
    "What a month of Tendnote includes, what happens at each limit, and how the limits convert from dollars to Eve turns.",
};

const functions = [
  {
    name: "Eve conversation",
    normal: "Full quality",
    reduced: "A lighter model",
    paused: "No new turns",
  },
  {
    name: "Search",
    normal: "Exact and related results",
    reduced: "Exact results only, with a notice",
    paused: "Related results unavailable; lists stay browsable",
  },
  {
    name: "Capture processing",
    normal: "Runs",
    reduced: "Never reduced",
    paused: "Waits, pending, and runs later; nothing is lost",
  },
  {
    name: "Scheduled briefs and reviews",
    normal: "Delivered",
    reduced: "Never reduced",
    paused: "The next one is skipped, with a notice",
  },
  {
    name: "Reminders",
    normal: "Delivered",
    reduced: "Never reduced",
    paused: "Never deliberately held back",
  },
];

export default function FairUsePage() {
  const turns = approximateFullQualityTurns();
  const cents = (FAIR_USE.typicalTurnCost * 100).toFixed(1);

  return (
    <>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-gutter pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="flex flex-col gap-6">
          <h1 className={pageTitle}>Know the limits before you reach them.</h1>
          <p className="max-w-[48ch] text-lg leading-7 text-muted-foreground">
            Each month includes about {turns} full-quality turns with Eve. After that, Eve continues
            on a lighter model up to the monthly limit. You always see which state you are in, why,
            and the date it resets.
          </p>
        </div>
        <MonthMeter />
      </div>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            Your allowance resets every month on the day you subscribed. On a yearly plan it still
            resets monthly, not once a year.
          </p>
        }
        className="bg-surface"
        title="What a month includes"
        titleId="month-title"
      >
        <TermList
          items={[
            {
              term: "Eve",
              detail: `About ${turns} full-quality turns, then a lighter model up to the monthly limit. A turn is one message from you and Eve's answer to it.`,
            },
            {
              term: "Web searches",
              detail: `${FAIR_USE.webSearches} a month, when Eve looks something up on the web for you.`,
            },
            {
              term: "Everything else",
              detail:
                "Capture processing, search, and your scheduled briefs share one background allowance. If it runs out, new captures wait their turn instead of failing, and nothing is lost.",
            },
          ]}
        />
      </SplitSection>

      <Section labelledBy="states-title">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 className={sectionTitle} id="states-title">
              What happens at each limit
            </h2>
            <p className="max-w-[62ch] text-muted-foreground">
              Each part of Tendnote is normal, reduced, or paused, and is never slowed down
              silently. A limit changes the pace of one function. It never touches your records,
              reminders, export, billing, or cancelling, and it never changes what Eve is allowed to
              do.
            </p>
          </div>
          <dl className="flex flex-col divide-y border-y sm:hidden">
            {functions.map((fn) => (
              <div className="flex flex-col gap-2 py-4" key={fn.name}>
                <dt className="font-semibold">{fn.name}</dt>
                <dd className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
                  <span className="text-foreground">Normal</span>
                  <span>{fn.normal}</span>
                  <span className="text-foreground">Reduced</span>
                  <span>{fn.reduced}</span>
                  <span className="text-foreground">Paused</span>
                  <span>{fn.paused}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="hidden overflow-x-auto rounded-2xl border sm:block">
            <table className="w-full text-left">
              <caption className="sr-only">
                Each function's normal, reduced, and paused state
              </caption>
              <thead className="bg-surface">
                <tr className="border-b">
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Function
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Normal
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Reduced
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Paused
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {functions.map((fn) => (
                  <tr key={fn.name}>
                    <th className="px-4 py-3 align-top font-medium" scope="row">
                      {fn.name}
                    </th>
                    <td className="px-4 py-3 align-top text-muted-foreground">{fn.normal}</td>
                    <td className="px-4 py-3 align-top text-muted-foreground">{fn.reduced}</td>
                    <td className="px-4 py-3 align-top text-muted-foreground">{fn.paused}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            Every notice states exactly one of these, so you always know what ends it.
          </p>
        }
        title="How a limit ends"
        titleId="recovery-title"
      >
        <TermList
          items={[
            {
              term: "Resets on a date",
              detail:
                "Your own monthly limit was reached. The notice shows the date your allowance resets.",
            },
            {
              term: "Resumes when service is restored",
              detail:
                "Tendnote itself is holding back to protect the service, during an incident or a cost safeguard that covers every account. There is no date, because promising one would be a guess.",
            },
            {
              term: "Retrying",
              detail: "A piece of background work failed and already has a retry scheduled.",
            },
          ]}
        />
        <p className={`max-w-[62ch] text-muted-foreground ${smallText}`}>
          When more than one applies, the notice shows the most restrictive and updates as each
          clears.
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            Tendnote enforces limits in dollars of model cost, because that is what a turn actually
            costs. Here is the conversion, so the turn count stays honest when prices move.
          </p>
        }
        className="bg-panel"
        title="From dollars to turns"
        titleId="dollars-title"
      >
        <div className="overflow-x-auto rounded-2xl border bg-background">
          <table className="w-full text-left">
            <caption className="sr-only">Monthly allowances in dollars of model cost</caption>
            <thead>
              <tr className="border-b">
                <th className="px-4 py-3 font-semibold" scope="col">
                  Each month
                </th>
                <th className="px-4 py-3 font-semibold" scope="col">
                  Full quality ends
                </th>
                <th className="px-4 py-3 font-semibold" scope="col">
                  Monthly limit
                </th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              <tr>
                <th className="px-4 py-3 font-medium" scope="row">
                  Eve
                </th>
                <td className="px-4 py-3">{formatDollars(FAIR_USE.eveBudget)}</td>
                <td className="px-4 py-3">{formatDollars(FAIR_USE.eveCeiling)}</td>
              </tr>
              <tr>
                <th className="px-4 py-3 font-medium" scope="row">
                  Background work
                </th>
                <td className="px-4 py-3 text-muted-foreground">No reduced state</td>
                <td className="px-4 py-3">{formatDollars(FAIR_USE.backgroundCeiling)}</td>
              </tr>
              <tr>
                <th className="px-4 py-3 font-medium" scope="row">
                  Web search
                </th>
                <td className="px-4 py-3 text-muted-foreground">No reduced state</td>
                <td className="px-4 py-3">
                  {formatDollars(FAIR_USE.webSearchCeiling)}, {FAIR_USE.webSearches} searches
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="max-w-[62ch]">
          In a typical measured month, one Eve turn cost about {cents} cents, so{" "}
          {formatDollars(FAIR_USE.eveBudget)} buys about {turns} full-quality turns. The{" "}
          {formatDollars(FAIR_USE.eveCeiling - FAIR_USE.eveBudget)} between the two Eve figures is
          what the lighter model runs on. How many turns that gives is published here once it has
          been measured.
        </p>
        <p className={`max-w-[62ch] text-muted-foreground ${smallText}`}>
          These figures come from one measured month and are estimates. Heavy use can reach the
          limits, and when real usage shows they are too tight, the allowance widens before the
          price changes.
        </p>
      </SplitSection>

      <Section labelledBy="fair-close-title">
        <div className="flex flex-col items-start gap-5">
          <h2 className={sectionTitle} id="fair-close-title">
            One plan, these limits, nothing hidden.
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/pricing">View pricing</Link>
            </Button>
          </div>
          <p className={`text-muted-foreground ${smallText}`}>
            Questions about a limit you hit?{" "}
            <Link className={inlineLink} href="/support">
              Write to support
            </Link>
            .
          </p>
        </div>
      </Section>
    </>
  );
}
