import { notifyNewSupportEmail } from "@/lib/operator-alerts/pass";
import { createSupportEmailWebhookHandler } from "@/lib/operator-alerts/support-email-webhook";

export async function POST(request: Request) {
  const handleSupportEmailWebhook = createSupportEmailWebhookHandler({
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    notifyNewSupportEmail,
  });
  return handleSupportEmailWebhook(request);
}
