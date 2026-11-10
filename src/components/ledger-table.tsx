import { EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatClubDate } from "@/lib/time";

type Entry = { id: string; postedAt: Date; description: string; entryType: string; amountCents: number; currency: string };

/** Itemised club-account activity. Charges are positive; payments and credits are negative. */
export function LedgerTable({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return <EmptyState title="No account activity yet">Charges, payments, credits and refunds will be itemised here.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Club account activity, most recent first</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Type</th><th scope="col" className="text-right">Amount</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap">{formatClubDate(e.postedAt)}</td>
              <td>{e.description}</td>
              <td className="capitalize">{e.entryType}</td>
              <td className={`whitespace-nowrap text-right tabular-nums ${e.amountCents < 0 ? "text-emerald-800" : ""}`}>{e.amountCents < 0 ? "−" : ""}{formatMoney(Math.abs(e.amountCents), e.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
