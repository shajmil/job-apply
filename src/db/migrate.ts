import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { database, pool } from './client.js';
try {
 // Job descriptions contain characters outside legacy code pages; a non-UTF8 database rejects them at insert time.
 const {rows}=await database.execute<{encoding:string}>(sql`select pg_encoding_to_char(encoding) as encoding from pg_database where datname = current_database()`);
 if(rows[0]?.encoding!=='UTF8') throw new Error(`Database encoding is ${rows[0]?.encoding}; recreate it with ENCODING 'UTF8' (for example: CREATE DATABASE job_agent ENCODING 'UTF8' TEMPLATE template0)`);
 await migrate(database, {migrationsFolder:'src/db/migrations'});
} finally { await pool.end(); }
