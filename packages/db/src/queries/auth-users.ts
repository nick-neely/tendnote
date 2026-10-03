import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { user } from "../schema";

export async function updateAuthUserEmail({ email, userId }: { email: string; userId: string }) {
  await getDb().update(user).set({ email, emailVerified: true }).where(eq(user.id, userId));
}

/** The account's email address, or `null` once the account is gone. */
export async function getAuthUserEmail({ userId }: { userId: string }): Promise<string | null> {
  const [row] = await getDb()
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.email ?? null;
}
