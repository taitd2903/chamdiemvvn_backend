import { Router } from 'express';
import { AREA_STATUS, AREA_TYPES, db, getArea, getAreaState, makeId, publicArea, resetJudgeSlots, touch } from '../store.js';
import { syncAreaBrackets } from '../services/draw.js';

export function areasRouter(io) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(db.areas.map(publicArea));
  });

  router.get('/:areaId', (req, res) => {
    syncAreaBrackets(req.params.areaId);
    const state = getAreaState(req.params.areaId);
    if (!state) return res.status(404).json({ message: 'Không tìm thấy sân' });
    return res.json(state);
  });

  router.post('/', (req, res) => {
    const { name, type, judgeCount, maxRounds, roundSeconds, breakSeconds } = req.body;
    if (!name || ![AREA_TYPES.FORM, AREA_TYPES.FIGHTING].includes(type)) {
      return res.status(400).json({ message: 'Tên sân hoặc loại sân không hợp lệ' });
    }

    const normalizedJudgeCount = type === AREA_TYPES.FORM ? 5 : Number(judgeCount || 5);
    if (type === AREA_TYPES.FIGHTING && ![3, 5].includes(normalizedJudgeCount)) {
      return res.status(400).json({ message: 'Đối kháng chỉ hỗ trợ 3 hoặc 5 giám định' });
    }

    const area = {
      id: makeId().slice(0, 8),
      name,
      type,
      status: AREA_STATUS.IDLE,
      judgeCount: normalizedJudgeCount,
      maxRounds: type === AREA_TYPES.FIGHTING ? Math.max(1, Number(maxRounds) || 3) : null,
      roundSeconds: type === AREA_TYPES.FIGHTING ? Math.max(1, Number(roundSeconds) || 120) : null,
      breakSeconds: type === AREA_TYPES.FIGHTING ? Math.max(0, Number(breakSeconds) || 0) : null,
      judgeSlots: {},
      currentFormEntryId: null,
      currentFightMatchId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    resetJudgeSlots(area, normalizedJudgeCount);
    db.areas.push(area);

    io.emit('admin:state', { areas: db.areas.map(publicArea) });
    return res.status(201).json(publicArea(area));
  });

  router.put('/:areaId', (req, res) => {
    const area = getArea(req.params.areaId);
    if (!area) return res.status(404).json({ message: 'Không tìm thấy sân' });

    const { name, status, judgeCount, maxRounds, roundSeconds, breakSeconds } = req.body;
    if (name) area.name = name;
    if (status) area.status = status;
    if (area.type === AREA_TYPES.FIGHTING && judgeCount && [3, 5].includes(Number(judgeCount))) {
      resetJudgeSlots(area, Number(judgeCount));
    }
    if (area.type === AREA_TYPES.FIGHTING) {
      if (maxRounds !== undefined) area.maxRounds = Math.max(1, Number(maxRounds) || 1);
      if (roundSeconds !== undefined) area.roundSeconds = Math.max(1, Number(roundSeconds) || 1);
      if (breakSeconds !== undefined) area.breakSeconds = Math.max(0, Number(breakSeconds) || 0);
    }
    touch(area);

    io.to(`area:${area.id}`).emit('area:state', getAreaState(area.id));
    io.emit('admin:state', { areas: db.areas.map(publicArea) });
    return res.json(publicArea(area));
  });

  router.patch('/:areaId/type', (req, res) => {
    const area = getArea(req.params.areaId);
    if (!area) return res.status(404).json({ message: 'Không tìm thấy sân' });

    const { type, judgeCount } = req.body;
    if (![AREA_TYPES.FORM, AREA_TYPES.FIGHTING].includes(type)) {
      return res.status(400).json({ message: 'Loại sân không hợp lệ' });
    }

    const isBusy = ![AREA_STATUS.IDLE, AREA_STATUS.FINISHED].includes(area.status);
    if (isBusy) {
      return res.status(409).json({
        message: 'Sân này đang có phiên thi đấu chưa kết thúc. Vui lòng kết thúc hoặc hủy phiên hiện tại trước khi đổi loại sân.'
      });
    }

    const normalizedJudgeCount = type === AREA_TYPES.FORM ? 5 : Number(judgeCount || 5);
    if (type === AREA_TYPES.FIGHTING && ![3, 5].includes(normalizedJudgeCount)) {
      return res.status(400).json({ message: 'Đối kháng chỉ hỗ trợ 3 hoặc 5 giám định' });
    }
    area.type = type;
    area.status = AREA_STATUS.IDLE;
    area.currentFormEntryId = null;
    area.currentFightMatchId = null;
    area.maxRounds = type === AREA_TYPES.FIGHTING ? Math.max(1, Number(req.body.maxRounds) || 3) : null;
    area.roundSeconds = type === AREA_TYPES.FIGHTING ? Math.max(1, Number(req.body.roundSeconds) || 120) : null;
    area.breakSeconds = type === AREA_TYPES.FIGHTING ? Math.max(0, Number(req.body.breakSeconds) || 0) : null;
    resetJudgeSlots(area, normalizedJudgeCount);
    touch(area);

    io.to(`area:${area.id}`).emit('area:state', getAreaState(area.id));
    io.emit('admin:state', { areas: db.areas.map(publicArea) });
    return res.json(publicArea(area));
  });

  router.delete('/:areaId', (req, res) => {
    const index = db.areas.findIndex((area) => area.id === req.params.areaId);
    if (index === -1) return res.status(404).json({ message: 'Không tìm thấy sân' });
    const area = db.areas[index];
    if (![AREA_STATUS.IDLE, AREA_STATUS.FINISHED].includes(area.status)) {
      return res.status(409).json({ message: 'Không thể xóa sân đang chạy' });
    }
    db.areas.splice(index, 1);
    io.emit('admin:state', { areas: db.areas.map(publicArea) });
    return res.status(204).send();
  });

  return router;
}
