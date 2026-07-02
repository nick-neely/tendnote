import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

export default defineEval({
  description: "Pending-access users are denied before a normal Eve assistant session is opened.",
  tags: ["deterministic", "policy", "hosted-access"],
  async test(t) {
    const pendingAccessDecision = {
      ingress: "denied",
      reason: "pending",
      opensEveSession: false,
    };

    t.check(
      pendingAccessDecision,
      equals({
        ingress: "denied",
        reason: "pending",
        opensEveSession: false,
      }),
    );
    t.usedNoTools();
    t.notEvent("session.started");
  },
});
