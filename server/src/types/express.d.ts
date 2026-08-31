import type { Role } from '@shared/types.js';

/**
 * What the auth guard attaches to a request. Set only by `requireAuth`, and
 * only from a verified token — never from anything the client sent directly.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: Role;
      };
    }
  }
}

export {};
