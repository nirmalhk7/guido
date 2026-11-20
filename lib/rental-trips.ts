import { createHash } from "node:crypto";
import type { RowDataPacket } from "singlestore-nodejs/promise";
import { z } from "zod";
import { queryTimeout, withSingleStore } from "./singlestore.ts";

const location = z.string().trim().min(1).max(255).transform((value) => value.replace(/\s+/g, " "));
export const rentalTrip = z.strictObject({
  pickup_location: location,
  return_location: location,
  pickup_date: z.iso.date(),
  return_date: z.iso.date(),
}).refine((trip) => trip.return_date >= trip.pickup_date);

type RentalTrip = z.infer<typeof rentalTrip>;
interface RentalTripRow extends RowDataPacket, RentalTrip {}

export async function saveRentalTrip(senderScope: string, trip: RentalTrip): Promise<string> {
  const tripId = createHash("sha256").update(JSON.stringify([
    trip.pickup_location.toLowerCase(),
    trip.return_location.toLowerCase(),
    trip.pickup_date,
    trip.return_date,
  ])).digest("hex");
  await withSingleStore(async (connection) => {
    await connection.query({
      sql: `CREATE TABLE IF NOT EXISTS guido_rental_trips (
        sender_scope CHAR(64) NOT NULL,
        trip_id CHAR(64) NOT NULL,
        pickup_location VARCHAR(255) NOT NULL,
        return_location VARCHAR(255) NOT NULL,
        pickup_date DATE NOT NULL,
        return_date DATE NOT NULL,
        PRIMARY KEY (sender_scope, trip_id),
        SORT KEY (sender_scope)
      )`,
      timeout: queryTimeout,
    });
    await connection.execute({
      sql: `INSERT INTO guido_rental_trips
        (sender_scope, trip_id, pickup_location, return_location, pickup_date, return_date)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE pickup_location = pickup_location`,
      timeout: queryTimeout,
    }, [senderScope, tripId, trip.pickup_location, trip.return_location, trip.pickup_date, trip.return_date]);
  });
  return tripId;
}

export async function loadRentalTrips(senderScope: string, tripIds: string[]): Promise<RentalTrip[]> {
  if (!tripIds.length) return [];
  return withSingleStore(async (connection) => {
    const [rows] = await connection.execute<RentalTripRow[]>({
      sql: `SELECT pickup_location, return_location, pickup_date, return_date
        FROM guido_rental_trips
        WHERE sender_scope = ? AND trip_id IN (${tripIds.map(() => "?").join(", ")})`,
      timeout: queryTimeout,
    }, [senderScope, ...tripIds]);
    return rows;
  });
}
