import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": here("./src"),
      // The shared contract lives one folder up, owned by both teammates.
      "@contracts": here("../contracts"),
    },
  },
  server: {
    // Allow reading ../contracts during development.
    fs: { allow: [here("..")] },
  },
});
