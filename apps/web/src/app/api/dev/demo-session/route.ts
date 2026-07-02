import { ensureAccessProfile } from "@tendnote/db/queries/access-profiles";
import { serializeSignedCookie } from "better-call";
import { localFallbackOwnerUserId } from "@/lib/access/access-state";
import { getAuth } from "@/lib/auth/server";

const LOCAL_DEMO_EMAIL_DOMAIN = "local.tendnote.dev";

export async function POST() {
  const ownerUserId = localFallbackOwnerUserId({
    nodeEnv: process.env.NODE_ENV,
    devOwnerUserId: process.env.TENDNOTE_DEV_OWNER_USER_ID,
  });

  if (!ownerUserId) {
    return new Response(null, { status: 404 });
  }

  const auth = getAuth();
  const context = await auth.$context;
  const user =
    (await context.internalAdapter.findUserById(ownerUserId)) ??
    (await context.internalAdapter.createUser({
      id: ownerUserId,
      email: localDemoEmail(ownerUserId),
      name: "Local development",
      emailVerified: true,
    }));

  await ensureAccessProfile({ userId: user.id });

  const session = await context.internalAdapter.createSession(user.id);
  const cookie = await serializeSignedCookie(
    context.authCookies.sessionToken.name,
    session.token,
    context.secret,
    {
      ...context.authCookies.sessionToken.attributes,
      maxAge: context.sessionConfig.expiresIn,
    },
  );

  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": cookie,
    },
  });
}

function localDemoEmail(ownerUserId: string) {
  const localPart = ownerUserId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "demo-user";
  return `${localPart}@${LOCAL_DEMO_EMAIL_DOMAIN}`;
}
