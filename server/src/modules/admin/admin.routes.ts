import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as controller from './admin.controller.js';

/**
 * Admin-only endpoints, mounted at /api/admin.
 *
 * The two guards are applied to the router rather than route by route, so a
 * route added later cannot be left unprotected by forgetting to repeat them.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.get('/dashboard', controller.dashboard);
