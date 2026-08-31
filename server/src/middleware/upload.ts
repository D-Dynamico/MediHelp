import multer from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../utils/apiError.js';
import { storage, type StoredImage } from '../providers/storage/index.js';

/**
 * Accepting an image from the internet.
 *
 * Two checks, because the first one is a courtesy and the second is the real
 * one. `Content-Type` is whatever the client typed in the request — a PHP file
 * announced as `image/png` passes it without trouble. What actually decides is
 * the first few bytes of the file, which are the format, not a claim about it.
 *
 * Files are held in memory rather than written to a temp directory: they are
 * capped at 2 MB, they go straight to a storage provider that may not be a
 * disk at all, and nothing lands on the filesystem until it has been checked.
 */

/** Two megabytes is generous for a profile photo and cheap to hold in memory. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * The formats worth supporting, each with the bytes that identify it.
 *
 * SVG is deliberately absent: it is a document that can carry script, so a
 * stored SVG served from our own origin is a cross-site scripting hole.
 */
const SIGNATURES: { mimeType: string; extension: string; matches: (head: Buffer) => boolean }[] = [
  {
    mimeType: 'image/jpeg',
    extension: '.jpg',
    matches: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    extension: '.png',
    matches: (head) => head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/webp',
    extension: '.webp',
    // "RIFF" then four size bytes then "WEBP".
    matches: (head) =>
      head.subarray(0, 4).toString('latin1') === 'RIFF' &&
      head.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const ACCEPTED_MIME_TYPES = SIGNATURES.map((signature) => signature.mimeType);

/** The format the bytes really are, or null if it is not one we accept. */
export function detectImage(buffer: Buffer): { mimeType: string; extension: string } | null {
  if (buffer.length < 12) return null;
  const head = buffer.subarray(0, 12);
  const found = SIGNATURES.find((signature) => signature.matches(head));
  return found ? { mimeType: found.mimeType, extension: found.extension } : null;
}

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    // The cheap rejection, so an obvious mismatch never reaches memory.
    if (!ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      callback(ApiError.badRequest('Upload a JPEG, PNG or WebP image.'));
      return;
    }
    callback(null, true);
  },
});

/**
 * Accepts one optional image field, checks its bytes, and stores it.
 *
 * On success `req.uploadedImage` holds where it landed. The field being absent
 * is not an error — every caller so far treats the image as optional — but a
 * field that is present and is not really an image is.
 */
export function uploadImage(field: string): RequestHandler[] {
  const receive = multerUpload.single(field);

  const handleMulter: RequestHandler = (req, res, next) => {
    receive(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        // Multer's own messages are for developers ("File too large"); these are
        // for whoever is looking at the form.
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(ApiError.badRequest('That image is over 2 MB. Choose a smaller one.'));
          return;
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
          next(ApiError.badRequest(`Send the image in the "${field}" field.`));
          return;
        }
      }
      next(error);
    });
  };

  const verifyAndStore = async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.file) {
      next();
      return;
    }

    // The check that counts: what the bytes say, not what the request claimed.
    const detected = detectImage(req.file.buffer);
    if (!detected) {
      next(ApiError.badRequest('That file is not a JPEG, PNG or WebP image.'));
      return;
    }

    req.uploadedImage = await storage().save({
      buffer: req.file.buffer,
      extension: detected.extension,
      mimeType: detected.mimeType,
    });
    next();
  };

  return [handleMulter, verifyAndStore as RequestHandler];
}

export type { StoredImage };
