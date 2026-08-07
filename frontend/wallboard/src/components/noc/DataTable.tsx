import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export function DataTableCard({
  title,
  children,
  className,
  empty,
  actions
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  empty?: boolean;
  actions?: ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {(title || actions) && (
        <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
          {title ? (
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </CardTitle>
          ) : (
            <span />
          )}
          {actions}
        </CardHeader>
      )}
      <CardContent className="p-0">
        {empty ? (
          <div className="p-6">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No data</EmptyTitle>
                <EmptyDescription>Nothing to show yet.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
