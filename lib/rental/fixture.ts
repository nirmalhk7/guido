import type { Branch, Tool } from "./contracts.ts";

const peninsula: Branch[] = [
  {
    id: "san-mateo", name: "San Mateo sample branch", kind: "non_airport",
    centerToPickup: { minutes: 8, costCents: 300, note: "Sample bus estimate" },
    returnToCenter: { minutes: 9, costCents: 300, note: "Sample bus estimate" },
    returnNote: "Staffed returns in this sample",
  },
  {
    id: "belmont", name: "Belmont sample branch", kind: "non_airport",
    centerToPickup: { minutes: 15, costCents: 900, note: "Sample train estimate" },
    returnToCenter: { minutes: 18, costCents: 900, note: "Sample train estimate" },
    returnNote: "After-hours key drop in this sample",
  },
  {
    id: "sfo", name: "SFO sample branch", kind: "airport",
    centerToPickup: { minutes: 29, costCents: 3000, note: "Sample taxi estimate" },
    returnToCenter: { minutes: 22, costCents: 2600, note: "Sample taxi estimate" },
    returnNote: "Terminal transfer in this sample",
  },
];
const peninsulaRates = new Map<string, [dailyCents: number, dropFeeCents: number | null]>([
  ["san-mateo/san-mateo", [4800, 0]],
  ["san-mateo/belmont", [3700, 400]],
  ["san-mateo/sfo", [2500, null]],
  ["belmont/san-mateo", [3900, 1000]],
  ["belmont/belmont", [4500, 0]],
  ["belmont/sfo", [2600, 800]],
  ["sfo/san-mateo", [3000, 2700]],
  ["sfo/belmont", [4200, 3000]],
  ["sfo/sfo", [3900, 0]],
]);
const branchesById = new Map(peninsula.map((branch) => [branch.id, branch]));
const day = 86_400_000;

export function fixtureTool(): Tool {
  return {
    async listBranches({ area, currency }) {
      return currency === "USD" && area.toLowerCase() === "san mateo"
        ? { branches: peninsula }
        : { branches: [], partialReason: "The sample covers the San Mateo area in USD." };
    },
    async quote({ pickupId, returnId, pickupAt, returnAt, driverAge, drivers, carClass, minSeats }) {
      const pickup = branchesById.get(pickupId);
      const rate = peninsulaRates.get(`${pickupId}/${returnId}`);
      if (!pickup || !rate) {
        return { status: "unavailable", reason: "This branch is outside the sample catalog." };
      }
      if (driverAge < 21 || (minSeats ?? 0) > 4 || (carClass && carClass !== "economy")) return { status: "no_cars" };
      const days = Math.ceil((Date.parse(returnAt) - Date.parse(pickupAt)) / day);
      const [dailyCents, oneWay] = rate;
      const base = days * dailyCents;
      return {
        status: "available",
        offers: [{
          id: "economy", vehicle: "Economy car or similar", carClass: "economy", seats: 4, currency: "USD",
          charges: {
            base, taxes: Math.round(base * 0.1), airport: pickup.kind === "airport" ? 1800 : 0,
            oneWay,
            youngDriver: driverAge < 25 ? days * 2000 : 0,
            additionalDriver: (drivers - 1) * days * 800, otherMandatory: 0,
          },
          cancellation: "Sample pay-at-pickup rate with free cancellation before pickup",
        }],
      };
    },
  };
}
