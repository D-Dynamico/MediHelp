import { createHash } from 'node:crypto';
import { getSettings } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/apiError.js';
import type { StorageProvider, StoredImage } from './index.js';

/**
 * Uploads to Cloudinary over its REST API.
 *
 * Written against `fetch` and `crypto` rather than the `cloudinary` SDK on
 * purpose: the SDK would be a hard dependency installed on every machine for a
 * code path that only runs in production, where the keys are set. The signed
 * upload is one SHA-1 of the sorted parameters, which is not worth a package.
 */

const API_BASE = 'https://api.cloudinary.com/v1_1';

/** Everything the app's images live under, so they are easy to find and purge. */
const FOLDER = 'medihelp';

/**
 * Cloudinary's signature: the parameters that are being sent, minus `file`,
 * `api_key` and `resource_type`, sorted by key, joined as `k=v&k=v`, with the
 * API secret appended, then SHA-1.
 */
function sign(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

export const cloudinaryStorage: StorageProvider = {
  name: 'cloudinary',

  async save({ buffer, mimeType }): Promise<StoredImage> {
    const settings = getSettings();
    const cloudName = settings.CLOUDINARY_CLOUD_NAME!;
    const apiKey = settings.CLOUDINARY_API_KEY!;
    const apiSecret = settings.CLOUDINARY_API_SECRET!;

    const signed = { folder: FOLDER, timestamp: String(Math.floor(Date.now() / 1000)) };

    const form = new FormData();
    // Cloudinary accepts a data URI in the `file` field, which avoids having to
    // build a multipart body with a filename we would then have to sanitise.
    form.append('file', `data:${mimeType};base64,${buffer.toString('base64')}`);
    form.append('api_key', apiKey);
    for (const [key, value] of Object.entries(signed)) form.append(key, value);
    form.append('signature', sign(signed, apiSecret));

    const response = await fetch(`${API_BASE}/${cloudName}/image/upload`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      // The upstream message can carry the account's details, so it goes to the
      // log and the caller gets a plain one.
      logger.error('Cloudinary rejected an upload', {
        status: response.status,
        body: await response.text().catch(() => ''),
      });
      throw ApiError.badRequest('Could not store that image. Try again.');
    }

    const result = (await response.json()) as { secure_url: string; public_id: string };
    return { url: result.secure_url, key: result.public_id };
  },

  async remove(key): Promise<void> {
    const settings = getSettings();
    const signed = { public_id: key, timestamp: String(Math.floor(Date.now() / 1000)) };

    const form = new FormData();
    form.append('api_key', settings.CLOUDINARY_API_KEY!);
    for (const [name, value] of Object.entries(signed)) form.append(name, value);
    form.append('signature', sign(signed, settings.CLOUDINARY_API_SECRET!));

    try {
      const response = await fetch(
        `${API_BASE}/${settings.CLOUDINARY_CLOUD_NAME}/image/destroy`,
        { method: 'POST', body: form },
      );
      if (!response.ok) logger.warn('Cloudinary refused a delete', { status: response.status });
    } catch (error) {
      // A leftover image is cheaper than a failed request to the user.
      logger.warn('Could not reach Cloudinary to delete an image', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

/** Exported for the checks — the signature is the only part worth asserting on. */
export const signForTest = sign;
