import { Router } from 'express';
import { getPublicTournamentState } from '../services/publicStats.js';

export function publicRouter() {
  const router = Router();
  router.get('/tournament', (req, res) => res.json(getPublicTournamentState()));
  return router;
}
