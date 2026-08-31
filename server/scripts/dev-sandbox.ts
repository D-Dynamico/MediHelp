/**
 * Runs the real server against a throwaway, freshly seeded database.
 *
 * Run with: npm run dev:sandbox --workspace server
 *
 * For looking at the app in a browser without pointing it at Atlas. Everything
 * else is the real thing — the same `createApp()`, the same seed, the same
 * demo accounts — so what you see is what the app does, and nothing you click
 * touches real data. Stops the in-memory server on exit.
 *
 * Runs under `tsx watch`, so an edit reloads it. That also reseeds, which is the
 * right behaviour here: the database is scratch, and a sandbox that quietly
 * serves a schema the source no longer has is worse than one that resets.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// A replica set, not a single server: adding a doctor runs in a transaction.
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET ??= 'sandbox'.padEnd(48, '-');

const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();

const { connectDb } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { seedDatabase } = await import('../src/seed.js');
const { getSettings } = await import('../src/config/env.js');

await connectDb();
await mongoose.connection.syncIndexes();
const seeded = await seedDatabase();

const port = getSettings().PORT;
const server = createApp().listen(port, () => {
  console.log(`\n  Sandbox server on http://localhost:${port}`);
  console.log('  Throwaway in-memory database, seeded. Nothing here is real.\n');
  console.log(`  admin    ${seeded.credentials.admin} / ${seeded.credentials.adminPassword}`);
  console.log(`  doctor   ${seeded.credentials.doctor} / ${seeded.credentials.password}`);
  console.log(`  patient  ${seeded.credentials.patient} / ${seeded.credentials.password}\n`);
});

async function shutdown() {
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
