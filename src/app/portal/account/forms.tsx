"use client";

import { useActionState } from "react";
import { Form, FormMessage, SubmitButton } from "@/components/forms";
import { payBalanceAction, resumeCheckoutAction, retryEnrollmentAction } from "./actions";

export function PayBalanceForm({ householdId, idempotencyKey, label }: { householdId: string; idempotencyKey: string; label: string }) {
  const [state, action, pending] = useActionState(payBalanceAction, undefined);
  return (
    <Form dispatch={action} pending={pending} className="space-y-2">
      <input type="hidden" name="householdId" value={householdId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <SubmitButton className="btn btn-accent" pendingLabel="Opening secure payment…">{label}</SubmitButton>
      <FormMessage state={state} />
    </Form>
  );
}

export function RetryEnrollmentForm({ membershipId }: { membershipId: string }) {
  const [state, action, pending] = useActionState(retryEnrollmentAction, undefined);
  return (
    <Form dispatch={action} pending={pending} className="space-y-2">
      <input type="hidden" name="membershipId" value={membershipId} />
      <SubmitButton className="btn btn-accent" pendingLabel="Opening secure payment…">Complete enrollment payment</SubmitButton>
      <FormMessage state={state} />
    </Form>
  );
}

export function ResumeCheckoutForm({ paymentId, label = "Continue to secure payment" }: { paymentId: string; label?: string }) {
  const [state, action, pending] = useActionState(resumeCheckoutAction, undefined);
  return (
    <Form dispatch={action} pending={pending} className="space-y-2">
      <input type="hidden" name="paymentId" value={paymentId} />
      <SubmitButton className="btn btn-accent" pendingLabel="Opening secure payment…">{label}</SubmitButton>
      <FormMessage state={state} />
    </Form>
  );
}
