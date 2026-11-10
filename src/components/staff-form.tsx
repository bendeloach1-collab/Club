"use client";

import { useActionState, type ReactNode } from "react";
import { Form, FormMessage, SubmitButton } from "@/components/forms";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Generic server-action form with pending, success and error states. */
export function ActionForm({ action, children, submitLabel, pendingLabel, className = "space-y-3", buttonClass = "btn btn-primary btn-sm", hidden = {}, confirmText, resetOnSuccess = true }: { action: Action; children?: ReactNode; submitLabel: string; pendingLabel?: string; className?: string; buttonClass?: string; hidden?: Record<string, string>; confirmText?: string; resetOnSuccess?: boolean }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <Form dispatch={formAction} pending={pending} className={className} key={resetOnSuccess && state?.ok ? state.message : undefined} confirmText={confirmText}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <FormMessage state={state} />
      <SubmitButton className={buttonClass} pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
    </Form>
  );
}
