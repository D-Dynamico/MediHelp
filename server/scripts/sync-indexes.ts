/**
 * Builds any index the schemas declare that the database is missing.
 *
 * Run with: npm run sync:indexes --workspace server
 *
 * For a database that already has data and was set up without them. The server
 * does not build indexes itself in production (see `connectDb`), and the seed
 * only learned to on 2026-10-02, after the live database was seeded. It only
 * adds: an index the schema no longer declares is left alone, and no document is
 * read or changed. Running it twice does nothing the second time.
 *
 * If a unique index cannot be built, the data already breaks the rule it
 * enforces (two active bookings in one slot, say). The error names the index;
 * fix the data, then run this again.
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { ensureIndexes } from '../src/models/index.js';

await connectDb();
const db = mongoose.connection.db!;

const count = async (): Promise<number> => {
  let total = 0;
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    total += (await db.collection(name).indexes()).length;
  }
  return total;
};

const before = await count();
await ensureIndexes();
const after = await count();

console.log(`\n  ${mongoose.connection.name}: ${after - before} index(es) added, ${after} in total.\n`);
await disconnectDb();
