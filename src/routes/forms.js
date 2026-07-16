import { Router } from 'express';
import { AREA_STATUS, AREA_TYPES, FORM_ENTRY_STATUS, athleteSnapshot, contentWeightClassLabel, db, getArea, getAreaState, makeId, touch } from '../store.js';

export function formsRouter(io) {
  const router = Router();

  router.get('/entries', (req, res) => {
    const { areaId, contentId } = req.query;
    let rows = db.formEntries;
    if (areaId) rows = rows.filter((entry) => entry.areaId === areaId);
    if (contentId) rows = rows.filter((entry) => entry.contentId === contentId);
    return res.json(rows.sort((a, b) => a.orderNo - b.orderNo));
  });

  router.post('/entries', (req, res) => {
    const { areaId, contentId, athleteId, participantName, participantUnit = '', ageGroup = '', gender = '', birthYear = null, weightKg = null, weightClass = '', orderNo } = req.body;
    const area = getArea(areaId);
    const content = db.contents.find((row) => row.id === contentId);
    if (!area || area.type !== AREA_TYPES.FORM) return res.status(400).json({ message: 'Sân Quyền không hợp lệ' });
    if (!content || content.type !== AREA_TYPES.FORM) return res.status(400).json({ message: 'Nội dung Quyền không hợp lệ' });

    const athlete = athleteId ? db.athletes.find((row) => row.id === athleteId) : null;
    const snapshot = athlete ? athleteSnapshot(athlete) : {
      athleteId: null,
      name: participantName || '',
      unit: participantUnit || '',
      ageGroup: ageGroup || '',
      gender: gender || '',
      birthYear: birthYear ? Number(birthYear) : null,
      weightKg: weightKg ? Number(weightKg) : null,
      weightClass: contentWeightClassLabel(content) || weightClass || ''
    };

    if (!snapshot.name) return res.status(400).json({ message: 'Tên người/đội thi là bắt buộc' });

    const entry = {
      id: makeId(),
      contentId,
      areaId,
      athleteId: snapshot.athleteId,
      participantName: snapshot.name,
      participantUnit: snapshot.unit,
      ageGroup: snapshot.ageGroup,
      gender: snapshot.gender,
      birthYear: snapshot.birthYear,
      weightKg: snapshot.weightKg,
      weightClass: contentWeightClassLabel(content) || snapshot.weightClass || '',
      orderNo: Number(orderNo) || db.formEntries.filter((row) => row.areaId === areaId).length + 1,
      status: FORM_ENTRY_STATUS.PENDING,
      scores: {},
      finalScore: null,
      keptScores: [],
      removedLow: null,
      removedHigh: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.formEntries.push(entry);
    io.to(`area:${areaId}`).emit('area:state', getAreaState(areaId));
    return res.status(201).json(entry);
  });

  router.patch('/entries/:entryId/status', (req, res) => {
    const entry = db.formEntries.find((row) => row.id === req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'Không tìm thấy lượt thi' });
    const { status } = req.body;
    if (!Object.values(FORM_ENTRY_STATUS).includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
    }
    entry.status = status;
    touch(entry);
    io.to(`area:${entry.areaId}`).emit('area:state', getAreaState(entry.areaId));
    return res.json(entry);
  });

  router.post('/entries/:entryId/select', (req, res) => {
    const entry = db.formEntries.find((row) => row.id === req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'Không tìm thấy lượt thi' });
    const area = getArea(entry.areaId);
    if (!area || area.type !== AREA_TYPES.FORM) return res.status(400).json({ message: 'Sân Quyền không hợp lệ' });
    if (![FORM_ENTRY_STATUS.PENDING, FORM_ENTRY_STATUS.SKIPPED, FORM_ENTRY_STATUS.RUNNING].includes(entry.status)) {
      return res.status(409).json({ message: 'Lượt thi này đã khóa hoặc đã kết thúc' });
    }

    db.formEntries.forEach((row) => {
      if (row.areaId === entry.areaId && row.status === FORM_ENTRY_STATUS.RUNNING) row.status = FORM_ENTRY_STATUS.PENDING;
    });
    entry.status = FORM_ENTRY_STATUS.RUNNING;
    area.currentFormEntryId = entry.id;
    area.status = AREA_STATUS.FORM_RUNNING;
    touch(entry);
    touch(area);

    io.to(`area:${entry.areaId}`).emit('area:state', getAreaState(entry.areaId));
    return res.json(getAreaState(entry.areaId));
  });

  return router;
}
