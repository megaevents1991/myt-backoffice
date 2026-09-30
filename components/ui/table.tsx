"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * `list` is the look the dashboard's DataTable wears - a tinted header in small
 * caps and denser cells - for a hand-built <Table> that lists records. It only
 * swaps the DEFAULTS, so a cell's own className still wins. `default` is the
 * stock shadcn table (the partner portal, tables inside cards).
 */
type TableLook = "default" | "list"

const TableLookContext = React.createContext<TableLook>("default")

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    /** Classes for the scrolling wrapper (e.g. a max height for a sticky header). */
    containerClassName?: string
    look?: TableLook
  }
>(({ className, containerClassName, look = "default", ...props }, ref) => (
  <TableLookContext.Provider value={look}>
    <div className={cn("relative w-full overflow-auto", containerClassName)}>
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  </TableLookContext.Provider>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => {
  const look = React.useContext(TableLookContext)
  return (
    <thead
      ref={ref}
      className={cn(
        "[&_tr]:border-b",
        look === "list" && "bg-muted/60 [&_tr:hover]:bg-transparent",
        className
      )}
      {...props}
    />
  )
})
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const look = React.useContext(TableLookContext)
  return (
    <th
      ref={ref}
      className={cn(
        "h-12 px-4 text-start align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
        look === "list" &&
          "h-10 whitespace-nowrap px-3 text-xs font-semibold uppercase tracking-wide",
        className
      )}
      {...props}
    />
  )
})
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const look = React.useContext(TableLookContext)
  return (
    <td
      ref={ref}
      className={cn(
        "p-4 align-middle [&:has([role=checkbox])]:pr-0",
        look === "list" && "px-3 py-2.5",
        className
      )}
      {...props}
    />
  )
})
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
