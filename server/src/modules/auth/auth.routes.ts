import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import * as controller from './auth.controller.js';

/**
 * Auth endpoints. Mounted at /api/auth, which is also the path the refresh
 * cookie is scoped to.
 */
export const authRouter = Router();

authRouter.post('/register', validate({ body: registerSchema }), controller.register);
authRouter.post('/login', validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', controller.refresh);
authRouter.post('/logout', controller.logout);

// `/me` is added in 3.4, once the guard exists to protect it.
