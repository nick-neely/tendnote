import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import {
  inlineLink,
  PageHeader,
  SplitSection,
  smallText,
  TermList,
} from "@/components/page-section";
import { OFFER, SUPPORT_EMAIL } from "@/lib/offer";
import { COMMUNITY_SUPPORT_URL, statusPageUrl } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "Support",
  description: `One address for help, billing, and privacy requests, with a human reply within ${OFFER.supportReplyBusinessDays} business days, Central Time.`,
};

const mailto = `mailto:${SUPPORT_EMAIL}`;

export default function SupportPage() {
  const statusUrl = statusPageUrl();

  return (
    <>
      <PageHeader
        lede="Tendnote is run by one person, and that person answers the mail. Help with your account, billing, refunds, and privacy all goes to the same address."
        title="Write to a person, not a ticket queue."
      >
        <div className="flex flex-col gap-3">
          <Button asChild className="w-fit" size="lg">
            <a href={mailto}>Email {SUPPORT_EMAIL}</a>
          </Button>
          <p className={`text-muted-foreground ${smallText}`}>
            Please leave private details about other people out of your message unless they are
            needed.
          </p>
        </div>
      </PageHeader>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            A substantive reply, not an automatic acknowledgement.
          </p>
        }
        className="bg-surface"
        id="reply-promise"
        title={`A reply within ${OFFER.supportReplyBusinessDays} business days`}
        titleId="promise-title"
      >
        <p className="max-w-[62ch]">
          A person replies to your email by the end of the second business day after the day it
          arrives, in Central Time. Weekends and observed US federal holidays are not business days.
          Write on a Friday afternoon, and you hear back by the end of Tuesday.
        </p>
        <p className="max-w-[62ch] text-muted-foreground">
          The reply is a real answer or the next step, not a promise that everything is fixed by
          then. There are no service credits for outages and no uptime figure, because one person
          cannot honestly guarantee one.
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            Most account tasks are self-service. Write when they are not.
          </p>
        }
        title="What to write about"
        titleId="topics-title"
      >
        <TermList
          items={[
            {
              term: "Refunds",
              detail: `Within ${OFFER.guaranteeDays} days of your first payment, ask for a full refund. The refund is started in the reply. When the money reaches your card is up to your card issuer, and access ends once it is refunded.`,
            },
            {
              term: "Billing",
              detail:
                "Change your card, switch between monthly and yearly, or cancel from your account. Write if a charge looks wrong.",
            },
            {
              term: "Export and deletion",
              detail:
                "Both are on your Account page and take effect without waiting for anyone. If you cannot sign in, write and we will confirm it is you before acting.",
            },
            {
              term: "Privacy requests",
              detail: (
                <>
                  Questions about what Tendnote holds and how it is handled. The{" "}
                  <Link className={inlineLink} href="/privacy-and-ai">
                    Privacy &amp; AI
                  </Link>{" "}
                  page answers the common ones.
                </>
              ),
            },
            {
              term: "Bugs",
              detail:
                "Something broken, including a household member seeing what they should not. Send it here rather than to a public GitHub issue, so your details stay private.",
            },
            {
              term: "Eve got it wrong",
              detail:
                "Tell us. You get a reply, though not a promise that a particular answer will change.",
            },
            {
              term: "Ideas",
              detail: "Welcome, with a reply and no promise of when or whether they ship.",
            },
          ]}
        />
        <p className={`max-w-[62ch] text-muted-foreground ${smallText}`}>
          Support cannot help with relationship advice, with settling disagreements between
          household members, or with running your own copy of Tendnote.
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            If you are not a customer but think a customer wrote about you.
          </p>
        }
        className="bg-surface"
        title="Someone wrote about you"
        titleId="non-user-title"
      >
        <p className="max-w-[62ch]">
          You can write to the same address and get a reply within the same{" "}
          {OFFER.supportReplyBusinessDays} business days. That reply explains that Tendnote does not
          search its customers&rsquo; notes for your name and does not pass your request on to them.
        </p>
        <p className="max-w-[62ch] text-muted-foreground">
          Searching every customer&rsquo;s notes would mean reading people&rsquo;s private records
          without their say, and passing a request on would tell you which customer wrote about you.
          Each customer controls their own notes.
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            {statusUrl
              ? "Two other places to look, depending on what you need."
              : "One other place to look, if you run Tendnote yourself."}
          </p>
        }
        title="Elsewhere"
        titleId="elsewhere-title"
      >
        <TermList
          items={[
            ...(statusUrl
              ? [
                  {
                    term: "Is it down?",
                    detail: (
                      <>
                        The{" "}
                        <a className={inlineLink} href={statusUrl}>
                          status page
                        </a>{" "}
                        is hosted separately from Tendnote, so it stays readable during an outage.
                      </>
                    ),
                  },
                ]
              : []),
            {
              term: "Running it yourself",
              detail: (
                <>
                  Self-hosted Tendnote has{" "}
                  <a className={inlineLink} href={COMMUNITY_SUPPORT_URL}>
                    community support
                  </a>{" "}
                  through GitHub, with no response commitment.
                </>
              ),
            },
          ]}
        />
      </SplitSection>
    </>
  );
}
