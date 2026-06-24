import { getAuth } from "@/lib/auth/server";

async function handler(request: Request) {
  const auth = getAuth();

  return auth.handler(request);
}

export { handler as GET, handler as POST };
