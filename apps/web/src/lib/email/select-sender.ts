import { blobEffectFences } from "@tendnote/db/queries/effect-fences";
import { createResendSender } from "./resend";
import {
  decideTransactionalTransport,
  fenceDeliveredEmail,
  operatorLogSender,
  resolveSenderIdentity,
  type TransactionalSender,
  unavailableSender,
} from "./transactional";

/**
 * The transport this deployment gets, for every kind of transactional email.
 *
 * Called per send rather than at import time: a module-level client would be
 * built during the build, before the deployment's secrets exist. Every Resend
 * send is fenced; the operator log sends nothing a restore could repeat.
 */
export function selectTransactionalSender(): TransactionalSender {
  const choice = decideTransactionalTransport(process.env);

  switch (choice.kind) {
    case "resend":
      return fenceDeliveredEmail(
        createResendSender({
          apiKey: choice.apiKey,
          identity: resolveSenderIdentity(process.env),
        }),
        blobEffectFences,
      );
    case "unavailable":
      return unavailableSender(choice.reason);
    default:
      return operatorLogSender;
  }
}
