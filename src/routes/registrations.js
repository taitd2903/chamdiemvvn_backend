import { Router } from 'express';
import { canAccessAthlete, requireAdmin, requireAuth } from '../auth.js';
import { db, makeId, matchesContentCriteria } from '../store.js';

export function registrationsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/status', (req, res) => res.json({ locked: Boolean(db.settings.registrationLocked) }));
  router.post('/lock', requireAdmin, (req, res) => {
    if (db.registrations.length === 0) {
      return res.status(400).json({ message: 'Chưa có thí sinh nào được đăng ký vào nội dung' });
    }
    db.settings.registrationLocked = true;
    db.settings.updatedAt = new Date().toISOString();
    return res.json({ locked: true });
  });

  router.post('/unlock', requireAdmin, (req, res) => {
    const hasGeneratedSchedule = db.formEntries.length > 0 || db.brackets.length > 0;
    if (hasGeneratedSchedule) {
      return res.status(409).json({ message: 'Không thể mở lại vì đã tạo lượt Quyền hoặc đã bốc thăm Đối kháng' });
    }
    db.settings.registrationLocked = false;
    db.settings.updatedAt = new Date().toISOString();
    return res.json({ locked: false });
  });

  router.get('/', (req, res) => {
    const allowedAthletes = new Set(db.athletes.filter((athlete) => canAccessAthlete(req.user, athlete)).map((athlete) => athlete.id));
    const rows = db.registrations.filter((registration) => allowedAthletes.has(registration.athleteId)).map((registration) => ({
      ...registration,
      athlete: db.athletes.find((athlete) => athlete.id === registration.athleteId) || null,
      content: db.contents.find((content) => content.id === registration.contentId) || null
    }));
    res.json(rows);
  });

  router.post('/', (req, res) => {
    if (db.settings.registrationLocked) return res.status(423).json({ message: 'Đăng ký đã được Admin chốt' });
    const { athleteId, contentId } = req.body;
    const athlete = db.athletes.find((row) => row.id === athleteId);
    const content = db.contents.find((row) => row.id === contentId);
    if (!athlete || !content) {
      return res.status(400).json({ message: 'Thí sinh hoặc nội dung không hợp lệ' });
    }
    if (!canAccessAthlete(req.user, athlete)) return res.status(403).json({ message: 'Bạn chỉ được đăng ký cho thí sinh của đơn vị mình' });
    if (!matchesContentCriteria(athlete, content)) {
      return res.status(400).json({ message: 'Thí sinh không phù hợp tiêu chí nội dung thi' });
    }
    const limitKey = content.type === 'form' ? 'formContentLimitPerUnit' : 'fightingContentLimitPerUnit';
    const unitLimit = Number(db.settings[limitKey] || 0);
    if (unitLimit > 0) {
      const unitKey = String(athlete.unit || '').trim().toLocaleLowerCase('vi');
      const unitContentIds = new Set(db.registrations.filter((row) => {
        const registeredAthlete = db.athletes.find((item) => item.id === row.athleteId);
        const registeredContent = db.contents.find((item) => item.id === row.contentId);
        return String(registeredAthlete?.unit || '').trim().toLocaleLowerCase('vi') === unitKey && registeredContent?.type === content.type;
      }).map((row) => row.contentId));
      if (!unitContentIds.has(content.id) && unitContentIds.size >= unitLimit) {
        return res.status(409).json({ message: `Đơn vị ${athlete.unit || '(trống)'} đã đạt giới hạn ${unitLimit} nội dung ${content.type === 'form' ? 'Quyền' : 'Đối kháng'} của giải` });
      }
    }
    if (content.type === 'fighting') {
      const unitKey = String(athlete.unit || '').trim().toLocaleLowerCase('vi');
      const sameUnit = db.registrations.some((row) => row.contentId === contentId && String(db.athletes.find((item) => item.id === row.athleteId)?.unit || '').trim().toLocaleLowerCase('vi') === unitKey);
      if (sameUnit) return res.status(409).json({ message: 'Mỗi đơn vị chỉ được đăng ký 1 VĐV trong một nội dung Đối kháng' });
    }
    const existed = db.registrations.some((row) => row.athleteId === athleteId && row.contentId === contentId);
    if (existed) return res.status(409).json({ message: 'Thí sinh đã đăng ký nội dung này' });

    const registration = {
      id: makeId(),
      athleteId,
      contentId,
      createdAt: new Date().toISOString()
    };
    db.registrations.push(registration);
    return res.status(201).json(registration);
  });

  router.delete('/:id', (req, res) => {
    if (db.settings.registrationLocked) return res.status(423).json({ message: 'Đăng ký đã được Admin chốt' });
    const index = db.registrations.findIndex((row) => row.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: 'Không tìm thấy đăng ký' });
    const athlete = db.athletes.find((row) => row.id === db.registrations[index].athleteId);
    if (!canAccessAthlete(req.user, athlete)) return res.status(403).json({ message: 'Bạn không được xóa đăng ký này' });
    db.registrations.splice(index, 1);
    return res.status(204).send();
  });

  return router;
}
