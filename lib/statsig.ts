const gate = "BROWSERBASE_ENABLED";

export async function evaluateRentalGate(): Promise<"on" | "off" | "unavailable"> {
  const key = process.env.STATSIG_SDK_KEY?.trim();
  if (!key) return "unavailable";
  try {
    const response = await fetch("https://api.statsig.com/v1/check_gate", {
      method: "POST",
      headers: { "statsig-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        gateName: gate,
        user: { userID: "guido-guild" },
        statsigEnvironment: { tier: "production" },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) {
      const result = await response.json();
      if (result?.name === gate && typeof result.value === "boolean") return result.value ? "on" : "off";
    }
  } catch {
    // Failed or malformed evaluations leave Browserbase disabled.
  }
  return "unavailable";
}
