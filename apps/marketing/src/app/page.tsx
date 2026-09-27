import { Button } from "@tendnote/ui/button";
import Link from "next/link";
import { appLinks } from "@/lib/site-links";

const sectionTitle = "text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold";
const itemTitle = "text-[length:var(--text-title)] leading-[var(--text-title-line)] font-semibold";

const loop = [
  {
    title: "Capture",
    body: "Write down what someone told you, the way you would jot it in a notebook.",
  },
  {
    title: "Confirm a memory",
    body: "Tendnote suggests what is worth keeping. You confirm it, and it stays with that person.",
  },
  {
    title: "Schedule a follow-up",
    body: "Choose when to check in. It comes back to you on Today when the time arrives.",
  },
  {
    title: "Ask what you remember",
    body: "Ask a question and get an answer grounded in what you have saved.",
  },
];

const privacyPoints = [
  {
    title: "Nothing leaves without you",
    body: "Drafts and messages outside Tendnote always wait for your approval.",
  },
  {
    title: "No ads, no cross-site tracking",
    body: "Your relationships are not a data source for anyone else.",
  },
  {
    title: "Open source",
    body: "Read the code that holds your notes, or run it yourself.",
  },
];

function Section({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="border-t">
      <div className="mx-auto max-w-6xl px-gutter py-16 sm:px-6 sm:py-20">{children}</div>
    </section>
  );
}

/** A still, illustrative slice of the loop. The person and details are invented. */
function LoopIllustration() {
  return (
    <figure className="flex flex-col gap-3">
      <div className="rounded-xl border bg-panel p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-4 border-b pb-3">
          <p className={itemTitle}>Sam Rivera</p>
          <p className="font-mono text-xs text-muted-foreground">Friend</p>
        </div>
        <dl className="flex flex-col divide-y">
          <div className="flex flex-col gap-1 py-3">
            <dt className="font-mono text-xs text-muted-foreground">Captured Tue, after coffee</dt>
            <dd>
              Sam has a final-round interview at a design studio on Thursday. Nervous about the
              portfolio review.
            </dd>
          </div>
          <div className="flex flex-col gap-1.5 py-3">
            <dt>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Memory
              </span>
            </dt>
            <dd>Interviewing at a design studio, final round on Thursday</dd>
          </div>
          <div className="flex flex-col gap-1.5 pt-3">
            <dt>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-soft-foreground">
                Follow-up, Friday
              </span>
            </dt>
            <dd>Ask Sam how the interview went</dd>
          </div>
        </dl>
      </div>
      <figcaption className="text-sm text-muted-foreground">
        An illustrative example with a fictional person.
      </figcaption>
    </figure>
  );
}

export default function HomePage() {
  const { subscribe } = appLinks();

  return (
    <>
      <section aria-labelledby="home-title">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-gutter py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="flex flex-col gap-6">
            <h1
              className="font-display text-[2rem] leading-10 font-semibold sm:text-[2.75rem] sm:leading-[3.25rem]"
              id="home-title"
            >
              Remember what people tell you, and reach out at the right time.
            </h1>
            <p className="max-w-[60ch] text-lg leading-7 text-muted-foreground">
              Tendnote is a Personal OS that starts with the people in your life. Keep the details
              that matter, and let the right moment to check in come back to you.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/demo">Explore the demo</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
          </div>
          <LoopIllustration />
        </div>
      </section>

      <Section labelledBy="loop-title">
        <div className="flex max-w-[60ch] flex-col gap-3">
          <h2 className={sectionTitle} id="loop-title">
            The relationship loop
          </h2>
          <p className="text-muted-foreground">
            Everything in Tendnote starts with a person and something worth remembering about them.
          </p>
        </div>
        <ol className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {loop.map((step, index) => (
            <li className="flex flex-col gap-2 border-t pt-4" key={step.title}>
              <span aria-hidden className="font-mono text-sm text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className={itemTitle}>{step.title}</h3>
              <p className="text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 max-w-[65ch] text-muted-foreground">
          The same notebook also keeps your actions and routines, the things you own, and a
          household you share.{" "}
          <Link
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring"
            href="/product"
          >
            See the product
          </Link>
        </p>
      </Section>

      <Section labelledBy="privacy-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
          <div className="flex flex-col gap-3">
            <h2 className={sectionTitle} id="privacy-title">
              Private by design
            </h2>
            <p className="text-muted-foreground">
              What people tell you in confidence deserves care. Tendnote is built around that.
            </p>
            <Link
              className="w-fit rounded-sm font-medium underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring"
              href="/privacy-and-ai"
            >
              How Tendnote handles your information
            </Link>
          </div>
          <ul className="grid gap-8 sm:grid-cols-3">
            {privacyPoints.map((point) => (
              <li className="flex flex-col gap-2 border-t pt-4" key={point.title}>
                <h3 className={itemTitle}>{point.title}</h3>
                <p className="text-muted-foreground">{point.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section labelledBy="plan-title">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div className="flex max-w-[60ch] flex-col gap-3">
            <h2 className={sectionTitle} id="plan-title">
              One plan, for you
            </h2>
            <p className="text-muted-foreground">
              $20 a month or $200 a year, plus applicable sales tax. Available to adults in the
              United States.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href={subscribe}>Subscribe</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
