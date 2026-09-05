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
          background: trackGradient || 'var(--state-active)',
        }}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full shadow-sm"
          )}
          style={{
            background: rangeGradient || 'var(--primary)',
          }}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="rumahl-slider-thumb block size-5 shrink-0 rounded-full disabled:pointer-events-none disabled:opacity-45"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
