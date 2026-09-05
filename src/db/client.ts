import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

export interface DbEnv {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
}

export function createDb(env: DbEnv) {
  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });

  return drizzle(client);
}