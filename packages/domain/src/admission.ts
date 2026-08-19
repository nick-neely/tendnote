import { z } from "zod";
import { normalizeInvitationEmail } from "./household-invitations";

const admissionModeSchema = z.enum(["hosted", "self-hosted"]);
const bootstrapOwnerEmailSchema = z.email();

export type AdmissionMode = z.infer<typeof admissionModeSchema>;

export type AdmissionConfigurationDiagnostic =
  | { code: "invalid_mode" }
  | { code: "missing_bootstrap_owner_email" }
  | { code: "invalid_bootstrap_owner_email" };

export type AdmissionPolicy =
  | { mode: "hosted"; valid: true }
  | { mode: "self-hosted"; valid: true; bootstrapOwnerEmail: string }
  | { mode: "invalid"; valid: false; diagnostic: AdmissionConfigurationDiagnostic };

export type AdmissionEnvironment = {
  TENDNOTE_ADMISSION_MODE?: string;
  TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL?: string;
  [key: string]: string | undefined;
};

/**
 * Parse the server-only admission contract. An absent mode is the hosted
 * default; every configured value is otherwise explicit and invalid values
 * produce a policy that can only refuse admission.
 */
export function parseAdmissionPolicy(env: AdmissionEnvironment = process.env): AdmissionPolicy {
  const rawMode = env.TENDNOTE_ADMISSION_MODE;
  if (rawMode === undefined) {
    return { mode: "hosted", valid: true };
  }

  const mode = admissionModeSchema.safeParse(rawMode.trim());
  if (!mode.success) {
    return { mode: "invalid", valid: false, diagnostic: { code: "invalid_mode" } };
  }

  if (mode.data === "hosted") {
    return { mode: "hosted", valid: true };
  }

  const configuredEmail = env.TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL;
  if (configuredEmail === undefined || configuredEmail.trim() === "") {
    return {
      mode: "invalid",
      valid: false,
      diagnostic: { code: "missing_bootstrap_owner_email" },
    };
  }

  const normalizedEmail = normalizeInvitationEmail(configuredEmail);
  if (!bootstrapOwnerEmailSchema.safeParse(normalizedEmail).success) {
    return {
      mode: "invalid",
      valid: false,
      diagnostic: { code: "invalid_bootstrap_owner_email" },
    };
  }

  return { mode: "self-hosted", valid: true, bootstrapOwnerEmail: normalizedEmail };
}
