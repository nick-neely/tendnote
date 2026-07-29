import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthScaffold
      title="Reset your password"
      subtitle="Enter your email and we'll send a link to choose a new password."
    >
      <ForgotPasswordForm />
    </AuthScaffold>
  );
}
