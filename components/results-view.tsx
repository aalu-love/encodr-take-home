import type { EncodeResult } from "@/lib/types";
import { formatDuration, formatSize } from "@/lib/format";

/** Finished-run results: duration, a renditions table, and any warnings. Plain on purpose. */
export function ResultsView({ result }: { result: EncodeResult }) {
  return (
    <section aria-label="Encode results" className="space-y-4">
      <p className="text-sm">
        <span className="text-neutral-500">Duration</span>{" "}
        <span className="font-medium tabular-nums">{formatDuration(result.durationSec)}</span>
      </p>

      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Rendition</th>
              <th scope="col" className="px-3 py-2 font-medium">Resolution</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {result.renditions.map((r) => (
              <tr key={r.label}>
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2 tabular-nums text-neutral-600">
                  {r.width} × {r.height}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSize(r.sizeMb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Warnings</h3>
        {result.warnings.length === 0 ? (
          <p className="text-sm text-neutral-500">No warnings.</p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm text-amber-700">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
