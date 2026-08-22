import { defineHook } from "eve/hooks";
import { currentTurnMessage } from "../lib/current-turn-message";

export default defineHook({
  events: {
    "message.received"(event, ctx) {
      const caller = ctx.session.auth.current;
      const isAuthenticatedOwnerTurn =
        !ctx.session.parent && caller?.principalType === "user" && caller.principalId.trim() !== "";
      currentTurnMessage.update(() => ({
        turnId: event.data.turnId,
        message: isAuthenticatedOwnerTurn ? event.data.message.trim() || null : null,
      }));
    },
  },
});
