import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { reportError } from "@/lib/log";
import { getActor } from "@/lib/session";
import { resolvePartnerLaunch, type LinkKind } from "@/modules/partners/partners";

export const dynamic = "force-dynamic";
const KINDS = ["booking", "account", "support"];

/**
 * Partner launch. The destination is taken only from stored, validated partner configuration
 * identified by slug — never from a URL in the request — so this cannot be used as an open
 * redirect. The member's AAC session cookie is untouched; no member data is forwarded.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params;
  const fallback = (reason: string) => NextResponse.redirect(`${env.appUrl}/portal/services/${encodeURIComponent(slug)}?notice=${reason}`, 303);
  if (!KINDS.includes(kind)) return fallback("unavailable");
  try {
    const { url } = await resolvePartnerLaunch(await getActor(), slug, kind as LinkKind);
    const res = NextResponse.redirect(url, 303);
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    if (!(e instanceof AppError)) reportError("partner.launch_failed", e, { slug });
    return fallback("unavailable");
  }
}
