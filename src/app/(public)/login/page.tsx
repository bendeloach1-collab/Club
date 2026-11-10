import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { getActor } from "@/lib/session";
import { getPaymentProvider } from "@/modules/billing/providers";
import { isStaff } from "@/modules/identity/actor";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getActor();
  if (actor) redirect(isStaff(actor) ? "/staff" : "/portal");
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <PageHeader eyebrow="Members & staff" title="Sign in" />
      <LoginForm next={next} />
      <p className="mt-4 text-sm text-ink-500">Not a member yet? <Link href="/membership" className="font-semibold text-brass-700 hover:underline">Join the club</Link>.</p>
      {getPaymentProvider().isSandbox ? (
        <div className="mt-6"><Alert tone="warning" title="Demo logins (synthetic data)">Password <code>ClubDemo!2026</code> — member@aac.test, solo@aac.test, admin@aac.test, sales@aac.test, frontdesk@aac.test, manager@aac.test, finance@aac.test, coach@aac.test</Alert></div>
      ) : null}
    </div>
  );
}
