import { ComponentProps } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-lg border border-foreground/10 px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 aria-invalid:ring-destructive/20 aria-invalid:border-destructive transition-all overflow-hidden backdrop-blur-md",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/80 text-primary-foreground shadow-sm [a&]:hover:bg-primary",
        secondary:
          "border-transparent bg-secondary/80 text-secondary-foreground shadow-sm [a&]:hover:bg-secondary",
        destructive:
          "border-transparent bg-destructive/80 text-destructive-foreground shadow-sm [a&]:hover:bg-destructive focus-visible:ring-destructive/30",
        outline:
          "text-foreground border-foreground/15 bg-background/40 [a&]:hover:bg-accent/15 [a&]:hover:text-accent-foreground [a&]:hover:border-accent/30",
        accent:
          "border-transparent bg-accent/20 text-accent shadow-sm [a&]:hover:bg-accent/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
