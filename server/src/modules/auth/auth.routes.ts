import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter, registerLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import * as controller from './auth.controller.js';

/**
 * Auth endpoints. Mounted at /api/auth, which is also the path the refresh
 * cookie is scoped to.
 */
export const authRouter = Router();

authRouter.post('/register', registerLimiter, validate({ body: registerSchema }), controller.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', authLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);

authRouter.get('/me', requireAuth, controller.me);
