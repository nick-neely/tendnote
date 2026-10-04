import { blobEffectFences } from "@tendnote/db/queries/effect-fences";
import { isOutboundPaused } from "@tendnote/db/queries/outbound-pause";
import { isRestoredEmailFenced } from "@tendnote/db/queries/restored-email-fences";
import { createResendSender } from "./resend";
import {
  decideTransactionalTransport,
  fenceDeliveredEmail,
  holdForRestore,
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
 * send is fenced and held for a restore (#623); the operator log sends nothing
 * a restore could repeat or a pause must stop.
 */
export function selectTransactionalSender(): TransactionalSender {
  const choice = decideTransactionalTransport(process.env);

  switch (choice.kind) {
    case "resend":
      return holdForRestore(
        fenceDeliveredEmail(
          createResendSender({
            apiKey: choice.apiKey,
            identity: resolveSenderIdentity(process.env),
          }),
          blobEffectFences,
        ),
        restoreHold,
      );
    case "unavailable":
      return unavailableSender(choice.reason);
    default:
      return operatorLogSender;
  }
}

const restoreHold = { isPaused: isOutboundPaused, isFenced: isRestoredEmailFenced };
