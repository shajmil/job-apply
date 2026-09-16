import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
export const pool = new pg.Pool({connectionString: env.databaseUrl});
export const database = drizzle(pool);
