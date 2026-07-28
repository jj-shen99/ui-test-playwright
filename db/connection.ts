/**
 * Database connection setup using Drizzle ORM + pg.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://grafana_test:grafana_test@localhost:5432/grafana_ui_testing";

const pool = new Pool({ connectionString: DATABASE_URL });

export const db = drizzle(pool, { schema });
export { pool };
