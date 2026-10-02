import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import {
  inlineLink,
  pageTitle,
  Section,
  SplitSection,
  sectionTitle,
  smallText,
  TermList,
} from "@/components/page-section";
import { PlanPanel } from "@/components/pricing/plan-panel";
import { approximateFullQualityTurns, FAIR_USE, OFFER } from "@/lib/offer";
import { appLinks, SELF_HOSTING_GUIDE_URL } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "Pricing",
  description: `One plan: $${OFFER.monthlyPrice} a month or $${OFFER.annualPrice} a year, plus applicable sales tax, with a ${OFFER.guaranteeDays}-day money-back guarantee.`,
};

const included = [
  "Capture in plain sentences, with suggested Memories you confirm",
  "Follow-ups on the day you choose, on Today and in your Daily Brief",
  "Eve, answering from your own notes with the source beside each answer",
  "Actions and routines for the rest of life admin",
  "The things you own, and what you know about them",
  "A household you share, with private notes kept private",
  "Export of everything you keep, at any time",
];

const hostedVersusSelf = [
  { row: "Price", hosted: "The subscription", self: "No subscription" },
  {
    row: "Running it",
    hosted: "Tendnote runs it for you",
    self: "You deploy, update, and back it up",
  },
  {
    row: "Other bills",
    hosted: "None",
    self: "Your own hosting, database, email, and model accounts",
  },
  {
    row: "Help",
    hosted: "A human reply within two business days",
    self: "Community support on GitHub",
  },
  { row: "Where", hosted: "United States only", self: "Anywhere you can deploy it" },
];

export default function PricingPage() {
  const { subscribe } = appLinks();
  const turns = approximateFullQualityTurns();

  return (
    <>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-gutter pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-20">
        <div className="flex flex-col gap-6">
          <h1 className={pageTitle}>One plan, with all of Tendnote in it.</h1>
          <p className="max-w-[48ch] text-lg leading-7 text-muted-foreground">
            ${OFFER.monthlyPrice} a month or ${OFFER.annualPrice} a year, for one person in the
            United States. No tiers to compare, no features held back, and {OFFER.guaranteeDays}{" "}
            days to ask for a full refund.
          </p>
        </div>
        <PlanPanel subscribeHref={subscribe} />
      </div>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            The whole product, for your own account. Nothing here is an add-on.
          </p>
        }
        title="What you get"
        titleId="included-title"
      >
        <ul className="flex flex-col divide-y border-y">
          {included.map((item) => (
            <li className="flex gap-3 py-3.5" key={item}>
              <CheckIcon className="mt-1 size-4 shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="max-w-[62ch] text-muted-foreground">
          Each month includes about {turns} full-quality turns with Eve, then Eve continues on a
          lighter model up to the monthly limit, plus {FAIR_USE.webSearches} web searches. Limits
          reset every month on the day you subscribed, yearly plans included.{" "}
          <Link className={inlineLink} href="/fair-use">
            How fair use works
          </Link>
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            The terms that matter, in plain words, before you pay anything.
          </p>
        }
        className="bg-surface"
        title="Before you subscribe"
        titleId="terms-title"
      >
        <TermList
          items={[
            {
              term: "Who can subscribe",
              detail:
                "Adults eighteen or older who live in the United States. One subscription covers one account.",
            },
            {
              term: "Payment comes first",
              detail:
                "There is no free trial. You create your account, pay, and you are in. The guarantee below takes the place of a trial.",
            },
            {
              term: `${OFFER.guaranteeDays}-day guarantee`,
              detail: (
                <>
                  Within {OFFER.guaranteeDays} days of your first payment, email{" "}
                  <Link className={inlineLink} href="/support">
                    support
                  </Link>{" "}
                  for a full refund, the whole ${OFFER.annualPrice} on a yearly plan. A refund ends
                  access straight away.
                </>
              ),
            },
            {
              term: "Cancelling",
              detail:
                "Cancel any time from your account. You keep access until the end of the period you paid for, and there is no partial refund for the rest of it.",
            },
            {
              term: "Monthly or yearly",
              detail:
                "Move from monthly to yearly whenever you like. A move from yearly to monthly starts when the paid year ends. You get an email before every yearly renewal.",
            },
            {
              term: "Help",
              detail: (
                <>
                  A substantive reply from a person within {OFFER.supportReplyBusinessDays} business
                  days, Central Time.{" "}
                  <Link className={inlineLink} href="/support#reply-promise">
                    What that means exactly
                  </Link>
                </>
              ),
            },
            {
              term: "The fine print",
              detail: (
                <>
                  You accept the{" "}
                  <Link className={inlineLink} href="/terms">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link className={inlineLink} href="/privacy">
                    Privacy Policy
                  </Link>{" "}
                  when you create your account.
                </>
              ),
            },
          ]}
        />
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            A subscription is for one person, not a household.
          </p>
        }
        id="household"
        title="Sharing with a household"
        titleId="household-title"
      >
        <p className="max-w-[62ch]">
          You can invite the people you live with into a household you share. Someone you invite can
          accept without paying and read what the household shares with them, as a guest, while at
          least one paying member keeps the household active.
        </p>
        <p className="max-w-[62ch] text-muted-foreground">
          To capture, ask Eve, or get reminders of their own, they subscribe with their own account.
          Their private notes stay theirs, and yours stay yours.
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <>
            <p className="max-w-[44ch] text-muted-foreground">
              Tendnote is open source under the AGPL-3.0. If you would rather run it yourself, you
              can, wherever you live.
            </p>
            <a className={`${inlineLink} w-fit`} href={SELF_HOSTING_GUIDE_URL}>
              Read the self-hosting guide
            </a>
          </>
        }
        className="bg-panel"
        title="Or run it yourself, free"
        titleId="self-host-title"
      >
        <div className="overflow-x-auto rounded-2xl border bg-background">
          <table className="w-full text-left">
            <caption className="sr-only">
              The hosted plan compared with running Tendnote yourself
            </caption>
            <thead>
              <tr className="border-b">
                <td className="w-[6.5rem] px-4 py-3 sm:w-[8rem]" />
                <th className="px-4 py-3 font-semibold" scope="col">
                  Hosted plan
                </th>
                <th className="px-4 py-3 font-semibold" scope="col">
                  Self-hosted
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hostedVersusSelf.map((line) => (
                <tr key={line.row}>
                  <th
                    className={`px-4 py-3 align-top font-medium text-muted-foreground ${smallText}`}
                    scope="row"
                  >
                    {line.row}
                  </th>
                  <td className="px-4 py-3 align-top">{line.hosted}</td>
                  <td className="px-4 py-3 align-top">{line.self}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`max-w-[62ch] text-muted-foreground ${smallText}`}>
          The software costs nothing; the services it runs on do. The guide covers Vercel, the one
          deployment the project supports.
        </p>
      </SplitSection>

      <Section labelledBy="close-title">
        <div className="flex flex-col items-start gap-6">
          <h2 className={sectionTitle} id="close-title">
            Fourteen days is long enough to know.
          </h2>
          <p className="max-w-[56ch] text-muted-foreground">
            Capture a few people, set a follow-up, and see whether Friday feels different. If it is
            not for you, one email gets your money back.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href={subscribe}>Subscribe</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/demo">Explore the demo first</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
