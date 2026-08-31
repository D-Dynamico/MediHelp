import type { Role } from '@shared/types.js';
import type { StoredImage } from '../providers/storage/index.js';

/**
 * What the middleware attaches to a request. Both fields are set by the server
 * alone — `auth` only from a verified token, `uploadedImage` only from bytes
 * that have already been checked and stored — never from anything the client
 * sent directly.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: Role;
      };
      /** Where `uploadImage()` put the file, if the request carried one. */
      uploadedImage?: StoredImage;
    }
  }
}

export {};
