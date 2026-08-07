import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  className
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0 flex flex-col gap-1">
        {breadcrumb ? <div className="text-sm text-muted-foreground">{breadcrumb}</div> : null}
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
