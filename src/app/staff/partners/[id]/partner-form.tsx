"use client";

import { useActionState } from "react";
import { Field, Form, FormMessage, SubmitButton } from "@/components/forms";
import { savePartnerAction } from "../../actions";

export type PartnerFormValues = {
  id?: string; slug: string; name: string; description: string; logoUrl: string; category: string; connectionMode: string; approvedDomains: string;
  bookingUrl: string; bookingLabel: string; accountUrl: string; accountLabel: string; supportUrl: string; deepLinkUrl: string;
  audience: string; planCodes: string[]; launchTarget: string; status: string; handlesHealthInfo: boolean; displayOrder: number;
};

export function PartnerForm({ v, plans }: { v: PartnerFormValues; plans: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(savePartnerAction, undefined);
  const fe = state?.fieldErrors ?? {};
  const text = (name: keyof PartnerFormValues, label: string, opts: { hint?: string; type?: string; required?: boolean; placeholder?: string } = {}) => (
    <Field label={label} name={name} error={fe[name]} hint={opts.hint}>
      <input className="input" id={name} name={name} type={opts.type ?? "text"} defaultValue={String(v[name] ?? "")} required={opts.required} placeholder={opts.placeholder} />
    </Field>
  );
  return (
    <Form dispatch={action} pending={pending} className="space-y-6">
      {v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <fieldset className="card grid gap-4 sm:grid-cols-2">
        <legend className="float-left mb-2 w-full text-lg font-semibold sm:col-span-2">Listing</legend>
        {text("name", "Name", { required: true })}
        {text("slug", "URL slug", { required: true, hint: "Lowercase letters, numbers and hyphens." })}
        {text("category", "Category", { required: true, placeholder: "golf, physical-therapy, wellness…" })}
        {text("displayOrder", "Display order", { type: "number" })}
        <div className="sm:col-span-2"><Field label="Description" name="description" error={fe.description}><textarea className="input" id="description" name="description" rows={3} defaultValue={v.description} /></Field></div>
        {text("logoUrl", "Logo URL", { hint: "https:// image URL or a site-relative path. Optional." })}
        <Field label="Status" name="status" hint="Only Active partners can be launched. Unconfigured/Unavailable show a fallback message.">
          <select className="input" id="status" name="status" defaultValue={v.status}><option value="active">Active</option><option value="unconfigured">Unconfigured</option><option value="unavailable">Temporarily unavailable</option><option value="disabled">Disabled (hidden)</option></select>
        </Field>
      </fieldset>

      <fieldset className="card grid gap-4 sm:grid-cols-2">
        <legend className="float-left mb-2 w-full text-lg font-semibold sm:col-span-2">Destinations</legend>
        <div className="sm:col-span-2"><Field label="Approved destination domains" name="approvedDomains" error={fe.approvedDomains ?? fe["approvedDomains.0"]} hint="One hostname per line. Launches are only allowed to these hosts over HTTPS. Use *.partner.com to allow sub-domains.">
          <textarea className="input font-mono text-sm" id="approvedDomains" name="approvedDomains" rows={3} defaultValue={v.approvedDomains} />
        </Field></div>
        {text("bookingUrl", "Booking URL", { placeholder: "https://…" })}
        {text("bookingLabel", "Booking button label", { placeholder: "Book Golf" })}
        {text("accountUrl", "Account / portal URL", { placeholder: "https://…" })}
        {text("accountLabel", "Account button label", { placeholder: "Open Patient Portal" })}
        {text("supportUrl", "Support URL", { placeholder: "https://…" })}
        {text("deepLinkUrl", "Deep link (HTTPS universal link)", { hint: "Used in Deep link mode; the booking URL is the web fallback." })}
        <p className="text-xs text-ink-500 sm:col-span-2">Never include passwords, tokens, member IDs, emails or any health information in a URL. Such parameters are rejected.</p>
      </fieldset>

      <fieldset className="card grid gap-4 sm:grid-cols-2">
        <legend className="float-left mb-2 w-full text-lg font-semibold sm:col-span-2">Connection and visibility</legend>
        <Field label="Connection mode" name="connectionMode" hint="Single sign-on and API modes require a partner-specific adapter (Milestone 3). Until one is installed they behave as a plain link.">
          <select className="input" id="connectionMode" name="connectionMode" defaultValue={v.connectionMode}><option value="link">Link — open the partner website</option><option value="deep_link">Deep link — app/universal link with web fallback</option><option value="sso">Single sign-on (adapter required)</option><option value="api">API connection (adapter required)</option></select>
        </Field>
        <Field label="Launch behaviour" name="launchTarget"><select className="input" id="launchTarget" name="launchTarget" defaultValue={v.launchTarget}><option value="new_tab">Open in a new tab (keeps AAC open)</option><option value="same_tab">Open in the same tab</option></select></Field>
        <Field label="Who can see this" name="audience"><select className="input" id="audience" name="audience" defaultValue={v.audience}><option value="public">Everyone, including the public site</option><option value="members">Active members</option><option value="plans">Members on selected plans</option></select></Field>
        <div>
          <p className="label">Plans (when limited to selected plans)</p>
          {plans.map((p) => <label key={p.code} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="planCodes" value={p.code} defaultChecked={v.planCodes.includes(p.code)} className="h-4 w-4" />{p.name}</label>)}
        </div>
        <label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" name="handlesHealthInfo" defaultChecked={v.handlesHealthInfo} className="mt-1 h-4 w-4" /><span>Clinical partner (handles health information). Launches are not attributed to individual members and are excluded from analytics and marketing.</span></label>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pendingLabel="Validating and saving…">Save partner service</SubmitButton>
    </Form>
  );
}
