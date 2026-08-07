import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type OutageInterval = {
  start: number;
  end: number;
  durationSec: number;
  ongoing?: boolean;
};

function formatWhen(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
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

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--success)_35%,transparent)]"
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
                "absolute top-0 h-full rounded-sm bg-destructive/80",
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Ended</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outages.map((o) => (
                <TableRow key={`${o.start}-${o.end}`}>
                  <TableCell>{formatWhen(o.start)}</TableCell>
                  <TableCell>{o.ongoing ? "—" : formatWhen(o.end)}</TableCell>
                  <TableCell>{formatDuration(o.durationSec)}</TableCell>
                  <TableCell>
                    <Badge variant={o.ongoing ? "destructive" : "secondary"}>
                      {o.ongoing ? "Ongoing" : "Ended"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}
    </div>
  );
}
