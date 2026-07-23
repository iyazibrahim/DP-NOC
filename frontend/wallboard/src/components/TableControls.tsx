import type { ReactNode } from "react";

export const TABLE_PAGE_SIZE = 20;

export type KindFilter = "all" | "server" | "network";

export type SiteOption = { id: string; name: string };

export function paginateItems<T>(items: T[], page: number, pageSize = TABLE_PAGE_SIZE) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return { slice, total, totalPages, page: safePage, start, end: start + slice.length };
}

export function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search name, ID, IP…",
  sites,
  siteId,
  onSiteChange,
  kind,
  onKindChange,
  extra
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  sites?: SiteOption[];
  siteId?: string;
  onSiteChange?: (v: string) => void;
  kind?: KindFilter;
  onKindChange?: (v: KindFilter) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="tableToolbar">
      <input
        type="search"
        className="tableSearch"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label="Search devices"
      />
      {sites && onSiteChange ? (
        <select
          className="tableSelect"
          value={siteId ?? ""}
          onChange={(e) => onSiteChange(e.target.value)}
          aria-label="Filter by site"
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
      {onKindChange ? (
        <select
          className="tableSelect"
          value={kind ?? "all"}
          onChange={(e) => onKindChange(e.target.value as KindFilter)}
          aria-label="Filter by kind"
        >
          <option value="all">All kinds</option>
          <option value="server">Collectors</option>
          <option value="network">Local devices</option>
        </select>
      ) : null}
      {extra}
    </div>
  );
}

export function TablePagination({
  page,
  totalPages,
  total,
  start,
  end,
  onPageChange
}: {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) {
    return (
      <div className="tablePagination">
        <span className="muted">No matching devices</span>
      </div>
    );
  }
  return (
    <div className="tablePagination">
      <span className="muted">
        Showing {start + 1}–{end} of {total}
      </span>
      <div className="tablePaginationBtns">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <span className="tablePageIndicator">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
