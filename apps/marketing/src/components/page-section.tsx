import { cn } from "@tendnote/ui/cn";

/** The type and link styles every marketing page shares. */
export const pageTitle =
  "font-display text-[2.5rem] leading-[1.08] font-semibold text-balance sm:text-[3.25rem]";
export const sectionTitle =
  "text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold text-balance sm:text-[1.75rem] sm:leading-9";
export const smallText = "text-[length:var(--text-small)] leading-[var(--text-small-line)]";
export const inlineLink =
  "rounded-sm font-medium text-foreground underline underline-offset-4 outline-none transition-colors duration-150 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring";

/** One band of a page: a top rule, the shared measure, and the shared vertical rhythm. */
export function Section({
  children,
  className,
  id,
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn("border-t", className)} id={id}>
      <div className="mx-auto max-w-6xl px-gutter py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

/** A page's opening: its one H1 and the paragraph that says what the page is for. */
export function PageHeader({
  children,
  lede,
  title,
}: {
  children?: React.ReactNode;
  lede: React.ReactNode;
  title: string;
}) {
  return (
    <header className="mx-auto flex max-w-6xl flex-col gap-6 px-gutter pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-20">
      <h1 className={cn(pageTitle, "max-w-[18ch]")}>{title}</h1>
      <p className="max-w-[58ch] text-lg leading-7 text-muted-foreground">{lede}</p>
      {children}
    </header>
  );
}

/** A two-column band: the heading and its framing on the left, the substance on the right. */
export function SplitSection({
  aside,
  children,
  className,
  id,
  title,
  titleId,
}: {
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
  title: string;
  titleId: string;
}) {
  return (
    <Section className={className} id={id} labelledBy={titleId}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
        <div className="flex flex-col gap-4">
          <h2 className={sectionTitle} id={titleId}>
            {title}
          </h2>
          {aside}
        </div>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </Section>
  );
}

/** A ruled list of terms and their explanations, the site's way of stating promises. */
export function TermList({
  items,
}: {
  items: readonly { term: string; detail: React.ReactNode; id?: string }[];
}) {
  return (
    <dl className="divide-y border-y">
      {items.map((item) => (
        <div
          className="grid scroll-mt-20 gap-2 py-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6"
          id={item.id}
          key={item.term}
        >
          <dt className="font-semibold">{item.term}</dt>
          <dd className="max-w-[62ch] text-muted-foreground">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
