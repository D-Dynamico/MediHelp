import mongoose from 'mongoose';
import { getSettings } from './env.js';
import { logger } from './logger.js';

/**
 * Mongo connection handling. Fails loudly and readably at startup rather than
 * letting the first request discover there is no database.
 */

/** Hides credentials so a connection string can safely appear in a log line. */
export function redactUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

export async function connectDb(): Promise<typeof mongoose> {
  const { MONGODB_URI } = getSettings();

  mongoose.set('strictQuery', true);

  /**
   * `sanitizeFilter` is deliberately OFF.
   *
   * It guards against passing a raw request object straight into a filter, where
   * `{"email": {"$ne": null}}` would match everyone. We close that at the
   * boundary instead: every request body, query and param goes through a zod
   * schema that strips undeclared keys and types each field, so an object can
   * never arrive where a string is expected. Filters are built here from typed
   * values, never forwarded.
   *
   * Leaving it on cost more than it bought. It rewrites *any* operator object
   * into an equality match, so every legitimate `$in`, `$gte` or `$exists` needs
   * `mongoose.trusted()` — and forgetting one fails at runtime, not compile
   * time. It had already broken refresh-token reuse detection: the family
   * revocation threw a cast error instead of running, so a replayed token was
   * never caught. A protection whose failure mode is silently disabling a
   * security feature is the wrong trade here.
   *
   * The rule that replaces it: never build a filter from an object the client
   * sent. Take validated, typed fields.
   */

  mongoose.connection.on('disconnected', () => logger.warn('Mongo disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('Mongo reconnected'));

  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      autoIndex: !getSettings().isProduction,
    });
    logger.info('Mongo connected', {
      uri: redactUri(MONGODB_URI),
      db: conn.connection.name,
    });
    return conn;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not connect to MongoDB at ${redactUri(MONGODB_URI)}\n  ${reason}\n\n` +
        'Check that MONGODB_URI is correct, the database user exists, and your IP is ' +
        'allowed under Atlas → Network Access.',
    );
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  logger.info('Mongo disconnected');
}
