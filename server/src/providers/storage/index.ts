import { getSettings } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { localStorage } from './local.js';
import { cloudinaryStorage } from './cloudinary.js';

/**
 * Where uploaded images go.
 *
 * Local is the default and always works with no account, so the project runs
 * from a fresh clone. Cloudinary takes over only when the provider is chosen
 * *and* every key is present — Render's disk is wiped on each deploy, so an
 * image written locally in production disappears the next time the service
 * restarts (see docs/DEPLOYMENT.md).
 *
 * Adding a provider must never change a caller. Both sides of this interface
 * take bytes and hand back a URL; nothing above here knows which one ran.
 */

export interface StoredImage {
  /** What goes in `User.image` — a path the client can load directly. */
  url: string;
  /** Handle for deleting it later. A local path, or a Cloudinary public id. */
  key: string;
}

export interface StorageProvider {
  readonly name: 'local' | 'cloudinary';
  /** Stores the bytes under a random name and returns where they landed. */
  save(file: { buffer: Buffer; extension: string; mimeType: string }): Promise<StoredImage>;
  /** Best-effort removal. Never throws: a stranded file is not worth a 500. */
  remove(key: string): Promise<void>;
}

let cached: StorageProvider | null = null;

/** The provider chosen from the environment, decided once at first use. */
export function storage(): StorageProvider {
  if (cached) return cached;

  const { useCloudinary, STORAGE_PROVIDER } = getSettings();

  if (STORAGE_PROVIDER === 'cloudinary' && !useCloudinary) {
    // Falling back silently would put images on a disk that production erases.
    // Say so loudly instead, at startup, while someone is still watching.
    logger.warn(
      'STORAGE_PROVIDER is cloudinary but the keys are incomplete — falling back to local storage. ' +
        'Uploads will not survive a redeploy.',
    );
  }

  cached = useCloudinary ? cloudinaryStorage : localStorage;
  logger.info(`Image storage: ${cached.name}`);
  return cached;
}

/** Forgets the cached choice. For scripts and tests only. */
export function resetStorage(): void {
  cached = null;
}
