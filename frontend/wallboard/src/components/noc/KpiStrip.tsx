import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function KpiStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>{children}</div>
  );
}

export function KpiChip({
  label,
  value,
  className
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-1 font-normal", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </Badge>
  );
}
