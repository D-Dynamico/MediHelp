/**
 * Checks the token utilities behave the way the auth design assumes.
 * Run with: npm run check:tokens --workspace server
 */
process.env.MONGODB_URI ??= 'mongodb://localhost:27017/unused';
process.env.JWT_SECRET ??= 'a'.repeat(48);
process.env.ACCESS_TOKEN_TTL ??= '15m';

const {
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  hashRefreshToken,
  newTokenFamily,
  durationToMs,
  refreshTokenExpiry,
} = await import('../src/utils/tokens.js');
const { hashPassword, verifyPassword } = await import('../src/utils/password.js');

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

// --- durations ---
check('durations parse', durationToMs('15m') === 900_000 && durationToMs('7d') === 604_800_000);
check('refresh expiry is in the future', refreshTokenExpiry().getTime() > Date.now());

// --- access tokens ---
const token = signAccessToken({ sub: 'user-1', role: 'doctor' });
const payload = verifyAccessToken(token);
check('a signed token round-trips', payload.sub === 'user-1' && payload.role === 'doctor', payload);

const tampered = token.slice(0, -3) + 'abc';
let rejectedTampered = false;
try {
  verifyAccessToken(tampered);
} catch {
  rejectedTampered = true;
}
check('a tampered token is rejected', rejectedTampered);

let rejectedOtherSecret = false;
try {
  const jwt = (await import('jsonwebtoken')).default;
  verifyAccessToken(jwt.sign({ sub: 'user-1', role: 'admin' }, 'a-different-secret', { issuer: 'medihelp' }));
} catch {
  rejectedOtherSecret = true;
}
check('a token signed with another secret is rejected', rejectedOtherSecret);

let rejectedExpired = false;
try {
  const jwt = (await import('jsonwebtoken')).default;
  verifyAccessToken(
    jwt.sign({ sub: 'user-1', role: 'patient' }, process.env.JWT_SECRET!, {
      issuer: 'medihelp',
      expiresIn: '-1s',
    }),
  );
} catch {
  rejectedExpired = true;
}
check('an expired token is rejected', rejectedExpired);

// The access token is readable by anyone holding it, so it must carry nothing secret.
const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
check(
  'the access token carries only an id, a role and timing',
  Object.keys(claims).sort().join(',') === 'exp,iat,iss,role,sub',
  Object.keys(claims),
);

// --- refresh tokens ---
const a = createRefreshToken();
const b = createRefreshToken();
check('refresh tokens are unique', a.token !== b.token);
check('refresh tokens are long', a.token.length >= 40, a.token.length);
check('the stored hash is not the token', a.tokenHash !== a.token);
check('hashing is repeatable for lookup', hashRefreshToken(a.token) === a.tokenHash);
check('a different token hashes differently', hashRefreshToken(b.token) !== a.tokenHash);
check('families are unique', newTokenFamily() !== newTokenFamily());

// --- passwords ---
const hash = await hashPassword('Password123!');
check('password hashes use bcrypt', hash.startsWith('$2'), hash.slice(0, 4));
check('the right password verifies', await verifyPassword('Password123!', hash));
check('the wrong password does not', !(await verifyPassword('Password123', hash)));
check('the same password hashes differently each time', (await hashPassword('Password123!')) !== hash);

console.log(`\n${results.join('\n')}\n`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
