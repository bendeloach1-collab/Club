"use client";

import { useActionState } from "react";
import { Field, Form, FormMessage, SubmitButton } from "@/components/forms";
import { inquireAction, tourAction } from "./lead-actions";

type Attribution = { utm_source?: string; utm_medium?: string; utm_campaign?: string; interest?: string };

function ContactFields({ fe, attribution }: { fe: Record<string, string>; attribution: Attribution }) {
  return (
    <>
      <input type="hidden" name="utm_source" value={attribution.utm_source ?? ""} />
      <input type="hidden" name="utm_medium" value={attribution.utm_medium ?? ""} />
      <input type="hidden" name="utm_campaign" value={attribution.utm_campaign ?? ""} />
      {/* Honeypot: hidden from people and assistive technology. */}
      <div className="hidden" aria-hidden="true"><label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name="firstName" error={fe.firstName}><input className="input" id="firstName" name="firstName" autoComplete="given-name" required /></Field>
        <Field label="Last name" name="lastName" error={fe.lastName}><input className="input" id="lastName" name="lastName" autoComplete="family-name" required /></Field>
        <Field label="Email" name="email" error={fe.email}><input className="input" id="email" name="email" type="email" autoComplete="email" /></Field>
        <Field label="Phone" name="phone" error={fe.phone} hint="Email or phone is required."><input className="input" id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
      </div>
      <Field label="I'm interested in" name="interest">
        <select className="input" id="interest" name="interest" defaultValue={attribution.interest ?? ""}>
          <option value="">Not sure yet</option>
          <option value="individual">Individual membership</option>
          <option value="couple">Couple membership</option>
          <option value="family">Family membership</option>
          <option value="corporate">Corporate membership</option>
        </select>
      </Field>
    </>
  );
}

function Consent() {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs text-ink-500">We&apos;ll contact you about this request. Marketing messages are optional:</p>
      <label className="mt-2 flex items-center gap-3 text-sm"><input type="checkbox" name="marketingEmailOptIn" className="h-4 w-4" />Email me club news and offers</label>
      <label className="mt-1 flex items-center gap-3 text-sm"><input type="checkbox" name="marketingSmsOptIn" className="h-4 w-4" />Text me club news and offers</label>
    </div>
  );
}

export function InquiryForm({ attribution }: { attribution: Attribution }) {
  const [state, action, pending] = useActionState(inquireAction, undefined);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <Form dispatch={action} pending={pending} className="card space-y-4" noValidate>
      <ContactFields fe={state?.fieldErrors ?? {}} attribution={attribution} />
      <Field label="How can we help?" name="message"><textarea className="input" id="message" name="message" rows={4} maxLength={2000} /></Field>
      <Consent />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Sending…">Send inquiry</SubmitButton>
    </Form>
  );
}

export function TourForm({ attribution, days }: { attribution: Attribution; days: { label: string; slots: { iso: string; label: string }[] }[] }) {
  const [state, action, pending] = useActionState(tourAction, undefined);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <Form dispatch={action} pending={pending} className="card space-y-4" noValidate>
      <input type="hidden" name="source" value="website_tour" />
      <Field label="Choose a time (Eastern Time)" name="scheduledAt">
        <select className="input" id="scheduledAt" name="scheduledAt" required defaultValue="">
          <option value="" disabled>Select a tour time</option>
          {days.map((d) => (
            <optgroup key={d.label} label={d.label}>
              {d.slots.map((s) => <option key={s.iso} value={s.iso}>{d.label} · {s.label}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <ContactFields fe={state?.fieldErrors ?? {}} attribution={attribution} />
      <Consent />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Booking your tour…">Book my tour</SubmitButton>
    </Form>
  );
}
