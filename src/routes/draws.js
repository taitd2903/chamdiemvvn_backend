import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth.js';
import { db } from '../store.js';
import { createFormSchedule, drawFightingBracket, syncAllBrackets } from '../services/draw.js';

export function drawsRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get('/brackets', (req, res) => {
    if (!['admin', 'unit_owner'].includes(req.user.role)) return res.status(403).json({ message: 'Tài khoản không có quyền xem Sigma' });
    return res.json(syncAllBrackets());
  });
  router.post('/fighting', requireAdmin, (req, res) => {
    try { return res.status(201).json(drawFightingBracket(req.body)); }
    catch (error) { return res.status(400).json({ message: error.message }); }
  });
  router.post('/forms', requireAdmin, (req, res) => {
    try { return res.status(201).json(createFormSchedule(req.body)); }
    catch (error) { return res.status(400).json({ message: error.message }); }
  });
  return router;
}
