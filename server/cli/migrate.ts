/** Applies pending SQL migrations (also done automatically when the server starts). */
import 'dotenv/config';
import { openDatabase } from '../db/database';

const database = openDatabase();
const applied = database.all<{ version: string; applied_at: string }>('SELECT version, applied_at FROM schema_migrations ORDER BY version');
console.log(`Database: ${database.file}`);
for (const m of applied) console.log(`  ✓ ${m.version}  (${m.applied_at})`);
database.close();
