"use client"

import { ComponentProps, useMemo } from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  trackGradient?: string
  rangeGradient?: string
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  trackGradient,
  rangeGradient,
  ...props
}: SliderProps) {
  const _values = useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col py-2",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2 shadow-inner border border-foreground/5"
        )}
        style={{
          background: trackGradient || 'oklch(from var(--foreground) l c h / 0.08)',
        }}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full shadow-sm"
          )}
          style={{
            background: rangeGradient || 'linear-gradient(to right, var(--accent) 0%, oklch(from var(--accent) l c h / 0.95) 50%, oklch(from var(--accent) l c h / 0.90) 100%)',
          }}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="block size-6 shrink-0 rounded-full border-2 border-card bg-gradient-to-b from-foreground/90 to-foreground/80 shadow-[0_2px_10px_rgba(0,0,0,0.2),0_0_0_1px_rgba(255,255,255,0.15)_inset,0_1px_2px_rgba(255,255,255,0.3)_inset] backdrop-blur-xl transition-transform focus-visible:scale-110 focus-visible:shadow-[0_4px_12px_rgba(0,0,0,0.3),0_0_0_3px_oklch(from_var(--accent)_l_c_h_/_0.4)] focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 active:scale-95"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
