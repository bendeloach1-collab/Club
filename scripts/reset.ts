/** DEVELOPMENT ONLY: drop everything in the database so migrations can be re-applied. */
import "dotenv/config";
import pg from "pg";

export async function resetDatabase(url: string) {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("reset.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  resetDatabase(url).then(() => console.log("Database reset."));
}
