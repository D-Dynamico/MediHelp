import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../config/logger.js';
import type { StorageProvider, StoredImage } from './index.js';

/**
 * Writes uploads to `server/uploads/` and serves them from `/uploads`.
 *
 * The default, so the project needs no third-party account to run. Fine for
 * development and for a demo; not for production on Render, whose disk is
 * ephemeral — that is what the Cloudinary provider is for.
 */

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Absolute path to the upload directory. Exported so `app.ts` can serve it. */
export const UPLOAD_DIR = path.join(serverRoot, 'uploads');

/** The URL prefix the files are served under. */
export const UPLOAD_URL_PREFIX = '/uploads';

export const localStorage: StorageProvider = {
  name: 'local',

  async save({ buffer, extension }): Promise<StoredImage> {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    // A random name, never the client's. An attacker who controls the filename
    // controls the extension, and can overwrite someone else's file by
    // uploading one with the same name.
    const filename = `${randomUUID()}${extension}`;
    await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);

    return { url: `${UPLOAD_URL_PREFIX}/${filename}`, key: filename };
  },

  async remove(key): Promise<void> {
    // `basename` so a key like "../../.env" cannot escape the upload directory,
    // however it got here.
    const target = path.join(UPLOAD_DIR, path.basename(key));
    try {
      await fs.unlink(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      logger.warn('Could not remove an uploaded file', { key, code });
    }
  },
};
