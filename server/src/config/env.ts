import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Settings are parsed once and cached. A change to .env therefore needs a server
 * restart to take effect — `reloadSettings()` exists for scripts and tests only.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const SECRET_HINT =
  'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';

/** Minutes/hours/days strings like "15m", "7d" — the format jsonwebtoken accepts. */
const duration = z
  .string()
  .regex(/^\d+[smhd]$/, 'expected a duration like 15m, 24h or 7d');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z
    .string({ error: 'required — a MongoDB Atlas connection string, see .env.example' })
    .min(1, 'required — a MongoDB Atlas connection string, see .env.example')
    .refine(
      (uri) => uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'),
      'must start with mongodb:// or mongodb+srv://',
    ),

  JWT_SECRET: z
    .string({ error: SECRET_HINT })
    .min(32, `must be at least 32 characters. ${SECRET_HINT}`),
  ACCESS_TOKEN_TTL: duration.default('15m'),
  REFRESH_TOKEN_TTL: duration.default('7d'),

  /** Normally empty: the client is served from the same origin as the API. */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((o) => o.trim()).filter(Boolean)),

  SEED_ADMIN_EMAIL: z.email().default('admin@medihelp.test'),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),

  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  TRIAGE_MODEL: z.string().default('claude-sonnet-5'),
  TRIAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Settings = z.infer<typeof schema> & {
  isProduction: boolean;
  /** Cloudinary is only usable when the provider is chosen and all keys are set. */
  useCloudinary: boolean;
};

let cached: Settings | null = null;

/**
 * A key present but empty (`SEED_ADMIN_PASSWORD=` straight out of .env.example)
 * means "not set", not "set to the empty string". Without this, copying the
 * example file and filling in only the required keys fails at startup with a
 * complaint about a field the user was told is optional.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') cleaned[key] = value;
  }
  return cleaned;
}

function parse(): Settings {
  const result = schema.safeParse(withoutBlanks(process.env));

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    // Thrown, not process.exit, so tests can assert on it. index.ts prints it plainly.
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\nCopy .env.example to .env and fill in the required keys.`,
    );
  }

  const env = result.data;

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    useCloudinary:
      env.STORAGE_PROVIDER === 'cloudinary' &&
      Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET),
  };
}

/** The parsed settings. Cached after the first call. */
export function getSettings(): Settings {
  cached ??= parse();
  return cached;
}

/** Re-read process.env. For scripts and tests — never call this from a request. */
export function reloadSettings(): Settings {
  cached = null;
  return getSettings();
}
