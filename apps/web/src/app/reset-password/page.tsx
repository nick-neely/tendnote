import Link from "next/link";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";
import { resolveResetToken } from "@/lib/auth/reset-token";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const state = resolveResetToken(params);

  if (state.state === "invalid") {
    return (
      <AuthScaffold
        title="This reset link isn't valid"
        subtitle="The link may have expired or already been used. Request a fresh one and try again."
      >
        <Button asChild className="w-full" size="lg">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold title="Choose a new password" subtitle="Set a new password for your account.">
      <ResetPasswordForm token={state.token} />
    </AuthScaffold>
  );
}
