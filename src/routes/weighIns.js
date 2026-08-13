import { Router } from 'express';
import { requireWeighInAccess } from '../auth.js';
import { db, getAreaState, makeId } from '../store.js';
import { syncAreaBrackets } from '../services/draw.js';

function evaluateWeight(content, actualWeight) {
  const weight = Number(actualWeight);
  const min = Number.isFinite(Number(content.weightMin)) ? Number(content.weightMin) : null;
  const max = Number.isFinite(Number(content.weightMax)) ? Number(content.weightMax) : null;
  if (!Number.isFinite(weight) || weight <= 0) return { status: 'pending', differenceKg: null, reason: '' };
  if (min !== null && weight < min) return { status: 'under', differenceKg: Number((min - weight).toFixed(2)), reason: `LOẠI – THIẾU ${Number((min - weight).toFixed(2))} KG` };
  if (max !== null && weight > max) return { status: 'over', differenceKg: Number((weight - max).toFixed(2)), reason: `LOẠI – THỪA ${Number((weight - max).toFixed(2))} KG` };
  return { status: 'passed', differenceKg: 0, reason: 'ĐỦ CÂN' };
}

function rows() {
  return db.registrations.map((registration) => {
    const athlete = db.athletes.find((row) => row.id === registration.athleteId);
    const content = db.contents.find((row) => row.id === registration.contentId);
    if (!athlete || content?.type !== 'fighting') return null;
    const weighIn = db.weighIns.find((row) => row.athleteId === athlete.id && row.contentId === content.id) || null;
    return { registrationId: registration.id, athlete, content, weighIn };
  }).filter(Boolean);
}

function refreshBrackets(io, contentId, athleteId) {
  for (const fight of db.fightMatches) {
    const isParticipant = fight.contentId === contentId && [fight.redAthleteId, fight.blueAthleteId].includes(athleteId);
    const wasResolvedByWeight = String(fight.winReason || '').startsWith('LOẠI') || fight.winReason === 'Cả hai VĐV không đạt cân';
    if (isParticipant && wasResolvedByWeight) {
      fight.status = 'pending'; fight.winner = null; fight.winReason = null; fight.updatedAt = new Date().toISOString();
    }
  }
  const areaIds = [...new Set(db.brackets.filter((bracket) => bracket.contentId === contentId).map((bracket) => bracket.areaId))];
  areaIds.forEach((areaId) => {
    syncAreaBrackets(areaId);
    io?.to(`area:${areaId}`).emit('area:state', getAreaState(areaId));
  });
}

export function weighInsRouter(io) {
  const router = Router();
  router.use(requireWeighInAccess);
  router.get('/', (req, res) => res.json(rows()));
  router.put('/:athleteId/:contentId', (req, res) => {
    const athlete = db.athletes.find((row) => row.id === req.params.athleteId);
    const content = db.contents.find((row) => row.id === req.params.contentId && row.type === 'fighting');
    const registered = db.registrations.some((row) => row.athleteId === athlete?.id && row.contentId === content?.id);
    if (!athlete || !content || !registered) return res.status(404).json({ message: 'Không tìm thấy đăng ký Đối kháng' });
    const actualWeightKg = req.body.actualWeightKg === '' || req.body.actualWeightKg === null ? null : Number(req.body.actualWeightKg);
    if (actualWeightKg !== null && (!Number.isFinite(actualWeightKg) || actualWeightKg <= 0)) return res.status(400).json({ message: 'Cân thực tế không hợp lệ' });
    const evaluation = evaluateWeight(content, actualWeightKg);
    let row = db.weighIns.find((item) => item.athleteId === athlete.id && item.contentId === content.id);
    if (row?.lockedAt) return res.status(423).json({ message: 'Kết quả cân đã chốt. Chỉ Admin có thể mở chốt để chỉnh sửa.' });
    const payload = { actualWeightKg, note: String(req.body.note || '').trim(), ...evaluation, checkedAt: actualWeightKg ? new Date().toISOString() : null, updatedAt: new Date().toISOString() };
    if (row) Object.assign(row, payload);
    else { row = { id: makeId(), athleteId: athlete.id, contentId: content.id, createdAt: new Date().toISOString(), ...payload }; db.weighIns.push(row); }
    refreshBrackets(io, content.id, athlete.id);
    return res.json(row);
  });
  router.post('/:athleteId/:contentId/lock', (req, res) => {
    const row = db.weighIns.find((item) => item.athleteId === req.params.athleteId && item.contentId === req.params.contentId);
    if (!row) return res.status(404).json({ message: 'Chưa có kết quả cân để chốt' });
    if (!['passed', 'under', 'over'].includes(row.status) || !Number.isFinite(Number(row.actualWeightKg))) return res.status(400).json({ message: 'Cần lưu cân thực tế hợp lệ trước khi chốt' });
    if (row.lockedAt) return res.json(row);
    row.lockedAt = new Date().toISOString();
    row.lockedBy = req.user.id;
    row.lockedByName = req.user.displayName || req.user.username;
    row.updatedAt = row.lockedAt;
    refreshBrackets(io, row.contentId, row.athleteId);
    return res.json(row);
  });
  router.post('/:athleteId/:contentId/unlock', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Chỉ Admin được mở chốt cân' });
    const row = db.weighIns.find((item) => item.athleteId === req.params.athleteId && item.contentId === req.params.contentId);
    if (!row) return res.status(404).json({ message: 'Không tìm thấy kết quả cân' });
    row.unlockedAt = new Date().toISOString();
    row.unlockedBy = req.user.id;
    row.lockedAt = null;
    row.lockedBy = null;
    row.lockedByName = '';
    row.updatedAt = row.unlockedAt;
    refreshBrackets(io, row.contentId, row.athleteId);
    return res.json(row);
  });
  return router;
}
