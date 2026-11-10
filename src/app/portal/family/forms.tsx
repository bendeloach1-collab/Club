"use client";

import { useActionState } from "react";
import { Form, FormMessage, SubmitButton } from "@/components/forms";
import { adultLoginAction, permissionsAction } from "./actions";

type Perm = { householdId: string; personId: string; firstName: string; canBookForHousehold: boolean; canManageBilling: boolean; canChargeAccount: boolean; chargeLimitCents: number | null };

export function PermissionsForm({ p }: { p: Perm }) {
  const [state, action, pending] = useActionState(permissionsAction, undefined);
  const id = (s: string) => `${s}-${p.personId}`;
  return (
    <Form dispatch={action} pending={pending} className="mt-3 space-y-2 border-t border-line pt-3">
      <input type="hidden" name="householdId" value={p.householdId} />
      <input type="hidden" name="personId" value={p.personId} />
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Permissions for {p.firstName}</p>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="canBookForHousehold" defaultChecked={p.canBookForHousehold} className="h-4 w-4" />Book for other household members</label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="canManageBilling" defaultChecked={p.canManageBilling} className="h-4 w-4" />View statements and make payments</label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="canChargeAccount" defaultChecked={p.canChargeAccount} className="h-4 w-4" />Charge to the club account</label>
      <div className="max-w-48">
        <label className="label" htmlFor={id("limit")}>Per-charge limit (USD, optional)</label>
        <input className="input" id={id("limit")} name="chargeLimit" inputMode="decimal" defaultValue={p.chargeLimitCents === null ? "" : (p.chargeLimitCents / 100).toFixed(2)} />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Saving…">Save permissions</SubmitButton>
    </Form>
  );
}

export function AdultLoginForm({ householdId, personId, firstName }: { householdId: string; personId: string; firstName: string }) {
  const [state, action, pending] = useActionState(adultLoginAction, undefined);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <details className="mt-3 border-t border-line pt-3 text-sm">
      <summary className="cursor-pointer font-semibold text-brass-700">Create a login for {firstName}</summary>
      <Form dispatch={action} pending={pending} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="personId" value={personId} />
        <div><label className="label" htmlFor={`e-${personId}`}>Their email</label><input className="input" id={`e-${personId}`} name="email" type="email" required /></div>
        <div><label className="label" htmlFor={`p-${personId}`}>Temporary password</label><input className="input" id={`p-${personId}`} name="password" type="text" minLength={10} required autoComplete="off" /></div>
        <div className="sm:col-span-2"><FormMessage state={state} /></div>
        <div><SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Creating…">Create login</SubmitButton></div>
      </Form>
    </details>
  );
}
