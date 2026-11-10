import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Better Auth handles credentials, password hashing and session cookies.
 * Public self-sign-up is disabled: member logins are created by enrollment and staff
 * logins by administrators, so every account is tied to a known person.
 */
export const auth = betterAuth({
  baseURL: env.appUrl,
  secret: env.authSecret,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true },
  plugins: [nextCookies()],
});
