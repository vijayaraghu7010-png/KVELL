import 'dotenv/config';
import { createApp } from './server/app';
import { db } from './server/db/database';
import { startJobs } from './server/jobs';

const PORT = Number(process.env.PORT || 5000);

// Open the database and apply pending migrations before accepting requests.
const database = db();
const users = database.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')!.c;

const app = createApp();
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('  KVCET Hostel Management System — API server');
  console.log(`  http://localhost:${PORT}   (health: /api/health)`);
  console.log(`  Database: ${database.file}`);
  if (users === 0) {
    console.log('  No user accounts exist yet. Create the first administrator with:');
    console.log('    npm run admin:create -- --email you@kvcet.edu.in --name "Your Name"');
  }
  console.log('====================================================');
});

startJobs();

export default app;
