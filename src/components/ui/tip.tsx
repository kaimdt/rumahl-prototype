import type { ReactNode } from "react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

interface TipProps {
  content: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  children: ReactNode
}

export function Tip({ content, side = "top", children }: TipProps) {
  if (!content) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  )
}
