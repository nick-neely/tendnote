import type { RenderedToolName } from "@tendnote/domain";
import type { ReactNode } from "react";
import type { AssistantToolView, ToolViewTier } from "@/lib/eve/tool-result-view";

/**
 * The deep result module for one fixed typed Assistant Surface result kind.
 *
 * Each kind of persisted Eve tool result — a saved memory, a suggested follow-up, a
 * loaded asset — owns a single module that concentrates everything the surface must
 * know about it: how to validate and project its persisted output ({@link parsers}),
 * how much visual weight it earns ({@link tier}), its refresh-stable identity
 * ({@link key}), whether it folds into a same-kind group ({@link groupable}), whether
 * it carries an inline action affordance ({@link interactive}), and how it renders in
 * the read-only presentational tier ({@link render}).
 *
 * The deletion test: remove a module and this behavior does not migrate to a caller —
 * it simply disappears, because nothing else knows a kind's trust treatment, its
 * projection, or its rendering. The dispatchers ({@link toAssistantToolView},
 * `toolViewTier`, `assistantToolViewKey`, `AssistantToolResult`) hold no per-kind
 * policy; they are exhaustive table lookups into the registry.
 *
 * Two boundaries stay outside the module by design, because each is a real seam:
 * - Validation schemas live in `@tendnote/domain` (the cross-package contract the
 *   agent guard also enumerates); a module's parser references them rather than
 *   re-declaring the shape.
 * - The interactive rendering of an actionable kind (a client card that imports
 *   `server-only` review mutations) lives at the {@link AssistantTurnUnitView} client
 *   seam. A module only declares `interactive`; the client adapter supplies the card,
 *   so this presentational module graph stays free of server actions and renders
 *   under `renderToStaticMarkup`.
 */
export interface ResultModule<K extends AssistantToolView["kind"]> {
  /** The `AssistantToolView` discriminant this module owns. */
  readonly kind: K;
  /**
   * The persisted tool outputs that project to this view kind, keyed by the tool
   * that produced them. Each parser validates the output against the shared domain
   * schema and maps it to the view, returning `null` on any shape that does not
   * match (so the dispatcher falls back to `generic`). Several tools can project to
   * one kind — a proposal and its later review read share a parser reference.
   */
  readonly parsers: Partial<Record<RenderedToolName, (output: unknown) => ViewOf<K> | null>>;
  /**
   * A well-formed *negative* outcome for this module's tools that fails the success
   * schema by design — a `found:false` review, a `created:false` draft — because the
   * schema pins a `found`/`created`/`updated` discriminant to `true`. Such a payload
   * is an honest "nothing happened", not corruption, so the dispatcher degrades it to
   * a neutral `generic` line carrying this plain `note` copy rather than the malformed
   * treatment. `matches` recognizes the negative shape; `note` is the honest wording.
   */
  readonly negativeOutcome?: {
    readonly matches: (output: unknown) => boolean;
    readonly note: string;
  };
  /** How much the user needs to notice this result (see {@link ToolViewTier}). */
  readonly tier: (view: ViewOf<K>) => ToolViewTier;
  /**
   * One plain sentence of what this result actually said, for the turn's
   * activity disclosure. A `line`-tier result renders inside that disclosure as
   * a step whose label is the past-tense *call* ("Recalled what you know"); this
   * is the half only the result knows ("Priya Shah · 1 confirmed · 3 logged").
   *
   * Plain text, never JSX: the disclosure sets its own type scale and colour, and
   * a step description that smuggled in a card's markup would reintroduce the
   * nested chrome the anatomy exists to remove. Return `null` when the label
   * already says everything — most saves do, and a description restating the
   * label is noise.
   *
   * Only consulted for `line`-tier views; a card or disclosure renders in full
   * below the answer and has nothing to summarize.
   */
  readonly summary?: (view: ViewOf<K>) => string | null;
  /** Refresh-stable React key, derived from the persisted records the view references. */
  readonly key: (view: ViewOf<K>) => string;
  /** Same-kind durable saves in one turn fold into a collapsed group when set. */
  readonly groupable?: boolean;
  /** The kind carries an inline action affordance rendered at the client seam. */
  readonly interactive?: boolean;
  /**
   * Read-only presentational render (line / card / disclosure). Absent for
   * interactive-only kinds, whose client card at the turn-unit seam owns their
   * rendering; `AssistantToolResult` then renders nothing for them.
   */
  readonly render?: (view: ViewOf<K>, isNew: boolean) => ReactNode;
}

/** The `AssistantToolView` variant a module of kind `K` operates on. */
export type ViewOf<K extends AssistantToolView["kind"]> = Extract<AssistantToolView, { kind: K }>;

/**
 * Identity helper for defining a module with full per-kind inference. Keeps each
 * module strongly typed to its own view variant at the definition site, so a
 * projector, tier, key, or renderer can reference the view's fields without casts.
 */
export function defineModule<K extends AssistantToolView["kind"]>(
  module: ResultModule<K>,
): ResultModule<K> {
  return module;
}
