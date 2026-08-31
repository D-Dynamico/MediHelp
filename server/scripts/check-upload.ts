/**
 * Checks what the upload middleware accepts and what it refuses, by posting
 * real multipart bodies at a real route.
 *
 * Run with: npm run check:upload --workspace server
 *
 * The interesting case is the last one: a file whose Content-Type says PNG but
 * whose bytes are a script. Nothing but the magic-byte check catches it.
 */
import express from 'express';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/upload-check';
process.env.JWT_SECRET = 'e'.repeat(48);
process.env.LOG_LEVEL = 'error';

const { uploadImage, detectImage, MAX_UPLOAD_BYTES } = await import('../src/middleware/upload.js');
const { notFound, errorHandler } = await import('../src/middleware/error.js');
const { UPLOAD_DIR } = await import('../src/providers/storage/local.js');
const { storage, resetStorage } = await import('../src/providers/storage/index.js');
const { signForTest } = await import('../src/providers/storage/cloudinary.js');

const app = express();
app.post('/upload', ...uploadImage('image'), (req, res) => {
  res.json({ image: req.uploadedImage ?? null });
});
app.use(notFound);
app.use(errorHandler);

const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

/** Smallest bytes that still identify each format. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(64, 3),
]);
const SCRIPT = Buffer.from('<?php system($_GET["c"]); ?>'.padEnd(80, ' '));
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function post(bytes: Buffer, filename: string, contentType: string, field = 'image') {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const response = await fetch(`${base}/upload`, { method: 'POST', body: form });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, never> };
}

// --- detection, directly -------------------------------------------------
check('PNG bytes are detected as PNG', detectImage(PNG)?.mimeType === 'image/png');
check('JPEG bytes are detected as JPEG', detectImage(JPEG)?.mimeType === 'image/jpeg');
check('WebP bytes are detected as WebP', detectImage(WEBP)?.mimeType === 'image/webp');
check('a script is not detected as an image', detectImage(SCRIPT) === null);
check('an SVG is not accepted as an image', detectImage(SVG) === null);
check('a file too short to identify is refused', detectImage(Buffer.from([0x89, 0x50])) === null);

// --- over HTTP -----------------------------------------------------------
const ok = await post(PNG, 'avatar.png', 'image/png');
const saved = (ok.body as unknown as { image: { url: string; key: string } | null }).image;
check('a real PNG is accepted', ok.status === 200 && saved !== null, ok.body);
check('the stored name is not the uploaded one', !saved?.key.includes('avatar'), saved?.key);
check('the stored name keeps the right extension', saved?.key.endsWith('.png') === true, saved?.key);
check('the url is servable from /uploads', saved?.url.startsWith('/uploads/') === true, saved?.url);

const onDisk = await fs.readFile(`${UPLOAD_DIR}/${saved!.key}`).catch(() => null);
check('the bytes reached the disk unchanged', onDisk?.equals(PNG) === true);

const jpeg = await post(JPEG, 'photo.jpg', 'image/jpeg');
check('a real JPEG is accepted', jpeg.status === 200, jpeg.status);

const wrongField = await post(PNG, 'avatar.png', 'image/png', 'photo');
check('an image sent in the wrong field is refused clearly', wrongField.status === 400, wrongField);
check(
  'the wrong-field message names the field to use',
  String((wrongField.body as unknown as { error?: { message?: string } }).error?.message).includes('"image"'),
  wrongField.body,
);

const noFile = await fetch(`${base}/upload`, { method: 'POST', body: new FormData() });
check('a request with no image at all is fine', noFile.status === 200, noFile.status);

const declaredPng = await post(SCRIPT, 'shell.png', 'image/png');
check(
  'a script announced as a PNG is refused',
  declaredPng.status === 400,
  declaredPng.body,
);

const wrongType = await post(PNG, 'avatar.gif', 'image/gif');
check('an unsupported content type is refused', wrongType.status === 400, wrongType.status);

const tooBig = await post(
  Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES, 7)]),
  'huge.png',
  'image/png',
);
check('an image over 2 MB is refused', tooBig.status === 400, tooBig.status);
check(
  'the too-big message says the limit',
  String((tooBig.body as unknown as { error?: { message?: string } }).error?.message).includes('2 MB'),
  tooBig.body,
);

// --- provider selection --------------------------------------------------
check('local is the default provider', storage().name === 'local');

// The Cloudinary signature, which is the only part of that provider worth
// asserting without an account: sorted params, then the secret, then SHA-1.
// Cloudinary documents this exact example shape.
check(
  'the cloudinary signature is over sorted params plus the secret',
  signForTest({ timestamp: '1', folder: 'medihelp' }, 'secret') ===
    (await import('node:crypto')).createHash('sha1').update('folder=medihelp&timestamp=1secret').digest('hex'),
);

// --- tidy up -------------------------------------------------------------
for (const key of [saved?.key, (jpeg.body as unknown as { image?: { key: string } }).image?.key]) {
  if (key) await fs.unlink(`${UPLOAD_DIR}/${key}`).catch(() => undefined);
}
resetStorage();

console.log(`\n${results.join('\n')}\n`);

server.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
