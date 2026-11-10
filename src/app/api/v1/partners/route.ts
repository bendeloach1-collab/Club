import { apiError } from "@/lib/action";
import { json, preflight } from "@/lib/api";
import { env } from "@/lib/env";
import { getActor } from "@/lib/session";
import { listPartnerCards } from "@/modules/partners/partners";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/**
 * GET /api/v1/partners — partner services visible to the caller (public ones when anonymous).
 * Launch URLs point at AAC's validated launcher, never directly at stored partner URLs.
 */
export async function GET(req: Request) {
  try {
    const cards = await listPartnerCards(await getActor());
    return json(req, { data: cards.map((c) => ({ slug: c.slug, name: c.name, description: c.description, category: c.category, available: c.available, external: true, actions: c.actions.map((a) => ({ kind: a.kind, label: a.label, destinationHost: a.host, launchUrl: `${env.appUrl}/go/${c.slug}/${a.kind}` })) })) });
  } catch (e) {
    return apiError(e);
  }
}
