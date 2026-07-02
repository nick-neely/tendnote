import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { user } from "../schema";

export async function updateAuthUserEmail({ email, userId }: { email: string; userId: string }) {
  await getDb().update(user).set({ email, emailVerified: true }).where(eq(user.id, userId));
}
