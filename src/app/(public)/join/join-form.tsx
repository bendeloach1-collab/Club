"use client";

import { useActionState, useState } from "react";
import { Field, Form, FormMessage, SubmitButton } from "@/components/forms";
import { enrollAction } from "./actions";

type Member = { firstName: string; lastName: string; dateOfBirth: string; relationship: "adult" | "dependent" };
type Doc = { kind: string; title: string; body: string; version: number };

export function JoinForm({ plan, idempotencyKey, docs, totalLabel }: { plan: { code: string; name: string; maxAdults: number; maxDependents: number }; idempotencyKey: string; docs: Doc[]; totalLabel: string }) {
  const [state, action, pending] = useActionState(enrollAction, undefined);
  const [members, setMembers] = useState<Member[]>([]);
  const fe = state?.fieldErrors ?? {};
  const adults = 1 + members.filter((m) => m.relationship === "adult").length;
  const dependents = members.filter((m) => m.relationship === "dependent").length;
  const canAddAdult = adults < plan.maxAdults;
  const canAddDependent = dependents < plan.maxDependents;
  const update = (i: number, patch: Partial<Member>) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const agreement = docs.find((d) => d.kind === "membership_agreement");
  const waiver = docs.find((d) => d.kind === "liability_waiver");

  return (
    <Form dispatch={action} pending={pending} className="space-y-8" noValidate>
      <input type="hidden" name="planCode" value={plan.code} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="additionalMembers" value={JSON.stringify(members)} />

      <fieldset className="card space-y-4">
        <legend className="float-left mb-2 w-full text-lg font-semibold">Primary member</legend>
        <div className="grid clear-both gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" error={fe["primary.firstName"]}><input className="input" id="firstName" name="firstName" autoComplete="given-name" required /></Field>
          <Field label="Last name" name="lastName" error={fe["primary.lastName"]}><input className="input" id="lastName" name="lastName" autoComplete="family-name" required /></Field>
          <Field label="Email" name="email" error={fe["primary.email"]} hint="This will be your login."><input className="input" id="email" name="email" type="email" autoComplete="email" required /></Field>
          <Field label="Mobile phone" name="phone" error={fe["primary.phone"]}><input className="input" id="phone" name="phone" type="tel" autoComplete="tel" required /></Field>
          <Field label="Date of birth" name="dateOfBirth" error={fe["primary.dateOfBirth"]}><input className="input" id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday" required /></Field>
          <Field label="Create a password" name="password" error={fe["primary.password"]} hint="At least 10 characters."><input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        </div>
      </fieldset>

      {plan.maxAdults > 1 || plan.maxDependents > 0 ? (
        <fieldset className="card space-y-4">
          <legend className="float-left mb-1 w-full text-lg font-semibold">Household members</legend>
          <p className="clear-both text-sm text-ink-500">{plan.name} covers up to {plan.maxAdults} adult{plan.maxAdults > 1 ? "s" : ""}{plan.maxDependents ? ` and ${plan.maxDependents} dependents` : ""}. You can also add people later.</p>
          {members.map((m, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <div><label className="label" htmlFor={`m${i}f`}>First name ({m.relationship})</label><input id={`m${i}f`} className="input" value={m.firstName} onChange={(e) => update(i, { firstName: e.target.value })} /></div>
              <div><label className="label" htmlFor={`m${i}l`}>Last name</label><input id={`m${i}l`} className="input" value={m.lastName} onChange={(e) => update(i, { lastName: e.target.value })} /></div>
              <div><label className="label" htmlFor={`m${i}d`}>Date of birth</label><input id={`m${i}d`} type="date" className="input" value={m.dateOfBirth} onChange={(e) => update(i, { dateOfBirth: e.target.value })} /></div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))} aria-label={`Remove ${m.firstName || "member"}`}>Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {canAddAdult ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMembers((ms) => [...ms, { firstName: "", lastName: "", dateOfBirth: "", relationship: "adult" }])}>+ Add adult</button> : null}
            {canAddDependent ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMembers((ms) => [...ms, { firstName: "", lastName: "", dateOfBirth: "", relationship: "dependent" }])}>+ Add dependent</button> : null}
          </div>
          {Object.entries(fe).filter(([k]) => k.startsWith("additionalMembers")).length > 0 ? <p className="text-xs font-medium text-red-700">Please complete name and date of birth for each household member.</p> : null}
        </fieldset>
      ) : null}

      <fieldset className="card space-y-4">
        <legend className="float-left mb-1 w-full text-lg font-semibold">Agreements</legend>
        {[agreement, waiver].map((d) =>
          d ? (
            <details key={d.kind} className="clear-both rounded-lg border border-line p-3 text-sm">
              <summary className="cursor-pointer font-semibold">{d.title} (version {d.version})</summary>
              <p className="mt-2 whitespace-pre-line text-ink-500">{d.body}</p>
            </details>
          ) : null,
        )}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="acceptAgreement" className="mt-1 h-4 w-4" required /><span>I have read and accept the Membership Agreement.{fe["acceptAgreement"] ? <span className="block font-medium text-red-700">{fe["acceptAgreement"]}</span> : null}</span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="acceptWaiver" className="mt-1 h-4 w-4" required /><span>I accept the Liability Waiver for myself and for any dependents listed above.{fe["acceptWaiver"] ? <span className="block font-medium text-red-700">{fe["acceptWaiver"]}</span> : null}</span></label>
        <div className="border-t border-line pt-4">
          <p className="text-sm font-semibold">Optional: club news and offers</p>
          <p className="text-xs text-ink-500">Account and booking notices are always sent. Marketing messages are only sent if you opt in, and you can opt out at any time.</p>
          <label className="mt-2 flex items-center gap-3 text-sm"><input type="checkbox" name="marketingEmailOptIn" className="h-4 w-4" />Email me club news and offers</label>
          <label className="mt-1 flex items-center gap-3 text-sm"><input type="checkbox" name="marketingSmsOptIn" className="h-4 w-4" />Text me club news and offers</label>
        </div>
      </fieldset>

      <FormMessage state={state} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Due today: <span className="font-semibold text-ink-950">{totalLabel}</span>. Your membership starts when payment is confirmed.</p>
        <SubmitButton pendingLabel="Creating your membership…">Continue to secure payment</SubmitButton>
      </div>
    </Form>
  );
}
