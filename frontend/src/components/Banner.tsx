import type { ReactNode } from "react";
import { AlertTriangle, FlaskConical, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning" | "sample";

const toneStyles: Record<Tone, string> = {
  info: "bg-primary-soft text-primary-strong",
  warning: "bg-warning-soft text-warning",
  sample: "border border-border bg-card text-foreground [&_svg]:text-muted-foreground",
};

const toneIcon: Record<Tone, ReactNode> = {
  info: <Info aria-hidden />,
  warning: <AlertTriangle aria-hidden />,
  sample: <FlaskConical aria-hidden />,
};

/** A calm full-width notice. Icon + text, never color alone. */
export function Banner({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex items-start gap-3 rounded-lg px-4 py-3 text-[15px] leading-snug [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0", toneStyles[tone], className)}
    >
      {toneIcon[tone]}
      <div>{children}</div>
    </div>
  );
}
