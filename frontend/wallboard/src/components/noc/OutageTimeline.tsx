import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { paginateItems } from "@/components/TableControls";

export type OutageInterval = {
  start: number;
  end: number;
  durationSec: number;
  ongoing?: boolean;
};

export type OutagePageSize = 10 | 25 | 50 | "all";

const PAGE_SIZE_OPTIONS: OutagePageSize[] = [10, 25, 50, "all"];

function formatWhen(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

function resolvePageSize(size: OutagePageSize, total: number): number {
  return size === "all" ? Math.max(total, 1) : size;
}

export function OutageTimeline({
  outages,
  rangeStart,
  rangeEnd,
  className,
  showTable = true
}: {
  outages: OutageInterval[];
  rangeStart: number;
  rangeEnd: number;
  className?: string;
  showTable?: boolean;
}) {
  const span = Math.max(1, rangeEnd - rangeStart);
  const [pageSize, setPageSize] = useState<OutagePageSize>(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [outages, pageSize]);

  const pageSizeNum = resolvePageSize(pageSize, outages.length);
  const { slice, total, totalPages, page: safePage, start, end } = useMemo(
    () => paginateItems(outages, page, pageSizeNum),
    [outages, page, pageSizeNum]
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--success)_40%,#0a1f14)]"
        aria-hidden
      >
        {outages.map((o) => {
          const left = Math.max(0, ((o.start - rangeStart) / span) * 100);
          const right = Math.min(100, ((o.end - rangeStart) / span) * 100);
          const width = Math.max(0.4, right - left);
          return (
            <span
              key={`${o.start}-${o.end}`}
              className={cn(
                "absolute top-0 h-full rounded-sm bg-destructive/85",
                o.ongoing && "bg-destructive"
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${formatWhen(o.start)} → ${o.ongoing ? "ongoing" : formatWhen(o.end)}`}
            />
          );
        })}
      </div>

      {showTable ? (
        outages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outages in this range.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>When</TableHead>
                    <TableHead>Ended</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice.map((o) => (
                    <TableRow key={`${o.start}-${o.end}`}>
                      <TableCell>{formatWhen(o.start)}</TableCell>
                      <TableCell>{o.ongoing ? "—" : formatWhen(o.end)}</TableCell>
                      <TableCell className="font-mono text-sm">{formatDuration(o.durationSec)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-6 rounded-full px-2.5 font-mono text-[11px] font-bold uppercase tracking-wide",
                            o.ongoing
                              ? "border-[color-mix(in_srgb,var(--destructive)_50%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_18%,#07090c)] text-[var(--destructive)]"
                              : "border-[rgba(148,163,184,0.45)] bg-[rgba(148,163,184,0.12)] text-[#c8d4de]"
                          )}
                        >
                          {o.ongoing ? "Ongoing" : "Ended"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {start + 1}–{end} of {total}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="outage-page-size" className="text-xs text-muted-foreground">
                    Rows
                  </Label>
                  <select
                    id="outage-page-size"
                    className="flex h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                    value={pageSize === "all" ? "all" : String(pageSize)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPageSize(v === "all" ? "all" : (Number(v) as 10 | 25 | 50));
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((opt) => (
                      <option key={String(opt)} value={opt === "all" ? "all" : String(opt)}>
                        {opt === "all" ? "All" : opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Previous
                  </Button>
                  <span className="px-1 text-sm text-muted-foreground">
                    Page {safePage} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
