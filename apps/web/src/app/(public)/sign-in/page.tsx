import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { GUEST_PATH, REACCEPTANCE_PATH } from "@/lib/access/access-state";
import { getCurrentAccess } from "@/lib/access/current-access";
import { safeReturnTo } from "@/lib/auth/return-to";
import { githubEnvFromProcess, isGithubConfigured } from "@/lib/auth/social";

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

// fallow-ignore-next-line complexity -- The existing auth state flow moved unchanged beneath the URL-transparent public loading boundary; #334 changes boundary ownership, not this page.
export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string }>;
}) {
  if (process.env.NODE_ENV !== "test") await connection();
  const access = await getCurrentAccess();
  const requestedReturnTo = (await searchParams)?.returnTo;
  const returnTo = safeReturnTo(requestedReturnTo);
  const copy = signInCopy(Boolean(requestedReturnTo));

  if (access.state === "reacceptance") {
    redirect(REACCEPTANCE_PATH);
  }

  if (access.state === "admitted") {
    redirect(returnTo);
  }

  if (access.state === "pending") {
    redirect("/pending");
  }

  if (access.state === "guest") {
    redirect(GUEST_PATH);
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
