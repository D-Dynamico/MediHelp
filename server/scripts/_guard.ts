/**
 * Every check script must run against a throwaway database.
 *
 * The checks connect through `connectDb()` so they inherit the server's global
 * mongoose settings — which means they also inherit `MONGODB_URI`. A script that
 * forgets to point that at its own in-memory server would silently run against
 * whatever is in .env, writing test data into a real database. One did. This
 * makes that impossible rather than merely unlikely.
 */
export function assertThrowawayDatabase(): void {
  const uri = process.env.MONGODB_URI ?? '';

  const looksHosted = uri.startsWith('mongodb+srv://') || !/127\.0\.0\.1|localhost/.test(uri);
  if (looksHosted) {
    console.error(
      `\n  Refusing to run: this check is pointed at a real database.\n` +
        `  MONGODB_URI must be an in-memory server, got: ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')}\n\n` +
        '  Set process.env.MONGODB_URI = mongod.getUri() before importing connectDb.\n',
    );
    process.exit(1);
  }
}
