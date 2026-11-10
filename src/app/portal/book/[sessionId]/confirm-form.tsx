"use client";

import { useActionState } from "react";
import { Form, FormMessage, SubmitButton } from "@/components/forms";
import { bookAction } from "./actions";

const LABELS = { included: "Included with membership", pay_now: "Pay now by card or bank", club_account: "Charge to club account" } as const;

export function ConfirmForm(props: { sessionId: string; participantPersonId: string; policyVersion: number; priceCents: number; priceLabel: string; options: (keyof typeof LABELS)[]; idempotencyKey: string; termsSummary: string }) {
  const [state, action, pending] = useActionState(bookAction, undefined);
  return (
    <Form dispatch={action} pending={pending} className="space-y-4">
      <input type="hidden" name="sessionId" value={props.sessionId} />
      <input type="hidden" name="participantPersonId" value={props.participantPersonId} />
      <input type="hidden" name="acceptedPolicyVersion" value={props.policyVersion} />
      <input type="hidden" name="acceptedPriceCents" value={props.priceCents} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <fieldset>
        <legend className="label">Payment</legend>
        <div className="space-y-2">
          {props.options.map((o, i) => (
            <label key={o} className="flex items-center gap-3 rounded-lg border border-line bg-white p-3 text-sm has-[:checked]:border-brass-600 has-[:checked]:bg-brass-100/40">
              <input type="radio" name="paymentMethod" value={o} defaultChecked={i === 0} className="h-4 w-4" />
              <span className="font-medium">{LABELS[o]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="rounded-lg bg-paper p-3 text-sm">
        <p className="font-semibold">Price: {props.priceLabel}</p>
        <p className="mt-1 text-ink-500">{props.termsSummary}</p>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Confirming…" className="btn btn-primary w-full sm:w-auto">{props.priceCents > 0 ? `Confirm and pay ${props.priceLabel}` : "Confirm booking"}</SubmitButton>
      <p className="text-xs text-ink-500">By confirming you accept the price and cancellation terms shown above. They are saved with your booking.</p>
    </Form>
  );
}
