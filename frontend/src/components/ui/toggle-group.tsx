import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

/** iOS-style segmented control built on shadcn's Toggle Group. */
export const SegmentedControl = React.forwardRef<
  HTMLDivElement,
  {
    value: string;
    onValueChange: (value: string) => void;
    className?: string;
    children?: React.ReactNode;
    "aria-label"?: string;
  }
>(({ className, onValueChange, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    type="single"
    // Keep one segment selected at all times.
    onValueChange={(v: string) => v && onValueChange(v)}
    className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-[12px] bg-[#e8e8ed] p-1", className)}
    {...props}
  />
));
SegmentedControl.displayName = "SegmentedControl";

export const Segment = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "min-h-11 rounded-[9px] px-2 text-[14px] font-medium leading-tight text-muted-foreground transition-all sm:text-[15px]",
      "data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_4px_rgba(0,0,0,0.12)]",
      className,
    )}
    {...props}
  />
));
Segment.displayName = "Segment";
