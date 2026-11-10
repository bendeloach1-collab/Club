"use client";

import { useActionState } from "react";
import { Form, FormMessage, SubmitButton } from "@/components/forms";
import { cancelBookingAction } from "../book/[sessionId]/actions";

export function CancelButton({ bookingId, label }: { bookingId: string; label: string }) {
  const [state, action, pending] = useActionState(cancelBookingAction, undefined);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <Form dispatch={action} pending={pending} className="flex flex-col items-end gap-2" confirmText="Cancel this booking?">
      <input type="hidden" name="bookingId" value={bookingId} />
      <SubmitButton className="btn btn-danger btn-sm" pendingLabel="Cancelling…"><span aria-hidden="true">Cancel</span><span className="sr-only">Cancel {label}</span></SubmitButton>
      <FormMessage state={state} />
    </Form>
  );
}
