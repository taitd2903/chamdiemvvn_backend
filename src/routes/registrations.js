import { Router } from 'express';
import { db, makeId, matchesContentCriteria } from '../store.js';

export function registrationsRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    const rows = db.registrations.map((registration) => ({
      ...registration,
      athlete: db.athletes.find((athlete) => athlete.id === registration.athleteId) || null,
      content: db.contents.find((content) => content.id === registration.contentId) || null
    }));
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const { athleteId, contentId } = req.body;
    const athlete = db.athletes.find((row) => row.id === athleteId);
    const content = db.contents.find((row) => row.id === contentId);
    if (!athlete || !content) {
      return res.status(400).json({ message: 'Thí sinh hoặc nội dung không hợp lệ' });
    }
    if (!matchesContentCriteria(athlete, content)) {
      return res.status(400).json({ message: 'Thí sinh không phù hợp tiêu chí nội dung thi' });
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
    const index = db.registrations.findIndex((row) => row.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: 'Không tìm thấy đăng ký' });
    db.registrations.splice(index, 1);
    return res.status(204).send();
  });

  return router;
}
