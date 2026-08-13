import { Router } from 'express';
import { canAccessAthlete, requireAuth } from '../auth.js';
import { db, makeId, normalizeAthleteMeta, touch } from '../store.js';

export function athletesRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req, res) => res.json(db.athletes.filter((athlete) => canAccessAthlete(req.user, athlete))));

  router.post('/', (req, res) => {
    if (db.settings.registrationLocked && req.user.role === 'unit_owner') return res.status(423).json({ message: 'Đăng ký đã chốt, không thể thêm thí sinh' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Tên thí sinh là bắt buộc' });
    const meta = normalizeAthleteMeta(req.body);
    const athlete = {
      id: makeId(),
      name,
      ...meta,
      ownerId: req.user.role === 'unit_owner' ? req.user.id : (req.body.ownerId || null),
      unit: req.user.role === 'unit_owner' ? req.user.unitName : meta.unit,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.athletes.push(athlete);
    return res.status(201).json(athlete);
  });

  router.put('/:id', (req, res) => {
    if (db.settings.registrationLocked && req.user.role === 'unit_owner') return res.status(423).json({ message: 'Đăng ký đã chốt, không thể sửa thí sinh' });
    const athlete = db.athletes.find((row) => row.id === req.params.id);
    if (!athlete) return res.status(404).json({ message: 'Không tìm thấy thí sinh' });
    if (!canAccessAthlete(req.user, athlete)) return res.status(403).json({ message: 'Bạn không được sửa thí sinh này' });
    if (req.body.name) athlete.name = req.body.name;
    const meta = normalizeAthleteMeta({ ...athlete, ...req.body });
    Object.assign(athlete, meta);
    touch(athlete);
    return res.json(athlete);
  });

  router.delete('/:id', (req, res) => {
    if (db.settings.registrationLocked && req.user.role === 'unit_owner') return res.status(423).json({ message: 'Đăng ký đã chốt, không thể xóa thí sinh' });
    const index = db.athletes.findIndex((row) => row.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: 'Không tìm thấy thí sinh' });
    if (!canAccessAthlete(req.user, db.athletes[index])) return res.status(403).json({ message: 'Bạn không được xóa thí sinh này' });
    db.athletes.splice(index, 1);
    return res.status(204).send();
  });

  return router;
}
