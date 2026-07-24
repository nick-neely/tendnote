import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { getCurrentAccess } from "@/lib/access/current-access";
import { githubEnvFromProcess, isGithubConfigured } from "@/lib/auth/social";

export default async function SignUpPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const access = await getCurrentAccess();

  if (access.state === "admitted") {
    redirect("/");
  }

  if (access.state === "pending") {
    redirect("/pending");
  }

  return (
    <AuthScaffold
      title="Create your account"
      subtitle="Tendnote is in private beta. Create your account now, and you'll come straight in once access is granted. No second signup."
    >
      <CredentialsForm githubEnabled={isGithubConfigured(githubEnvFromProcess())} mode="sign-up" />
    </AuthScaffold>
  );
}
