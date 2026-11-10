import "dotenv/config";
import { resetDatabase } from "../scripts/reset";
import { runMigrations } from "../scripts/migrate";

/** Tests run against a real PostgreSQL database so locks, constraints and triggers are exercised. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://aac:aac@localhost:5432/aac_test";
  if (!/test/.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  await resetDatabase(url);
  await runMigrations(url);
}
