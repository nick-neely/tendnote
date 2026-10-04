import { parseAdmissionPolicy } from "@tendnote/domain/admission";
import { CURRENT_LEGAL_DOCUMENTS } from "@tendnote/domain/legal-documents";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { signedInHome } from "@/lib/access/access-state";
import { getCurrentAccess } from "@/lib/access/current-access";
import { githubEnvFromProcess, isGithubConfigured } from "@/lib/auth/social";
import { legalDocumentUrl } from "@/lib/public-links";

/**
 * The documents a hosted account accepts at creation (#613). A self-hosted
 * deployment has no hosted Terms, so it shows no clickwrap at all.
 */
function hostedClickwrapDocuments() {
  if (parseAdmissionPolicy(process.env).mode !== "hosted") return undefined;
  return CURRENT_LEGAL_DOCUMENTS.map((doc) => ({
    key: doc.key,
    title: doc.title,
    version: doc.version,
    href: legalDocumentUrl(doc),
  }));
}

export default async function SignUpPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const access = await getCurrentAccess();

  // A signed-in account already has a home: the app, or its own area.
  if (access.state !== "unauthenticated") {
    redirect(signedInHome(access));
  }

  return (
    <AuthScaffold
      title="Create your account"
      subtitle="Tendnote is in private beta. Create your account now, and you'll come straight in once access is granted. No second signup."
    >
      <CredentialsForm
        clickwrap={hostedClickwrapDocuments()}
        githubEnabled={isGithubConfigured(githubEnvFromProcess())}
        mode="sign-up"
      />
    </AuthScaffold>
  );
}
