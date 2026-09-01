import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";

/**
 * The table capabilities the contact import review surface actually uses.
 *
 * TanStack Table v9 registers features (and their row models) explicitly rather
 * than inferring them from option usage, so this list is the single declaration
 * of what the review table can do: filter, sort, select, expand, and page.
 * Everything the surface renders is typed against it via {@link
 * ReviewTableFeatures}.
 */
export const reviewTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  expandedRowModel: createExpandedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text },
});

export type ReviewTableFeatures = typeof reviewTableFeatures;
