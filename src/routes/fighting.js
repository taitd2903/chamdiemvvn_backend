import { Router } from 'express';
import { AREA_TYPES, MATCH_STATUS, athleteSnapshot, contentWeightClassLabel, createFightMatch, db, getArea, getAreaState, touch } from '../store.js';

export function fightingRouter(io) {
  const router = Router();

  router.get('/matches', (req, res) => {
    const { areaId, contentId } = req.query;
    let rows = db.fightMatches;
    if (areaId) rows = rows.filter((match) => match.areaId === areaId);
    if (contentId) rows = rows.filter((match) => match.contentId === contentId);
    return res.json(rows.sort((a, b) => a.orderNo - b.orderNo));
  });

  router.post('/matches', (req, res) => {
    const { areaId, contentId, redAthleteId, blueAthleteId, redName, blueName, orderNo, roundSeconds, breakSeconds, maxRounds } = req.body;
    const area = getArea(areaId);
    const content = db.contents.find((row) => row.id === contentId);
    if (!area || area.type !== AREA_TYPES.FIGHTING) return res.status(400).json({ message: 'Sân Đối kháng không hợp lệ' });
    if (!content || content.type !== AREA_TYPES.FIGHTING) return res.status(400).json({ message: 'Nội dung Đối kháng không hợp lệ' });

    const redAthlete = redAthleteId ? db.athletes.find((row) => row.id === redAthleteId) : null;
    const blueAthlete = blueAthleteId ? db.athletes.find((row) => row.id === blueAthleteId) : null;
    const red = redAthlete ? athleteSnapshot(redAthlete) : { athleteId: null, name: redName || '' };
    const blue = blueAthlete ? athleteSnapshot(blueAthlete) : { athleteId: null, name: blueName || '' };

    if (!red.name || !blue.name) return res.status(400).json({ message: 'Vui lòng chọn đủ võ sĩ Đỏ và Xanh' });
    if (red.athleteId && blue.athleteId && red.athleteId === blue.athleteId) return res.status(400).json({ message: 'Võ sĩ Đỏ và Xanh không được trùng nhau' });

    const match = createFightMatch({
      areaId,
      contentId,
      redName: red.name,
      blueName: blue.name,
      redAthleteId: red.athleteId,
      blueAthleteId: blue.athleteId,
      redUnit: red.unit,
      blueUnit: blue.unit,
      redBirthYear: red.birthYear,
      blueBirthYear: blue.birthYear,
      redGender: red.gender,
      blueGender: blue.gender,
      redWeightKg: red.weightKg,
      blueWeightKg: blue.weightKg,
      redWeightClass: contentWeightClassLabel(content) || red.weightClass,
      blueWeightClass: contentWeightClassLabel(content) || blue.weightClass,
      redAgeGroup: red.ageGroup,
      blueAgeGroup: blue.ageGroup,
      orderNo: Number(orderNo) || db.fightMatches.filter((row) => row.areaId === areaId).length + 1,
      roundSeconds: Math.max(1, Number(roundSeconds ?? area.roundSeconds) || 120),
      breakSeconds: Math.max(0, Number(breakSeconds ?? area.breakSeconds) || 0),
      maxRounds: Math.max(1, Number(maxRounds ?? area.maxRounds) || 3)
    });
    db.fightMatches.push(match);
    io.to(`area:${areaId}`).emit('area:state', getAreaState(areaId));
    return res.status(201).json(match);
  });

  router.patch('/matches/:matchId/status', (req, res) => {
    const match = db.fightMatches.find((row) => row.id === req.params.matchId);
    if (!match) return res.status(404).json({ message: 'Không tìm thấy trận' });
    const { status } = req.body;
    if (!Object.values(MATCH_STATUS).includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
    }
    match.status = status;
    touch(match);
    io.to(`area:${match.areaId}`).emit('area:state', getAreaState(match.areaId));
    return res.json(match);
  });

  return router;
}
