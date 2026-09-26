import { createResendSender } from "./resend";
import {
  decideTransactionalTransport,
  operatorLogSender,
  resolveSenderIdentity,
  type TransactionalSender,
  unavailableSender,
} from "./transactional";

/**
 * The transport this deployment gets, for every kind of transactional email.
 *
 * Called per send rather than at import time: a module-level client would be
 * built during the build, before the deployment's secrets exist.
 */
export function selectTransactionalSender(): TransactionalSender {
  const choice = decideTransactionalTransport(process.env);

  switch (choice.kind) {
    case "resend":
      return createResendSender({
        apiKey: choice.apiKey,
        identity: resolveSenderIdentity(process.env),
      });
    case "unavailable":
      return unavailableSender(choice.reason);
    default:
      return operatorLogSender;
  }
}
