import { readFile } from "node:fs/promises";
import singlestore, { type Connection, type RowDataPacket } from "singlestore-nodejs/promise";
import { z } from "zod";

export const identifier = z.string().min(1).refine((name) => !name.includes("\0"), "Invalid SQL identifier.");
export const cell = z.union([z.string(), z.boolean(), z.number(), z.null()]);
export const queryTimeout = 10_000;

export function quoteIdentifier(name: string) {
  return `\`${name.replaceAll("\`", "\`\`")}\``;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Set ${name} in .env.local to use SingleStore.`);
  return value;
}

export async function withSingleStore<T>(use: (connection: Connection) => Promise<T>): Promise<T> {
  const host = requiredEnv("SINGLESTORE_HOST").trim();
  const user = requiredEnv("SINGLESTORE_USER").trim();
  const password = requiredEnv("SINGLESTORE_PASSWORD");
  const database = requiredEnv("SINGLESTORE_DATABASE").trim();
  const port = Number(process.env.SINGLESTORE_PORT?.trim() || "3306");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SINGLESTORE_PORT must be a port number between 1 and 65535.");
  }

  const caFile = process.env.SINGLESTORE_CA_FILE?.trim();
  const ca = caFile ? await readFile(caFile).catch(() => {
    throw new Error("Could not read SINGLESTORE_CA_FILE.");
  }) : undefined;

  let connection: Connection | undefined;
  try {
    connection = await singlestore.createConnection({
      host, user, password, database, port,
      ssl: { ca, rejectUnauthorized: true, verifyIdentity: true },
      connectTimeout: queryTimeout,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
    });
    return await use(connection);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error &&
        typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)) {
      throw new Error(`SingleStore operation failed (${error.code}).`);
    }
    throw error;
  } finally {
    if (connection) await connection.end().catch(() => connection?.destroy());
  }
}

interface Column extends RowDataPacket {
  name: string;
  type: string;
  columnKey: string;
}

export async function describeTable(connection: Connection, table: string) {
  const [columns] = await connection.execute<Column[]>({
    sql: `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_KEY AS columnKey
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
    timeout: queryTimeout,
  }, [table]);
  if (!columns.length) throw new Error("Table not found in the configured SingleStore database.");
  return columns;
}
