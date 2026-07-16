import { Router } from 'express';
import { db, getAreaState, getGlobalState, resetTournamentData, touchSettings } from '../store.js';

export function settingsRouter(io) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(db.settings);
  });

  router.put('/', (req, res) => {
    const { tournamentName, logoLeftUrl, logoRightUrl } = req.body;

    if (tournamentName !== undefined) {
      const value = String(tournamentName || '').trim();
      if (!value) return res.status(400).json({ message: 'Tên giải không được để trống' });
      db.settings.tournamentName = value;
    }

    if (logoLeftUrl !== undefined) db.settings.logoLeftUrl = String(logoLeftUrl || '').trim();
    if (logoRightUrl !== undefined) db.settings.logoRightUrl = String(logoRightUrl || '').trim();
    touchSettings();

    io.emit('admin:state', { settings: db.settings });
    db.areas.forEach((area) => {
      io.to(`area:${area.id}`).emit('area:state', getAreaState(area.id));
    });

    return res.json(db.settings);
  });


  router.post('/reset-tournament-data', (req, res) => {
    const state = resetTournamentData();

    io.emit('admin:state', getGlobalState());
    db.areas.forEach((area) => {
      io.to(`area:${area.id}`).emit('area:state', getAreaState(area.id));
    });

    return res.json({
      message: 'Đã reset dữ liệu thi đấu. Sân, nội dung, tên giải và logo được giữ nguyên.',
      state
    });
  });

  return router;
}
