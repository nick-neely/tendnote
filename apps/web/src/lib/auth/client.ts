import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. The base path matches the same-origin Better Auth route
 * at /api/auth, so sign-up/sign-in/sign-out post there and the server sets the
 * session cookie. Used only by client components (forms, sign-out controls).
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
