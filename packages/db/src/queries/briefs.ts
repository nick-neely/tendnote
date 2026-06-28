import { createDrizzleBriefStore } from "./briefs/drizzle-store";
import type { GenerateBriefInput } from "./briefs/generator";
import { createBriefGenerator } from "./briefs/generator";
import { getRelationshipAgenda } from "./relationship-agenda";

export {
  createDrizzleBriefLifecycleStore,
  createDrizzleBriefStore,
} from "./briefs/drizzle-store";
export {
  type BriefAgendaSource,
  createBriefGenerator,
  type GenerateBriefInput,
} from "./briefs/generator";
export {
  createInMemoryBriefLifecycleStore,
  createInMemoryBriefStore,
} from "./briefs/in-memory-store";
export {
  type BriefItemActionInput,
  createBriefLifecycle,
  type SnoozeBriefItemInput,
} from "./briefs/lifecycle";
export type * from "./briefs/types";

// Production wiring lives in the barrel (mirroring relationship-agenda.ts): the
// generator builder stays a pure DI seam, and the composed default reads the
// drizzle brief store and the drizzle relationship agenda. Schedule dispatch
// (#72) and the manual web action (#69) call this shared default so they cannot
// fork generator behavior.
const defaultBriefGenerator = createBriefGenerator(createDrizzleBriefStore(), {
  getRelationshipAgenda,
});

export function generateBrief(input: GenerateBriefInput) {
  return defaultBriefGenerator.generateBrief(input);
}
