"use client";

import { useFormStatus } from "react-dom";
import { createContext, startTransition, useContext, type ComponentProps, type FormEvent, type ReactNode } from "react";

const PendingContext = createContext(false);

/**
 * Form bound to a `useActionState` dispatcher. Submitting through `onSubmit` (rather than
 * React's automatic form action) keeps what the person typed when the server returns a
 * validation error. Without JavaScript the form still posts to the server action.
 */
export function Form({ dispatch, pending, confirmText, children, ...rest }: { dispatch: (form: FormData) => void; pending: boolean; confirmText?: string } & Omit<ComponentProps<"form">, "action" | "onSubmit">) {
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(data));
  };
  return (
    <form action={dispatch} onSubmit={onSubmit} {...rest}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
    </form>
  );
}

/** Submit button with a built-in loading state; prevents double submission while pending. */
export function SubmitButton({ children, pendingLabel = "Working…", className = "btn btn-primary", name, value }: { children: ReactNode; pendingLabel?: string; className?: string; name?: string; value?: string }) {
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export type FormState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> } | undefined;

export function FormMessage({ state }: { state: FormState }) {
  if (!state?.error && !state?.message) return null;
  return state.error ? (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">{state.error}</div>
  ) : (
    <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">{state.message}</div>
  );
}

export function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: string; children?: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-red-700" id={`${name}-error`}>{error}</p> : null}
    </div>
  );
}
