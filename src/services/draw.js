import { randomInt } from 'node:crypto';
import { AREA_TYPES, athleteSnapshot, contentWeightClassLabel, createFightMatch, db, makeId } from '../store.js';

function shuffle(rows) {
  const result = [...rows];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function nextPowerOfTwo(value) {
  let size = 2;
  while (size < value) size *= 2;
  return size;
}

function participant(athlete) {
  return athlete ? { athleteId: athlete.id, name: athlete.name, unit: athlete.unit || '' } : null;
}

function withWeighIn(player, contentId) {
  if (!player) return null;
  const weighIn = db.weighIns.find((row) => row.athleteId === player.athleteId && row.contentId === contentId);
  const official = Boolean(weighIn?.lockedAt);
  return { ...player, weighInStatus: official ? weighIn.status : 'pending', actualWeightKg: weighIn?.actualWeightKg ?? null, disqualifiedReason: official && ['under', 'over'].includes(weighIn?.status) ? weighIn.reason : '' };
}

function assignMatchNumbers(bracket) {
  let matchNo = 1;
  const firstRound = bracket.rounds?.[0];
  if (!firstRound) return;

  for (const node of firstRound.matches) {
    node.matchNo = node.red && node.blue && !node.resolvedByWeight ? matchNo++ : null;
  }

  for (let roundIndex = 1; roundIndex < bracket.rounds.length; roundIndex += 1) {
    const previous = bracket.rounds[roundIndex - 1].matches;
    const nodes = bracket.rounds[roundIndex].matches.map((node) => {
      const sources = [previous[node.index * 2], previous[node.index * 2 + 1]];
      const latestSourceMatch = Math.max(0, ...sources.map((source) => Number(source?.matchNo) || 0));
      return { node, latestSourceMatch };
    }).sort((a, b) => a.latestSourceMatch - b.latestSourceMatch || a.node.index - b.node.index);

    for (const { node } of nodes) node.matchNo = node.resolvedByWeight ? null : matchNo++;
  }
}

export function syncBracket(bracket) {
  if (!bracket) return bracket;
  assignMatchNumbers(bracket);
  for (let roundIndex = 1; roundIndex < bracket.rounds.length; roundIndex += 1) {
    for (const node of bracket.rounds[roundIndex].matches) {
      node.red = null;
      node.blue = null;
      node.winner = null;
    }
  }
  for (let roundIndex = 0; roundIndex < bracket.rounds.length; roundIndex += 1) {
    const round = bracket.rounds[roundIndex];
    for (const node of round.matches) {
      node.red = withWeighIn(node.red, bracket.contentId);
      node.blue = withWeighIn(node.blue, bracket.contentId);
      const redDisqualified = Boolean(node.red?.disqualifiedReason);
      const blueDisqualified = Boolean(node.blue?.disqualifiedReason);
      node.resolvedByWeight = false;
      if (node.fightMatchId) {
        let fight = db.fightMatches.find((row) => row.id === node.fightMatchId);
        const participantsChanged = fight && ['pending', 'skipped'].includes(fight.status) && (fight.redAthleteId !== node.red?.athleteId || fight.blueAthleteId !== node.blue?.athleteId);
        if (participantsChanged) {
          fight.status = 'cancelled';
          fight.winReason = 'Nhánh thay đổi sau kiểm tra cân';
          fight.updatedAt = new Date().toISOString();
          node.fightMatchId = null;
          fight = null;
        }
        if (fight && ['pending', 'skipped'].includes(fight.status) && (redDisqualified || blueDisqualified)) {
          node.resolvedByWeight = true;
          if (redDisqualified && blueDisqualified) {
            fight.status = 'cancelled'; fight.winner = null; fight.winReason = 'Cả hai VĐV không đạt cân'; node.winner = null;
          } else {
            fight.status = 'finished'; fight.winner = redDisqualified ? 'blue' : 'red'; fight.winReason = redDisqualified ? node.red.disqualifiedReason : node.blue.disqualifiedReason;
            node.winner = redDisqualified ? node.blue : node.red;
          }
          fight.updatedAt = new Date().toISOString();
        } else if (fight?.winner) {
          node.resolvedByWeight = String(fight.winReason || '').startsWith('LOẠI') || fight.winReason === 'Cả hai VĐV không đạt cân';
          node.winner = withWeighIn(participant(db.athletes.find((row) => row.id === (fight.winner === 'red' ? fight.redAthleteId : fight.blueAthleteId))), bracket.contentId);
        }
      }
      if (!node.fightMatchId && !node.winner && node.red && !node.blue) {
        node.winner = redDisqualified ? null : node.red;
      } else if (!node.fightMatchId && !node.winner && !node.red && node.blue) {
        node.winner = blueDisqualified ? null : node.blue;
      }
      if (node.winner && roundIndex + 1 < bracket.rounds.length) {
        const next = bracket.rounds[roundIndex + 1].matches[Math.floor(node.index / 2)];
        next[node.index % 2 === 0 ? 'red' : 'blue'] = node.winner;
      }
    }

    if (roundIndex + 1 < bracket.rounds.length) {
      for (const next of bracket.rounds[roundIndex + 1].matches) {
        if (!next.winner && !next.fightMatchId && next.red && next.blue) {
          const red = db.athletes.find((row) => row.id === next.red.athleteId);
          const blue = db.athletes.find((row) => row.id === next.blue.athleteId);
          const area = db.areas.find((row) => row.id === bracket.areaId);
          const content = db.contents.find((row) => row.id === bracket.contentId);
          const redData = athleteSnapshot(red);
          const blueData = athleteSnapshot(blue);
          const fight = createFightMatch({
            areaId: bracket.areaId, contentId: bracket.contentId,
            redName: redData.name, blueName: blueData.name,
            redAthleteId: redData.athleteId, blueAthleteId: blueData.athleteId,
            redUnit: redData.unit, blueUnit: blueData.unit,
            redBirthYear: redData.birthYear, blueBirthYear: blueData.birthYear,
            redGender: redData.gender, blueGender: blueData.gender,
            redWeightKg: redData.weightKg, blueWeightKg: blueData.weightKg,
            redWeightClass: contentWeightClassLabel(content), blueWeightClass: contentWeightClassLabel(content),
            redAgeGroup: redData.ageGroup, blueAgeGroup: blueData.ageGroup,
            orderNo: next.matchNo,
            roundSeconds: area?.roundSeconds, breakSeconds: area?.breakSeconds, maxRounds: area?.maxRounds
          });
          fight.bracketId = bracket.id;
          fight.bracketNodeId = next.id;
          db.fightMatches.push(fight);
          next.fightMatchId = fight.id;
        } else if (!next.winner && !next.fightMatchId && (next.red || next.blue) && roundIndex + 1 === bracket.rounds.length - 1) {
          next.winner = next.red || next.blue;
        }
      }
    }
  }
  assignMatchNumbers(bracket);
  for (const round of bracket.rounds) {
    for (const node of round.matches) {
      if (!node.fightMatchId || !node.matchNo) continue;
      const fight = db.fightMatches.find((row) => row.id === node.fightMatchId);
      if (fight) fight.orderNo = node.matchNo;
    }
  }
  bracket.updatedAt = new Date().toISOString();
  return bracket;
}

export function syncAreaBrackets(areaId) {
  const brackets = db.brackets.filter((row) => row.areaId === areaId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  brackets.forEach(syncBracket);
  let matchNo = 1;
  const maxRounds = Math.max(0, ...brackets.map((row) => row.rounds?.length || 0));
  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
    for (const bracket of brackets) {
      const nodes = bracket.rounds?.[roundIndex]?.matches || [];
      for (const node of nodes) {
        const isRealFirstRoundMatch = roundIndex !== 0 || (node.red && node.blue);
        node.matchNo = !node.resolvedByWeight && isRealFirstRoundMatch ? matchNo++ : null;
        if (node.fightMatchId && node.matchNo) {
          const fight = db.fightMatches.find((row) => row.id === node.fightMatchId);
          if (fight) fight.orderNo = node.matchNo;
        }
      }
    }
  }
  return brackets;
}

export function syncAllBrackets() {
  const areaIds = [...new Set(db.brackets.map((row) => row.areaId))];
  areaIds.forEach(syncAreaBrackets);
  return db.brackets;
}

export function drawFightingBracket({ contentId, areaId }) {
  if (!db.settings.registrationLocked) throw new Error('Cần chốt đăng ký trước khi bốc thăm');
  const content = db.contents.find((row) => row.id === contentId && row.type === AREA_TYPES.FIGHTING);
  const area = db.areas.find((row) => row.id === areaId && row.type === AREA_TYPES.FIGHTING);
  if (!content || !area) throw new Error('Nội dung hoặc sân Đối kháng không hợp lệ');
  if (db.brackets.some((row) => row.contentId === contentId)) throw new Error('Nội dung này đã bốc thăm');

  const athletes = db.registrations.filter((row) => row.contentId === contentId)
    .map((row) => db.athletes.find((athlete) => athlete.id === row.athleteId)).filter(Boolean);
  if (athletes.length < 2) throw new Error('Cần ít nhất 2 vận động viên để bốc thăm');
  const units = new Set();
  for (const athlete of athletes) {
    const key = String(athlete.unit || '').trim().toLowerCase();
    if (units.has(key)) throw new Error(`Đơn vị ${athlete.unit || '(trống)'} có hơn 1 VĐV trong nội dung này`);
    units.add(key);
  }

  const size = nextPowerOfTwo(athletes.length);
  const slots = Array(size).fill(null);
  const shuffled = shuffle(athletes);
  const firstRoundMatchCount = athletes.length - (size / 2);
  const byeCount = athletes.length - (firstRoundMatchCount * 2);
  let athleteIndex = 0;
  for (let pairIndex = 0; pairIndex < size / 2; pairIndex += 1) {
    const isByePair = pairIndex < byeCount;
    slots[pairIndex * 2] = participant(shuffled[athleteIndex++]);
    if (!isByePair) slots[pairIndex * 2 + 1] = participant(shuffled[athleteIndex++]);
  }
  const roundCount = Math.log2(size);
  const rounds = [];
  for (let r = 0; r < roundCount; r += 1) {
    const count = size / (2 ** (r + 1));
    const name = r === 0 && athletes.length !== size ? 'Sơ loại' : r === roundCount - 1 ? 'Chung kết' : r === roundCount - 2 ? 'Bán kết' : r === roundCount - 3 ? 'Tứ kết' : `Vòng ${r + 1}`;
    rounds.push({ index: r, name, matches: Array.from({ length: count }, (_, index) => ({ id: makeId(), index, matchNo: null, red: null, blue: null, winner: null, fightMatchId: null })) });
  }
  rounds[0].matches.forEach((node, index) => {
    node.red = slots[index * 2];
    node.blue = slots[index * 2 + 1];
    if ((node.red && !node.blue) || (!node.red && node.blue)) node.winner = node.red || node.blue;
  });
  const bracket = { id: makeId(), contentId, areaId, size, athleteCount: athletes.length, drawnAt: new Date().toISOString(), rounds, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.brackets.push(bracket);
  syncBracket(bracket);
  for (const node of rounds[0].matches.filter((row) => row.red && row.blue)) {
    const red = db.athletes.find((row) => row.id === node.red.athleteId);
    const blue = db.athletes.find((row) => row.id === node.blue.athleteId);
    const redData = athleteSnapshot(red); const blueData = athleteSnapshot(blue);
    const fight = createFightMatch({ areaId, contentId, redName: redData.name, blueName: blueData.name, redAthleteId: red.id, blueAthleteId: blue.id, redUnit: red.unit, blueUnit: blue.unit, redBirthYear: red.birthYear, blueBirthYear: blue.birthYear, redGender: red.gender, blueGender: blue.gender, redWeightKg: red.weightKg, blueWeightKg: blue.weightKg, redWeightClass: contentWeightClassLabel(content), blueWeightClass: contentWeightClassLabel(content), redAgeGroup: red.ageGroup, blueAgeGroup: blue.ageGroup, orderNo: node.matchNo, roundSeconds: area.roundSeconds, breakSeconds: area.breakSeconds, maxRounds: area.maxRounds });
    fight.bracketId = bracket.id; fight.bracketNodeId = node.id; node.fightMatchId = fight.id; db.fightMatches.push(fight);
  }
  syncAreaBrackets(areaId);
  return bracket;
}

export function createFormSchedule({ contentId, areaId }) {
  if (!db.settings.registrationLocked) throw new Error('Cần chốt đăng ký trước khi tạo lượt thi');
  const content = db.contents.find((row) => row.id === contentId && row.type === AREA_TYPES.FORM);
  const area = db.areas.find((row) => row.id === areaId && row.type === AREA_TYPES.FORM);
  if (!content || !area) throw new Error('Nội dung hoặc sân Quyền không hợp lệ');
  if (db.formEntries.some((row) => row.contentId === contentId)) throw new Error('Nội dung này đã có lượt thi');
  const athletes = db.registrations.filter((row) => row.contentId === contentId).map((row) => db.athletes.find((athlete) => athlete.id === row.athleteId)).filter(Boolean);
  if (!athletes.length) throw new Error('Nội dung chưa có thí sinh đăng ký');
  const ordered = athletes;
  const entries = ordered.map((athlete, index) => {
    const data = athleteSnapshot(athlete);
    return { id: makeId(), contentId, areaId, athleteId: athlete.id, participantName: data.name, participantUnit: data.unit, birthYear: data.birthYear, gender: data.gender, weightKg: data.weightKg, weightClass: contentWeightClassLabel(content), ageGroup: data.ageGroup, orderNo: index + 1, status: 'pending', scores: {}, finalScore: null, keptScores: [], removedLow: null, removedHigh: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  });
  db.formEntries.push(...entries);
  return entries;
}
