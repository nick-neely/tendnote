import { redirect } from "next/navigation";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { getCurrentAccess } from "@/lib/access/current-access";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const access = await getCurrentAccess();

  if (access.state === "admitted") {
    redirect("/");
  }

  if (access.state === "pending") {
    redirect("/pending");
  }

  return (
    <AuthScaffold title="Welcome back" subtitle="Sign in to your private Tendnote.">
      <CredentialsForm mode="sign-in" />
    </AuthScaffold>
  );
}
