/**
 * Checks the settings loader, including the traps a first-time setup falls into.
 * Run with: npm run check:env --workspace server
 */
const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

const { reloadSettings } = await import('../src/config/env.js');

const base = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/medihelp',
  JWT_SECRET: 'z'.repeat(48),
};

// Snapshot once, restore before every load: leaving a key behind from a previous
// case makes a later assertion pass or fail for the wrong reason.
const original = { ...process.env };

function load(overrides: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original, base, overrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }
  return reloadSettings();
}

const settings = load({});
check('a minimal configuration loads', settings.PORT === 4000 && settings.NODE_ENV === 'development');
check('optional keys default sensibly', settings.PAYMENT_PROVIDER === 'mock' && settings.STORAGE_PROVIDER === 'local');
check('cloudinary stays off until every key is present', settings.useCloudinary === false);

// The trap: .env.example ships `SEED_ADMIN_PASSWORD=`, and a blank value is not
// the same as an unset one unless the loader says so.
const blanks = load({ SEED_ADMIN_PASSWORD: '', RAZORPAY_KEY_ID: '', ANTHROPIC_API_KEY: '' });
check('a blank optional key is treated as unset', blanks.SEED_ADMIN_PASSWORD === undefined);
check('blank keys do not stop startup', blanks.MONGODB_URI.startsWith('mongodb+srv://'));

let missingUri = '';
try {
  load({ MONGODB_URI: undefined });
} catch (error) {
  missingUri = error instanceof Error ? error.message : String(error);
}
check('a missing database URI is refused', missingUri.includes('MONGODB_URI'));
check('the message says what to do about it', missingUri.includes('.env.example'), missingUri.slice(0, 80));
check('a missing key is reported once, not twice', (missingUri.match(/MONGODB_URI/g) ?? []).length === 1);

let shortSecret = '';
try {
  load({ JWT_SECRET: 'too-short' });
} catch (error) {
  shortSecret = error instanceof Error ? error.message : String(error);
}
check('a weak signing secret is refused', shortSecret.includes('32 characters'), shortSecret.slice(0, 80));
check('the message shows how to generate one', shortSecret.includes('randomBytes'));

const cloudinary = load({
  STORAGE_PROVIDER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'demo',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
});
check('cloudinary turns on when fully configured', cloudinary.useCloudinary === true);

const halfConfigured = load({
  STORAGE_PROVIDER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'demo',
  CLOUDINARY_API_KEY: undefined,
  CLOUDINARY_API_SECRET: undefined,
});
check(
  'a half-configured cloudinary stays off rather than half-working',
  halfConfigured.useCloudinary === false,
  halfConfigured.useCloudinary,
);

console.log(`\n${results.join('\n')}\n`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
