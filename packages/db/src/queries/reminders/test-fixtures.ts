import { checkPushEndpointDestination } from "./push-endpoint";
import { createReminderService } from "./service";

/**
 * Synthetic reminder lifecycle tests must not ask the machine's DNS resolver
 * about .test hosts. Keep the production URL, allowlist and address checks;
 * substitute only the DNS answer for their fake push service. Security cases
 * keep their explicitly injected lookups in push-endpoint.test.ts.
 */
export function createReminderTestService(input: Parameters<typeof createReminderService>[0]) {
  return createReminderService({
    ...input,
    checkPushEndpoint:
      input.checkPushEndpoint ??
      ((endpoint) =>
        checkPushEndpointDestination(endpoint, {
          lookup: async (host) => {
            if (host !== "push.example.test")
              throw new Error("No DNS fixture for this synthetic push host");
            return [{ address: "93.184.216.34", family: 4 }];
          },
        })),
  });
}
