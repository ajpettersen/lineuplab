import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  )
}

/**
 * Card-grid placeholder — matches the rounded-card shape used on
 * Roster, Schedule, and Practices so the first paint after navigation
 * has the same outline as the real content (no layout shift when the
 * cards land). `count` is the number of skeleton cards; `columns`
 * controls the responsive grid (1 = stacked list, 2/3 = grid).
 */
function CardGridSkeleton({
  count = 6,
  columns = 1,
  cardHeight = "h-24",
  className,
}: {
  count?: number
  columns?: 1 | 2 | 3
  cardHeight?: string
  className?: string
}) {
  const gridCols =
    columns === 3
      ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
      : columns === 2
      ? "grid grid-cols-1 sm:grid-cols-2 gap-3"
      : "flex flex-col gap-3"
  return (
    <div className={cn(gridCols, className)} data-testid="skeleton-card-grid">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("rounded-lg", cardHeight)} />
      ))}
    </div>
  )
}

/**
 * Table placeholder — mirrors the dense-row look of Season Stats /
 * Pitching / Rotation Report tables. Renders a header strip plus
 * `rows` body lines so the first paint reserves the right vertical
 * space (no layout shift when the data lands).
 */
function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="skeleton-table">
      <div className="flex gap-3 border-b border-border pb-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 py-1">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export { Skeleton, CardGridSkeleton, TableSkeleton }
