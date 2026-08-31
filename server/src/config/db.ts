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
  // Surface a bad query shape in development instead of silently returning nothing.
  mongoose.set('sanitizeFilter', true);

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
