import { MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH } from "@tendnote/domain";
import { defineHook } from "eve/hooks";
import { enqueueAndPublishContextFactExtractionJob } from "../lib/background-jobs/context-fact-extraction-queue";
import { resolveAmbientContextFactOwner } from "../lib/context-fact-eligibility";

export const createAmbientContextFactHook = (
  enqueue: typeof enqueueAndPublishContextFactExtractionJob = enqueueAndPublishContextFactExtractionJob,
) =>
  defineHook({
    events: {
      "message.received"(event, ctx) {
        const message = event.data.message.trim();
        const ownerUserId = resolveAmbientContextFactOwner({
          auth: ctx.session.auth.current,
          parent: ctx.session.parent,
          message,
        });
        if (!ownerUserId) return;

        const boundedMessage = message.slice(0, MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH);
        const idempotencyKey = `eve:${ctx.session.id}:${event.data.turnId}`;

        // Hooks are part of the response path. The durable message is already accepted, so
        // queue/database/provider failures are intentionally swallowed and never fail or wait
        // on the Eve turn.
        try {
          void enqueue({
            ownerUserId,
            message: boundedMessage,
            idempotencyKey,
          }).catch(() => undefined);
        } catch {
          // A synchronous adapter failure is also best-effort.
        }
      },
    },
  });

export default createAmbientContextFactHook();
