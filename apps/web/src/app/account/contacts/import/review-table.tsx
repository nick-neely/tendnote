"use client";

import { flexRender, type Row, type Table as TableInstance } from "@tanstack/react-table";
import type { ContactImportPreviewCandidate } from "@tendnote/db/queries/contacts-import-preview";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type ResolutionChoice, ResolutionZone } from "./resolution-zone";

type Candidate = ContactImportPreviewCandidate;

type ReviewTableProps = {
  table: TableInstance<Candidate>;
  busy: boolean;
  removingIds: ReadonlySet<string>;
  onApply: (candidate: Candidate, resolution: ResolutionChoice) => void;
  onSkip: (candidate: Candidate) => void;
};

/** The one table every candidate shares, review rows and safe rows alike. */
export function ReviewTable({ table, busy, removingIds, onApply, onSkip }: ReviewTableProps) {
  const rows = table.getRowModel().rows;

  return (
    <div className="overflow-hidden rounded-lg border bg-surface">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="hover:bg-transparent" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  className="text-[length:var(--text-caption)] font-medium text-muted-foreground"
                  key={header.id}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <NoMatchesRow colSpan={table.getVisibleFlatColumns().length} />
          ) : (
            rows.map((row) => (
              <CandidateRows
                busy={busy}
                key={row.id}
                onApply={onApply}
                onSkip={onSkip}
                removing={removingIds.has(row.id)}
                row={row}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * One candidate's rows: the summary row plus, for a row that needs review, the
 * expansion row holding its decision zone. A fragment keeps the two as siblings
 * inside <tbody> without an intervening wrapper element.
 */
function CandidateRows({
  row,
  busy,
  removing,
  onApply,
  onSkip,
}: {
  row: Row<Candidate>;
  busy: boolean;
  removing: boolean;
  onApply: (candidate: Candidate, resolution: ResolutionChoice) => void;
  onSkip: (candidate: Candidate) => void;
}) {
  return (
    <>
      <TableRow
        className="align-top transition-opacity duration-150 ease-(--motion-ease-out) data-[removing=true]:opacity-0"
        data-removing={removing ? "true" : undefined}
        data-state={row.getIsSelected() ? "selected" : undefined}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell className="whitespace-normal" key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
      {row.getCanExpand() ? (
        <ResolutionRow colSpan={row.getVisibleCells().length} expanded={row.getIsExpanded()}>
          <ResolutionZone
            busy={busy}
            candidate={row.original}
            onApply={(resolution) => onApply(row.original, resolution)}
            onSkip={() => onSkip(row.original)}
          />
        </ResolutionRow>
      ) : null}
    </>
  );
}

/** The collapsible shell the decision zone eases open inside. */
function ResolutionRow({
  colSpan,
  expanded,
  children,
}: {
  colSpan: number;
  expanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-0 hover:bg-transparent" data-slot="table-row">
      <td className="p-0" colSpan={colSpan}>
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-(--motion-ease-out) data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]"
          data-state={expanded ? "open" : "closed"}
        >
          <div className="overflow-hidden">{children}</div>
        </div>
      </td>
    </tr>
  );
}

function NoMatchesRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        className="h-24 whitespace-normal text-center text-muted-foreground"
        colSpan={colSpan}
      >
        No candidates match these filters.
      </TableCell>
    </TableRow>
  );
}
