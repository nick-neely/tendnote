import { ensureAccessProfile } from "@tendnote/db/queries/access-profiles";
import { updateAuthUserEmail } from "@tendnote/db/queries/auth-users";
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
  const email = localDemoEmail(ownerUserId, process.env.TENDNOTE_DEV_OWNER_EMAIL);
  const existingUser = await context.internalAdapter.findUserById(ownerUserId);
  const user = existingUser
    ? await syncLocalDemoEmail(existingUser, email)
    : await context.internalAdapter.createUser({
        id: ownerUserId,
        email,
        name: "Local development",
        emailVerified: true,
      });

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

type LocalDemoUser = {
  id: string;
  email?: string | null;
};

async function syncLocalDemoEmail<TUser extends LocalDemoUser>(user: TUser, email: string) {
  if (user.email === email) {
    return user;
  }

  await updateAuthUserEmail({ email, userId: user.id });
  return { ...user, email, emailVerified: true };
}

function localDemoEmail(ownerUserId: string, configuredEmail?: string) {
  const trimmedEmail = configuredEmail?.trim();
  if (trimmedEmail) {
    return trimmedEmail;
  }

  const localPart = ownerUserId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "demo-user";
  return `${localPart}@${LOCAL_DEMO_EMAIL_DOMAIN}`;
}
