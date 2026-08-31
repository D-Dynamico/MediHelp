import type { RequestHandler } from 'express';
import * as adminService from './admin.service.js';

/** The HTTP layer for the admin panel. Rules live in the service. */

export const dashboard: RequestHandler = async (_req, res) => {
  res.json(await adminService.dashboard());
};
