import { redirect } from "next/navigation";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { getCurrentAccess } from "@/lib/access/current-access";
import { safeReturnTo } from "@/lib/auth/return-to";
import { githubEnvFromProcess, isGithubConfigured } from "@/lib/auth/social";

export const dynamic = "force-dynamic";

function signInCopy(returningToApp: boolean) {
  if (returningToApp) {
    return {
      title: "Your session expired",
      subtitle:
        "Sign in again to return to what you were opening. Nothing was submitted while signed out.",
    };
  }
  return { title: "Welcome back", subtitle: "Sign in to your private Tendnote." };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string }>;
}) {
  const access = await getCurrentAccess();
  const requestedReturnTo = (await searchParams)?.returnTo;
  const returnTo = safeReturnTo(requestedReturnTo);
  const copy = signInCopy(Boolean(requestedReturnTo));

  if (access.state === "admitted") {
    redirect(returnTo);
  }

  if (access.state === "pending") {
    redirect("/pending");
  }

  return (
    <AuthScaffold title={copy.title} subtitle={copy.subtitle}>
      <CredentialsForm
        githubEnabled={isGithubConfigured(githubEnvFromProcess())}
        mode="sign-in"
        returnTo={returnTo}
      />
    </AuthScaffold>
  );
}
