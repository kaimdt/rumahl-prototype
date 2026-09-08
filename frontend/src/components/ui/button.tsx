import { ComponentProps } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "rumahl-button shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "rumahl-button-primary",
        destructive: "rumahl-button-destructive",
        outline: "rumahl-button-outline",
        secondary: "rumahl-button-secondary",
        ghost: "rumahl-button-ghost",
        glass: "rumahl-button-secondary",
        link: "rumahl-button-link",
      },
      size: {
        default: "h-auto px-3 py-1.5",
        sm: "h-auto gap-1.5 px-2 py-1",
        lg: "min-h-10 px-4 py-2",
        icon: "size-[var(--density-control)] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
