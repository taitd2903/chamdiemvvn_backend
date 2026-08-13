import { Router } from 'express';
import { clearFightingData, db, getAreaState, getGlobalState, resetTournamentData, touchSettings } from '../store.js';

export function settingsRouter(io) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(db.settings);
  });

  router.put('/', (req, res) => {
    const { tournamentName, logoLeftUrl, logoRightUrl, formContentLimitPerUnit, fightingContentLimitPerUnit } = req.body;

    if (tournamentName !== undefined) {
      const value = String(tournamentName || '').trim();
      if (!value) return res.status(400).json({ message: 'Tên giải không được để trống' });
      db.settings.tournamentName = value;
    }

    if (logoLeftUrl !== undefined) db.settings.logoLeftUrl = String(logoLeftUrl || '').trim();
    if (logoRightUrl !== undefined) db.settings.logoRightUrl = String(logoRightUrl || '').trim();
    for (const [key, value] of Object.entries({ formContentLimitPerUnit, fightingContentLimitPerUnit })) {
      if (value === undefined) continue;
      if (value === '' || value === null || Number(value) === 0) db.settings[key] = null;
      else {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1) return res.status(400).json({ message: 'Giới hạn nội dung phải là số nguyên từ 1 trở lên hoặc để trống nếu không giới hạn' });
        db.settings[key] = limit;
      }
    }
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

  router.post('/clear-fighting-data', (req, res) => {
    const result = clearFightingData();
    io.emit('admin:state', result.state);
    db.areas.forEach((area) => {
      io.to(`area:${area.id}`).emit('area:state', getAreaState(area.id));
    });
    return res.json({
      message: `Đã xóa ${result.removedMatches} trận Đối kháng và ${result.removedBrackets} sơ đồ Sigma. Thí sinh và đăng ký được giữ nguyên.`,
      ...result
    });
  });

  return router;
}
