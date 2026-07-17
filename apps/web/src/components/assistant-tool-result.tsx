import { renderResultModule } from "@/components/assistant-results/registry";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";

/**
 * Renders one persisted Eve tool result at the presentational tier its result
 * module chooses (see the result-module registry):
 *
 * - **line** — ambient lookups (a search, a recall) recede to a quiet inline row
 *   with no card chrome, so a turn's housekeeping reads like a margin note.
 * - **card** — durable, trust-bearing state changes (saved memory, added person,
 *   logged note) keep the Field Notebook card and its trust-weighted treatment.
 *   Tentative and logged context are never shown with the confirmed-fact treatment
 *   (ADR 0004, ADR 0029).
 * - **disclosure** — a non-empty result set collapses behind a one-line summary.
 *
 * This dispatcher holds no per-kind policy: it defers entirely to the owning
 * module. Interactive-only kinds (an editable draft, a review card) have no
 * presentational render and are routed to their client card at the turn-unit seam,
 * so this module stays free of the client editor and the `server-only` actions
 * those cards need; for such a kind it renders nothing.
 */
export function AssistantToolResult({
  view,
  isNew = false,
}: {
  view: AssistantToolView;
  isNew?: boolean;
}) {
  return renderResultModule(view, isNew);
}
