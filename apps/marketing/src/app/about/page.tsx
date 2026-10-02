import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import {
  inlineLink,
  PageHeader,
  Section,
  SplitSection,
  sectionTitle,
  TermList,
} from "@/components/page-section";
import { OFFER } from "@/lib/offer";
import { CASE_STUDY_URL, REPOSITORY_URL } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "About",
  description:
    "Tendnote is made and run by Nick Neely and operated by Neely Solutions LLC. Open source, no investors, one plan.",
};

export default function AboutPage() {
  return (
    <>
      <PageHeader
        lede="Tendnote is made and run by one person. That shapes everything else on this site: the single plan, the plain terms, and the promises it keeps small enough to keep."
        title="One person makes Tendnote, and answers for it."
      />

      <SplitSection className="bg-surface" title="Why it exists" titleId="why-title">
        <div className="flex max-w-[62ch] flex-col gap-4 text-lg leading-7">
          <p>
            I&rsquo;m Nick Neely. I built Tendnote for my own friends and family first, and I use it
            myself. Caring about people was never the hard part. Remembering what they told me, and
            bringing it up at the right time, was.
          </p>
          <p>
            It is deliberately not a sales tool. People are not leads, and a missed check-in is not
            a failure.
          </p>
          <p className="text-muted-foreground">
            Opening it up as a paid service is also how I am learning to run a real product with
            real customers and real payments, carefully and in the open.
          </p>
        </div>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">Who you are dealing with, by name.</p>
        }
        title="Who runs it"
        titleId="who-title"
      >
        <TermList
          items={[
            {
              term: "The maker",
              detail:
                "Nick Neely builds Tendnote, runs the service, and answers the support email.",
            },
            {
              term: "The company",
              detail:
                "Neely Solutions LLC operates Tendnote. It is the party to the Terms of Service and the Privacy Policy, and it holds the payment account. Your card statement reads TENDNOTE.",
            },
            {
              term: "The money",
              detail:
                "No investors, no advertising, and one plan. The subscription is the only way Tendnote makes money.",
            },
          ]}
        />
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            Proof you can read, in place of testimonials.
          </p>
        }
        className="bg-surface"
        title="Built in the open"
        titleId="open-title"
      >
        <p className="max-w-[62ch]">
          All of Tendnote is open source under the AGPL-3.0, including the code that stores your
          notes and decides who can see them. The case study is a written account of how it was
          built and how its privacy boundaries are enforced and tested.
        </p>
        <p className="flex flex-wrap gap-x-6 gap-y-2">
          <a className={inlineLink} href={CASE_STUDY_URL}>
            Read the case study
          </a>
          <a className={inlineLink} href={REPOSITORY_URL}>
            Browse the source code
          </a>
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">The trade-offs, stated up front.</p>
        }
        title="What one person can promise"
        titleId="promise-title"
      >
        <p className="max-w-[62ch]">
          A human reply within {OFFER.supportReplyBusinessDays} business days, not an instant chat.
          No uptime percentage, because one person cannot honestly guarantee one. In return: a
          service run by someone who uses it, no growth targets pulling it toward your attention,
          and {OFFER.guaranteeDays} days to get your money back if it is not for you.
        </p>
        <p className="flex flex-wrap gap-x-6 gap-y-2">
          <Link className={inlineLink} href="/support">
            How support works
          </Link>
          <Link className={inlineLink} href="/pricing">
            The plan and its terms
          </Link>
        </p>
      </SplitSection>

      <Section className="bg-panel" labelledBy="about-close-title">
        <div className="flex flex-col items-start gap-5">
          <h2 className={sectionTitle} id="about-close-title">
            See what it does before anything else
          </h2>
          <Button asChild size="lg">
            <Link href="/demo">Explore the demo</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
