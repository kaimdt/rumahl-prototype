import { ComponentProps, useState, useCallback } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import XIcon from "lucide-react/dist/esm/icons/x"
import { ArrowsOutSimple, ArrowsInSimple } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  hideCloseButton,
  hideExpandButton,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  hideCloseButton?: boolean
  hideExpandButton?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-describedby={undefined}
        className={cn(
          // Base: mobile-first fullscreen sheet
          "bg-card/95 backdrop-blur-2xl text-foreground fixed z-[70] grid gap-4 border border-foreground/20 shadow-2xl duration-200",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          // Mobile: bottom sheet style
          "inset-x-0 bottom-0 rounded-t-2xl max-h-[92vh] overflow-y-auto p-5 pt-3",
          // Tablet+: centered dialog
          "sm:inset-auto sm:top-[50%] sm:left-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:max-h-[90vh] sm:w-full sm:max-w-[calc(100%-2rem)] sm:p-6 sm:pt-6",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          // Default width for desktop (before className so caller can override)
          !expanded && "sm:max-w-[425px]",
          // External className (can set custom width)
          className,
          // Expanded: wider – AFTER className so it always wins when active
          expanded && "sm:max-w-[90vw] lg:max-w-[900px]",
        )}
        {...props}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center sm:hidden -mt-1 mb-1">
          <div className="w-10 h-1 rounded-full bg-foreground/20" />
        </div>
        <VisuallyHidden>
          <DialogPrimitive.Description />
        </VisuallyHidden>
        {children}
        {/* Action buttons: expand + close */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-1.5 z-10">
          {!hideExpandButton && (
            <button
              type="button"
              onClick={toggleExpand}
              className="hidden sm:flex items-center justify-center w-8 h-8 rounded-xl bg-black/20 backdrop-blur-md text-foreground/80 transition-all duration-200 hover:bg-accent/20 hover:text-accent hover:scale-105 active:scale-95 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden shadow-sm"
              title={expanded ? 'Verkleinern' : 'Vergrößern'}
            >
              {expanded ? <ArrowsInSimple size={15} weight="bold" /> : <ArrowsOutSimple size={15} weight="bold" />}
            </button>
          )}
          {!hideCloseButton && (
            <DialogPrimitive.Close className="flex items-center justify-center w-8 h-8 rounded-xl bg-black/20 backdrop-blur-md text-foreground/80 transition-all duration-200 hover:bg-destructive/20 hover:text-destructive hover:scale-105 active:scale-95 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 shadow-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
