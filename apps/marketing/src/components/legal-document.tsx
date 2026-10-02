import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { inlineLink, smallText } from "@/components/page-section";
import {
  formatEffectiveDate,
  type LoadedLegalDocument,
  type RepositoryDocument,
  resolveDocumentHref,
  sourceRef,
  sourceUrl,
} from "@/lib/legal-documents";

// Document headings sit a step below the marketing pages' section titles.
const documentHeading =
  "text-[length:var(--text-h2)] leading-[var(--text-h2-line)] font-semibold sm:text-[length:var(--text-h1)] sm:leading-[var(--text-h1-line)]";

/**
 * Markdown as reading text. The document's own headings start at H2 under
 * the page's H1; tables keep real header cells so they read as tables.
 */
const components: Components = {
  h1: ({ node: _node, ...props }) => <h2 className={`${documentHeading} mt-10`} {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className={`${documentHeading} mt-10`} {...props} />,
  h3: ({ node: _node, ...props }) => (
    <h3
      className="mt-8 text-[length:var(--text-title)] leading-[var(--text-title-line)] font-semibold"
      {...props}
    />
  ),
  p: ({ node: _node, ...props }) => <p className="mt-4" {...props} />,
  a: ({ node: _node, ...props }) => <a className={inlineLink} {...props} />,
  ul: ({ node: _node, ...props }) => (
    <ul className="mt-4 list-disc space-y-2 pl-6 marker:text-muted-foreground" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="mt-4 list-decimal space-y-2 pl-6 marker:text-muted-foreground" {...props} />
  ),
  strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="mt-6 overflow-x-auto rounded-2xl border">
      <table className="w-full border-collapse text-left" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-surface" {...props} />,
  tr: ({ node: _node, ...props }) => <tr className="border-b last:border-b-0" {...props} />,
  th: ({ node: _node, ...props }) => (
    <th className="px-4 py-3 align-bottom font-semibold" scope="col" {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="px-4 py-3 align-top text-muted-foreground first:text-foreground" {...props} />
  ),
};

/** A repository document's body, with its relative links sent to GitHub at the deployed ref. */
export function DocumentText({ document }: { document: RepositoryDocument }) {
  const ref = sourceRef();
  return (
    <div className="[&>:first-child]:mt-0">
      <Markdown
        components={components}
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => defaultUrlTransform(resolveDocumentHref(url, document.path, ref))}
      >
        {document.body}
      </Markdown>
    </div>
  );
}

/** A section of a legal page that renders another repository document under a stable anchor. */
export function LegalSection({
  document,
  id,
  title,
}: {
  document: RepositoryDocument;
  id: string;
  title: string;
}) {
  const titleId = `${id}-title`;
  return (
    <section aria-labelledby={titleId} className="mt-16 scroll-mt-20 border-t pt-12" id={id}>
      <h2 className={documentHeading} id={titleId}>
        {title}
      </h2>
      <div className="mt-4">
        <DocumentText document={document} />
      </div>
    </section>
  );
}

/** A legal document page: its title, version, and source, then its text in a reading measure. */
export function LegalDocument({
  children,
  document,
}: {
  children?: React.ReactNode;
  document: LoadedLegalDocument;
}) {
  return (
    <article className="mx-auto max-w-6xl px-gutter py-16 sm:px-6 sm:py-24">
      <div className="max-w-[70ch]">
        <header className="flex flex-col gap-3">
          <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold sm:text-[2rem] sm:leading-10">
            {document.title}
          </h1>
          <p className={`${smallText} text-muted-foreground`}>
            Version {document.version}, effective {formatEffectiveDate(document.effectiveDate)}.{" "}
            <a className={inlineLink} href={sourceUrl(document.path)}>
              Read this version&rsquo;s source
            </a>
          </p>
        </header>
        <div className="mt-10">
          <DocumentText document={document} />
        </div>
        {children}
      </div>
    </article>
  );
}
