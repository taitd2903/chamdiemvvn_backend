import { Router } from 'express';
import { AREA_STATUS, AREA_TYPES, db, getArea, getAreaState, makeId, publicArea, resetJudgeSlots, touch } from '../store.js';

export function areasRouter(io) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(db.areas.map(publicArea));
  });

  router.get('/:areaId', (req, res) => {
    const state = getAreaState(req.params.areaId);
    if (!state) return res.status(404).json({ message: 'Không tìm thấy sân' });
    return res.json(state);
  });

  router.post('/', (req, res) => {
    const { name, type, judgeCount } = req.body;
    if (!name || ![AREA_TYPES.FORM, AREA_TYPES.FIGHTING].includes(type)) {
      return res.status(400).json({ message: 'Tên sân hoặc loại sân không hợp lệ' });
    }

    const normalizedJudgeCount = type === AREA_TYPES.FORM ? 5 : Number(judgeCount || 5);
    if (type === AREA_TYPES.FIGHTING && ![4, 5].includes(normalizedJudgeCount)) {
      return res.status(400).json({ message: 'Đối kháng chỉ hỗ trợ 4 hoặc 5 giám định' });
    }

    const area = {
      id: makeId().slice(0, 8),
      name,
      type,
      status: AREA_STATUS.IDLE,
      judgeCount: normalizedJudgeCount,
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

    const { name, status, judgeCount } = req.body;
    if (name) area.name = name;
    if (status) area.status = status;
    if (area.type === AREA_TYPES.FIGHTING && judgeCount && [4, 5].includes(Number(judgeCount))) {
      resetJudgeSlots(area, Number(judgeCount));
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

    area.type = type;
    area.status = AREA_STATUS.IDLE;
    area.currentFormEntryId = null;
    area.currentFightMatchId = null;
    const normalizedJudgeCount = type === AREA_TYPES.FORM ? 5 : Number(judgeCount || 5);
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
