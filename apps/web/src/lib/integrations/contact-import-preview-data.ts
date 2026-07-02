import "server-only";

import { findOwnerContactMethodDuplicates } from "@tendnote/db/queries/contact-methods";
import {
  type ContactImportPreviewAdapter,
  type ContactImportPreviewSession,
  createContactImportPreviewSession,
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
  createGoogleContactsAdapter,
} from "@tendnote/db/queries/contacts-import-preview";
import { getPerson, searchPeople } from "@tendnote/db/queries/people";
import { isProviderCapabilityConnected } from "@tendnote/db/queries/provider-connections";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { googleEnvFromProcess, isGoogleConfigured } from "@/lib/auth/social";

/**
 * Owner-scoped Contacts import preview data for Phase 2E #130. This is
 * fixture-backed provider data for the first end-to-end preview path; the shared
 * service returns ephemeral candidate rows and performs no relationship writes.
 */
export async function getOwnerContactImportPreview(input: {
  query?: string;
}): Promise<ContactImportPreviewSession> {
  const ownerUserId = await requireAdmittedOwner();
  return createContactImportPreviewSession(
    { ownerUserId, query: input.query },
    {
      adapter: await createOwnerContactImportAdapter(),
      fuzzyMatcher: createFakeContactImportFuzzyMatcher(),
      isProviderCapabilityConnected,
      searchPeople,
      getPerson,
      findOwnerContactMethodDuplicates,
    },
  );
}

export async function createOwnerContactImportAdapter(
  input: { allowFixture?: boolean } = {},
): Promise<ContactImportPreviewAdapter> {
  if (!isGoogleConfigured(googleEnvFromProcess())) {
    if (input.allowFixture === false) {
      return {
        async fetchContacts() {
          throw new Error("Google Contacts is not configured for live import.");
        },
      };
    }
    return createFakeContactImportPreviewAdapter();
  }

  const [{ getAuth }, { headers }] = await Promise.all([
    import("@/lib/auth/server"),
    import("next/headers"),
  ]);
  const requestHeaders = await headers();

  return createGoogleContactsAdapter({
    getAccessToken: async () => {
      const token = await getAuth().api.getAccessToken({
        body: { providerId: "google" },
        headers: requestHeaders,
      });
      const accessToken = (token as { accessToken?: string } | null)?.accessToken;
      if (!accessToken) {
        throw new Error("No Google access token available.");
      }
      return accessToken;
    },
  });
}
