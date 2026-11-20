"use client";
import { useEffect, useMemo, useState } from "react";

// Sortable, searchable, paged table with CSV export.
// columns: [{ key, label, num?, render?(row), sort?(row), csv?(row), title?, className? }]
// `sort` gives the sort value (defaults to row[key]); `csv` the export value.
export function toCsv(columns, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = columns.filter((c) => c.csv !== false);
  const head = cols.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => cell(typeof c.csv === "function" ? c.csv(r) : r[c.key])).join(","));
  return [head, ...body].join("\n");
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function SearchTable({
  columns, rows, rowKey, defaultSort = { key: "clicks", dir: "desc" },
  searchKeys = [], searchPlaceholder = "Filter…", onRowClick, pageSize = 25,
  emptyMsg = "Nothing to show.", csvName, toolbar, rowClassName,
}) {
  const [sort, setSort] = useState(defaultSort);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchKeys.length) return rows;
    return rows.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q)));
  }, [rows, query, searchKeys]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    const val = (r) => (col?.sort ? col.sort(r) : r[sort.key]);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
  }, [filtered, sort, columns]);

  useEffect(() => { setPage(1); }, [query, sort, rows]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const shown = sorted.slice((page - 1) * pageSize, page * pageSize);

  const onSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "position" ? "asc" : "desc" }));

  return (
    <div className="gsc-table-block">
      <div className="gsc-table-tools">
        {searchKeys.length > 0 && (
          <input
            type="search"
            className="ga4-control gsc-search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={searchPlaceholder}
          />
        )}
        <span className="gsc-count">{sorted.length.toLocaleString("en-US")} rows</span>
        {toolbar}
        {csvName && sorted.length > 0 && (
          <button type="button" className="ga4-btn gsc-btn-sm" onClick={() => download(csvName, toCsv(columns, sorted))}>
            Export CSV
          </button>
        )}
      </div>
      <div className="ga4-table-wrap">
        <table className="ga4-table ga4-table-compact">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.num ? "ga4-num" : undefined} title={c.title}>
                  {c.sortable === false ? c.label : (
                    <button type="button" className="ga4-sort" onClick={() => onSort(c.key)}>
                      {c.label}
                      <span className={`ga4-sort-icon${sort.key === c.key ? " is-active" : ""}`} aria-hidden="true">
                        {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={columns.length} className="ga4-empty-cell">{query ? "No rows match that filter." : emptyMsg}</td></tr>
            ) : shown.map((r) => (
              <tr
                key={rowKey(r)}
                className={`${onRowClick ? "gsc-row-click" : ""} ${rowClassName ? rowClassName(r) : ""}`}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(r); } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`${c.num ? "ga4-num" : ""} ${c.className || ""}`}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="gsc-pager">
          <button type="button" className="ga4-btn gsc-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="ga4-btn gsc-btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
