import { Router } from 'express';
import { db, makeId, normalizeAthleteMeta, touch } from '../store.js';

export function athletesRouter() {
  const router = Router();

  router.get('/', (req, res) => res.json(db.athletes));

  router.post('/', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Tên thí sinh là bắt buộc' });
    const meta = normalizeAthleteMeta(req.body);
    const athlete = {
      id: makeId(),
      name,
      ...meta,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.athletes.push(athlete);
    return res.status(201).json(athlete);
  });

  router.put('/:id', (req, res) => {
    const athlete = db.athletes.find((row) => row.id === req.params.id);
    if (!athlete) return res.status(404).json({ message: 'Không tìm thấy thí sinh' });
    if (req.body.name) athlete.name = req.body.name;
    const meta = normalizeAthleteMeta({ ...athlete, ...req.body });
    Object.assign(athlete, meta);
    touch(athlete);
    return res.json(athlete);
  });

  router.delete('/:id', (req, res) => {
    const index = db.athletes.findIndex((row) => row.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: 'Không tìm thấy thí sinh' });
    db.athletes.splice(index, 1);
    return res.status(204).send();
  });

  return router;
}
