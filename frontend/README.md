# Audit-trail page

The web page people open from the agent's email: the recommended rental car,
why, and how the agent decided. Plan: [`docs/UI_PLAN.md`](../docs/UI_PLAN.md).

## Run it

```sh
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. To preview the in-between states, add `?demo=1`.

## Where things live

- **Data:** reads `contracts/trip_result.sample.json` for now. Real results use
  the same shape (`contracts/trip_result.schema.json`).
- **All wording:** `contracts/display_fields.json`. Don't hard-code text here.
- `src/lib/`: plain logic (re-ranking, money and time formatting, field lookup).
- `src/components/`: page sections. `src/components/ui/`: shadcn-style building blocks.
- `src/demo/`: demo-only previews of the sample. Real data never goes through it.

Stack: React + Vite + TypeScript + Tailwind CSS + shadcn/ui (Radix).
