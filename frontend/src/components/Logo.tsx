import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The Guido lockup: the icon (used exactly as supplied, never recolored or
 * stretched) next to the wordmark set in the UI font. Change the size or the
 * wordmark here and every use follows.
 */
const SIZES = {
  sm: { icon: 24, text: "text-[17px]", gap: "gap-1.5" },
  md: { icon: 32, text: "text-[22px]", gap: "gap-2" },
  lg: { icon: 44, text: "text-[30px]", gap: "gap-2.5" },
} as const;

export const LOGO_ICON_SRC = "/brand/guido_icon_cutout.svg";

export function Logo({
  size = "md",
  showWordmark = true,
  className,
}: {
  size?: keyof typeof SIZES;
  showWordmark?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  const name = copy.page.brand_name;
  return (
    <span
      className={cn("inline-flex items-center", s.gap, className)}
      // The icon file has built-in space on its left (the pin starts at 20% of its box);
      // pull the lockup left so the pin lines up with the text below it.
      style={{ marginLeft: -Math.round(s.icon * 0.2) }}
    >
      <img
        src={LOGO_ICON_SRC}
        width={s.icon}
        height={s.icon}
        // With the wordmark beside it the icon is decorative, so the name is read once.
        alt={showWordmark ? "" : name}
        aria-hidden={showWordmark || undefined}
        className="shrink-0 object-contain"
        style={{ width: s.icon, height: s.icon }}
      />
      {showWordmark && <span className={cn("font-semibold leading-none tracking-[-0.02em] text-foreground", s.text)}>{name}</span>}
    </span>
  );
}
