"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sandboxCheckouts } from "@/db/schema";
import { getPaymentProvider } from "@/modules/billing/providers";
import { SandboxProvider, type SandboxOutcome } from "@/modules/billing/providers/sandbox";

const OUTCOMES: SandboxOutcome[] = ["success", "decline", "delayed", "delayed_success", "delayed_failure", "cancel"];

export async function simulateAction(form: FormData) {
  const provider = getPaymentProvider();
  if (!(provider instanceof SandboxProvider)) throw new Error("Sandbox checkout is disabled");
  const id = String(form.get("checkoutId"));
  const outcome = String(form.get("outcome")) as SandboxOutcome;
  if (!OUTCOMES.includes(outcome)) throw new Error("Unknown outcome");
  await provider.simulate(id, outcome);
  const [c] = await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.id, id));
  if (outcome === "decline") redirect(`/sandbox/checkout/${id}?declined=1`);
  // Like a real processor, send the browser back; the app must verify state server-side.
  redirect(outcome === "cancel" ? c!.cancelUrl : c!.successUrl);
}
