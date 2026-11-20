import { copy } from "@/lib/copy";
import { DEMO_STATES, type DemoStateKey } from "./variants";

/** Demo-only picker for previewing each state. Shown only with ?demo=1 in the address. */
export function DemoSwitcher({ value, onChange }: { value: DemoStateKey; onChange: (k: DemoStateKey) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-full bg-foreground/90 py-1 pl-4 pr-1 text-[13px] text-white shadow-lg">
      {copy.demo.switcher_label}
      <select
        className="min-h-9 rounded-full bg-white px-3 text-[14px] text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value as DemoStateKey)}
      >
        {DEMO_STATES.map((k) => (
          <option key={k} value={k}>
            {copy.demo.states[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
