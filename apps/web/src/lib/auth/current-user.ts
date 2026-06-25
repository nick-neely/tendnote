import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/server";

const localDemoOwnerUserId = "demo-user";

export async function getCurrentOwnerUserId() {
  let session: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>> | null = null;

  try {
    session = await getAuth().api.getSession({
      headers: await headers(),
    });
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
  }

  if (session?.user.id) {
    return session.user.id;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("A signed-in user is required.");
  }

  return process.env.TENDNOTE_DEV_OWNER_USER_ID ?? localDemoOwnerUserId;
}
