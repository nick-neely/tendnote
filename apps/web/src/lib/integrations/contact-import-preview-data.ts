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
import { googleEnvFromProcess, isGoogleConfigured } from "@/lib/auth/social";
import { findLinkedAccountRowId } from "@/lib/integrations/linked-accounts";

/**
 * Owner-scoped Contacts import preview data for Phase 2E #130. This is
 * fixture-backed provider data for the first end-to-end preview path; the shared
 * service returns ephemeral candidate rows and performs no relationship writes.
 *
 * The review UI is a client-side data table that pages, sorts, and filters the
 * full candidate set locally, so we request every candidate (matching the apply
 * path's limit) rather than the default per-bucket preview cap. No `query` is
 * passed — filtering happens in the table, not via a server round-trip.
 */
export async function getOwnerContactImportPreview(
  ownerUserId: string,
): Promise<ContactImportPreviewSession> {
  return createContactImportPreviewSession(
    { ownerUserId, limit: 200 },
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
      const auth = getAuth();
      const accountId = await findLinkedAccountRowId(auth, requestHeaders, "google");
      const token = accountId
        ? await auth.api.getAccessToken({ body: { accountId }, headers: requestHeaders })
        : null;
      const accessToken = (token as { accessToken?: string } | null)?.accessToken;
      if (!accessToken) {
        throw new Error("No Google access token available.");
      }
      return accessToken;
    },
  });
}
