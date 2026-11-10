"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Re-fetch the current server-rendered page a limited number of times (e.g. while a payment settles). */
export function AutoRefresh({ everyMs = 3000, times = 10 }: { everyMs?: number; times?: number }) {
  const router = useRouter();
  const count = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (++count.current > times) return clearInterval(t);
      router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, times]);
  return null;
}
