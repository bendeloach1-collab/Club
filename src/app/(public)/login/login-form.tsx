"use client";

import { useActionState } from "react";
import { Field, Form, FormMessage, SubmitButton } from "@/components/forms";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <Form dispatch={action} pending={pending} className="card space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" name="email"><input className="input" id="email" name="email" type="email" autoComplete="username" required /></Field>
      <Field label="Password" name="password"><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Signing in…" className="btn btn-primary w-full">Sign in</SubmitButton>
    </Form>
  );
}
