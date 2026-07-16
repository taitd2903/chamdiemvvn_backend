import { Router } from 'express';
import { AREA_TYPES, db, makeId, touch } from '../store.js';

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeContentCriteria(payload = {}) {
  const type = payload.type;
  const weightMin = toNumberOrNull(payload.weightMin);
  const weightMax = toNumberOrNull(payload.weightMax);
  const formSize = payload.formSize || (Number(payload.memberCount) === 4 ? '4' : Number(payload.memberCountMax) === 10 ? '6-10' : '1');
  const memberCount = Number(payload.memberCount) || (formSize === '4' ? 4 : formSize === '6-10' ? 6 : 1);
  const memberCountMax = Number(payload.memberCountMax) || (formSize === '6-10' ? 10 : memberCount);

  return {
    gender: payload.gender || '',
    ageGroup: payload.ageGroup || '',
    ageGroupScope: type === AREA_TYPES.FORM ? (payload.ageGroupScope || (payload.ageGroup ? 'specific' : 'all')) : 'specific',
    formSize: type === AREA_TYPES.FORM ? formSize : '1',
    memberCountMax,
    birthYearFrom: toNumberOrNull(payload.birthYearFrom),
    birthYearTo: toNumberOrNull(payload.birthYearTo),
    weightMin,
    weightMax,
    weightClass: payload.weightClass || (type === AREA_TYPES.FIGHTING && weightMin !== null && weightMax !== null ? `${weightMin}-${weightMax}kg` : '')
  };
}

function fightNameFromPayload(payload) {
  const gender = payload.gender === 'male' ? 'Nam' : payload.gender === 'female' ? 'Nữ' : '';
  const ageGroup = payload.ageGroup || 'Lứa tuổi';
  const min = payload.weightMin || '...';
  const max = payload.weightMax || '...';
  return `${gender} ${ageGroup} ${min}-${max}kg`.trim();
}

export function contentsRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    const { type } = req.query;
    const rows = type ? db.contents.filter((content) => content.type === type) : db.contents;
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const type = req.body.type;
    if (![AREA_TYPES.FORM, AREA_TYPES.FIGHTING].includes(type)) {
      return res.status(400).json({ message: 'Loại nội dung không hợp lệ' });
    }

    const criteria = normalizeContentCriteria(req.body);
    const name = String(req.body.name || '').trim() || (type === AREA_TYPES.FIGHTING ? fightNameFromPayload({ ...req.body, ...criteria }) : '');

    if (!name) return res.status(400).json({ message: 'Tên nội dung là bắt buộc' });

    if (type === AREA_TYPES.FORM) {
      if (criteria.ageGroupScope === 'specific' && !criteria.ageGroup) {
        return res.status(400).json({ message: 'Vui lòng chọn lứa tuổi hoặc chọn gộp tất cả lứa tuổi cho nội dung Quyền' });
      }
      if (!['', 'male', 'female'].includes(criteria.gender)) {
        return res.status(400).json({ message: 'Giới tính nội dung Quyền phải là Nam, Nữ hoặc không giới hạn' });
      }
    }

    if (type === AREA_TYPES.FIGHTING) {
      if (!['male', 'female'].includes(criteria.gender)) return res.status(400).json({ message: 'Đối kháng bắt buộc chọn giới tính Nam hoặc Nữ' });
      if (!criteria.ageGroup) return res.status(400).json({ message: 'Đối kháng bắt buộc chọn lứa tuổi' });
      if (criteria.weightMin === null || criteria.weightMax === null) return res.status(400).json({ message: 'Đối kháng bắt buộc nhập hạng cân từ và đến' });
      if (criteria.weightMin > criteria.weightMax) return res.status(400).json({ message: 'Hạng cân từ không được lớn hơn hạng cân đến' });
    }

    const content = {
      id: makeId(),
      name,
      type,
      mode: req.body.mode || (type === AREA_TYPES.FORM && criteria.formSize !== '1' ? 'team' : 'individual'),
      memberCount: Number(req.body.memberCount) || (criteria.formSize === '4' ? 4 : criteria.formSize === '6-10' ? 6 : 1),
      memberCountMax: criteria.memberCountMax,
      limit: req.body.limit ?? null,
      ...criteria,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.contents.push(content);
    return res.status(201).json(content);
  });

  router.put('/:id', (req, res) => {
    const content = db.contents.find((row) => row.id === req.params.id);
    if (!content) return res.status(404).json({ message: 'Không tìm thấy nội dung' });
    const { name, mode, memberCount, limit } = req.body;
    if (name) content.name = name;
    if (mode) content.mode = mode;
    if (memberCount) content.memberCount = Number(memberCount);
    if (limit !== undefined) content.limit = limit;
    Object.assign(content, normalizeContentCriteria({ ...content, ...req.body, type: content.type }));
    touch(content);
    return res.json(content);
  });

  router.delete('/:id', (req, res) => {
    const index = db.contents.findIndex((row) => row.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: 'Không tìm thấy nội dung' });
    db.contents.splice(index, 1);
    return res.status(204).send();
  });

  return router;
}
