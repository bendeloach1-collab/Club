export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Digits only; US numbers are reduced to 10 digits so "+1 (706) 555-0100" matches "706-555-0100". */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}
