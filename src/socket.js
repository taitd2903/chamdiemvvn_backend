import { randomUUID } from 'node:crypto';
import { AREA_STATUS, AREA_TYPES, FORM_ENTRY_STATUS, JUDGE_STATUS, MATCH_STATUS, db, getArea, getAreaState, touch } from './store.js';
import { calculateFormFinalScore, clampScore, getSideLabel, getWinnerByScore } from './services/scoring.js';
import { schedulePersistState } from './persistence.js';
import { syncAreaBrackets, syncBracket } from './services/draw.js';
import { getPublicTournamentState } from './services/publicStats.js';

const timers = new Map();
const medicalTimers = new Map();

function advanceBracket(match) {
  if (!match?.bracketId) return;
  const bracket = db.brackets.find((row) => row.id === match.bracketId);
  if (bracket) syncBracket(bracket);
}

function emitArea(io, areaId) {
  syncAreaBrackets(areaId);
  io.to(`area:${areaId}`).emit('area:state', getAreaState(areaId));
  io.emit('public:tournament', getPublicTournamentState());
  schedulePersistState(db);
}

function emitError(socket, message) {
  socket.emit('app:error', { message });
}

function findCurrentMatch(areaId) {
  const area = getArea(areaId);
  if (!area?.currentFightMatchId) return null;
  return db.fightMatches.find((match) => match.id === area.currentFightMatchId) || null;
}

function findCurrentFormEntry(areaId) {
  const area = getArea(areaId);
  if (!area?.currentFormEntryId) return null;
  return db.formEntries.find((entry) => entry.id === area.currentFormEntryId) || null;
}

function matchHasPassedWeighIn(match) {
  if (!match?.contentId || !match.redAthleteId || !match.blueAthleteId) return false;
  return [match.redAthleteId, match.blueAthleteId].every((athleteId) =>
    db.weighIns.some((row) => row.athleteId === athleteId && row.contentId === match.contentId && row.status === 'passed' && row.lockedAt)
  );
}

function selectFormEntryForArea(areaId, entryId) {
  const area = getArea(areaId);
  const entry = db.formEntries.find((row) => row.id === entryId && row.areaId === areaId);
  if (!area || area.type !== AREA_TYPES.FORM) return { error: 'Sân Quyền không hợp lệ' };
  if (!entry) return { error: 'Không tìm thấy lượt thi' };
  if (![FORM_ENTRY_STATUS.PENDING, FORM_ENTRY_STATUS.SKIPPED, FORM_ENTRY_STATUS.RUNNING, FORM_ENTRY_STATUS.COMPLETED].includes(entry.status)) {
    return { error: 'Lượt thi này đã khóa hoặc đã hủy' };
  }

  db.formEntries.forEach((row) => {
    if (row.areaId === areaId && row.status === FORM_ENTRY_STATUS.RUNNING && row.id !== entry.id) {
      row.status = FORM_ENTRY_STATUS.PENDING;
      touch(row);
    }
  });

  area.currentFormEntryId = entry.id;
  area.status = AREA_STATUS.FORM_RUNNING;
  if (entry.status !== FORM_ENTRY_STATUS.COMPLETED) entry.status = FORM_ENTRY_STATUS.RUNNING;
  touch(entry);
  touch(area);
  return { area, entry };
}

function updateFormFinalScore(entry) {
  const scoreCount = Object.keys(entry.scores || {}).length;
  if (scoreCount === 5) {
    const result = calculateFormFinalScore(entry.scores);
    entry.finalScore = result.finalScore;
    entry.keptScores = result.keptScores;
    entry.removedLow = result.removedLow;
    entry.removedHigh = result.removedHigh;
    entry.status = FORM_ENTRY_STATUS.COMPLETED;
  } else {
    entry.finalScore = null;
    entry.keptScores = [];
    entry.removedLow = null;
    entry.removedHigh = null;
    if (![FORM_ENTRY_STATUS.CANCELLED, FORM_ENTRY_STATUS.SKIPPED].includes(entry.status)) {
      entry.status = FORM_ENTRY_STATUS.RUNNING;
    }
  }
  touch(entry);
}

function checkFightEnd(io, match) {
  if (!match || [MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED].includes(match.status)) return;

  if (match.goldenPoint && match.redScore !== match.blueScore) {
    match.winner = getWinnerByScore(match.redScore, match.blueScore);
    match.winReason = 'Điểm vàng';
    match.status = MATCH_STATUS.FINISHED;
    advanceBracket(match);
    stopTimer(match.id);
    stopAllMedicalTimers(match);
    touch(match);
    emitArea(io, match.areaId);
    return;
  }

  const diff = Math.abs(match.redScore - match.blueScore);
  if (diff >= 10) {
    match.winner = getWinnerByScore(match.redScore, match.blueScore);
    match.winReason = 'Thắng chênh 10 điểm';
    match.status = MATCH_STATUS.FINISHED;
    advanceBracket(match);
    stopTimer(match.id);
    stopAllMedicalTimers(match);
    touch(match);
    emitArea(io, match.areaId);
  }
}

function pushHistory(match, action) {
  match.history.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    round: match.round,
    remainingSeconds: match.remainingSeconds,
    redScoreAfter: match.redScore,
    blueScoreAfter: match.blueScore,
    ...action
  });
}

function pushUndoState(match, label) {
  if (!Array.isArray(match.undoStack)) match.undoStack = [];
  match.undoStack.push({
    id: randomUUID(),
    label,
    redScore: match.redScore,
    blueScore: match.blueScore,
    reminders: JSON.parse(JSON.stringify(match.reminders || {})),
    medicalTimers: JSON.parse(JSON.stringify(match.medicalTimers || { red: 0, blue: 0 })),
    medicalPauseResume: Boolean(match.medicalPauseResume),
    medicalCounts: JSON.parse(JSON.stringify(match.medicalCounts || {})),
    round: match.round,
    remainingSeconds: match.remainingSeconds,
    goldenPoint: Boolean(match.goldenPoint),
    winner: match.winner,
    winReason: match.winReason,
    status: match.status,
    historyLength: match.history?.length || 0
  });
  if (match.undoStack.length > 50) match.undoStack.shift();
}

function resetFightTest(match) {
  stopTimer(match.id);
  stopAllMedicalTimers(match);
  match.testMode = false;
  match.status = MATCH_STATUS.PENDING;
  match.round = 1;
  match.remainingSeconds = match.roundSeconds;
  match.redScore = 0;
  match.blueScore = 0;
  match.winner = null;
  match.winReason = null;
  match.goldenPoint = false;
  match.reminders = { red: { fault: 0, medical: 0, warnings: 0 }, blue: { fault: 0, medical: 0, warnings: 0 } };
  match.medicalTimers = { red: 0, blue: 0 };
  match.medicalCounts = { red: { total: 0, byRound: {} }, blue: { total: 0, byRound: {} } };
  match.medicalPauseResume = false;
  match.pendingVotes = [];
  match.voteFlashes = [];
  match.processedVoteGroups = [];
  match.history = [];
  match.undoStack = [];
  touch(match);
}

function applyScore(io, match, { side, points, source, label, voteIds = [] }) {
  const delta = Number(points);
  if (!['red', 'blue'].includes(side) || !Number.isFinite(delta)) return;

  pushUndoState(match, label || `${getSideLabel(side)} ${delta > 0 ? '+' : ''}${delta}`);

  if (side === 'red') match.redScore += delta;
  if (side === 'blue') match.blueScore += delta;

  pushHistory(match, {
    type: 'score',
    side,
    points: delta,
    source,
    label: label || `${getSideLabel(side)} ${delta > 0 ? '+' : ''}${delta}`,
    voteIds
  });
  touch(match);
  if (!match.testMode) checkFightEnd(io, match);
}

function addReminder(io, match, side, kind) {
  if (!['red', 'blue'].includes(side)) return;
  if (!['fault', 'medical'].includes(kind)) return;

  pushUndoState(match, `${getSideLabel(side)} nhắc ${kind === 'fault' ? 'lỗi' : 'y tế'}`);

  match.reminders[side][kind] += 1;
  if (kind === 'medical') {
    if (!match.medicalCounts) match.medicalCounts = { red: { total: 0, byRound: {} }, blue: { total: 0, byRound: {} } };
    if (!match.medicalCounts[side]) match.medicalCounts[side] = { total: 0, byRound: {} };
    const counter = match.medicalCounts[side];
    counter.total += 1;
    counter.byRound[match.round] = Number(counter.byRound[match.round] || 0) + 1;
    const roundCount = counter.byRound[match.round];
    pushHistory(match, {
      type: 'medical', side, kind,
      label: `${getSideLabel(side)} y tế lần ${roundCount} hiệp ${match.round} · tổng ${counter.total}/5`
    });
    if (!match.testMode && (roundCount >= 4 || counter.total >= 5)) {
      const winner = side === 'red' ? 'blue' : 'red';
      match.winner = winner;
      match.winReason = roundCount >= 4 ? 'Đối thủ đủ 4 lần y tế trong một hiệp' : 'Đối thủ đủ 5 lần y tế toàn trận';
      match.status = MATCH_STATUS.FINISHED;
      stopTimer(match.id);
      stopAllMedicalTimers(match);
      advanceBracket(match);
      pushHistory(match, { type: 'medical-loss', side, winner, label: `${getSideLabel(side)} bị xử thua do quá số lần y tế` });
      touch(match);
      return;
    }
    touch(match);
    return;
  }
  pushHistory(match, {
    type: 'reminder',
    side,
    kind,
    label: `${getSideLabel(side)} nhắc ${kind === 'fault' ? 'lỗi' : 'y tế'}`
  });

  if (kind === 'fault' && match.reminders[side][kind] >= 3) {
    match.reminders[side][kind] = 0;
    match.reminders[side].warnings += 1;
    if (side === 'red') match.redScore -= 2;
    if (side === 'blue') match.blueScore -= 2;
    pushHistory(match, {
      type: 'warning',
      side,
      kind,
      points: -2,
      label: `${getSideLabel(side)} đủ 3 nhắc ${kind === 'fault' ? 'lỗi' : 'y tế'} → cảnh cáo -2`
    });
  }

  touch(match);
  if (!match.testMode) checkFightEnd(io, match);
}

function processVotes(io, match) {
  const windowMs = 3000;
  const usableVotes = match.pendingVotes.filter((vote) => !vote.used);

  for (const vote of usableVotes) {
    const group = usableVotes.filter((item) => (
      !item.used &&
      item.side === vote.side &&
      item.points === vote.points &&
      Math.abs(item.timestamp - vote.timestamp) <= windowMs
    ));

    const uniqueByJudge = new Map();
    group
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((item) => {
        if (!uniqueByJudge.has(item.judgeNo)) uniqueByJudge.set(item.judgeNo, item);
      });

    const selected = [...uniqueByJudge.values()].slice(0, 3);
    if (selected.length >= 3) {
      const voteIds = selected.map((item) => item.id);
      match.pendingVotes = match.pendingVotes.map((item) => (
        voteIds.includes(item.id) ? { ...item, used: true } : item
      ));
      match.processedVoteGroups.push({
        id: randomUUID(),
        side: vote.side,
        points: vote.points,
        voteIds,
        processedAt: new Date().toISOString()
      });
      applyScore(io, match, {
        side: vote.side,
        points: vote.points,
        source: 'judges',
        label: `${getSideLabel(vote.side)} +${vote.points} do 3 giám định đồng thuận`,
        voteIds
      });
      return true;
    }
  }

  return false;
}

function stopTimer(matchId) {
  const timer = timers.get(matchId);
  if (timer) clearInterval(timer);
  timers.delete(matchId);
}

function medicalTimerKey(matchId, side) {
  return `${matchId}:${side}`;
}

function stopMedicalTimer(matchId, side) {
  const key = medicalTimerKey(matchId, side);
  const timer = medicalTimers.get(key);
  if (timer) clearInterval(timer);
  medicalTimers.delete(key);
}

function stopAllMedicalTimers(match) {
  if (!match) return;
  stopMedicalTimer(match.id, 'red');
  stopMedicalTimer(match.id, 'blue');
  match.medicalTimers = { red: 0, blue: 0 };
  match.medicalPauseResume = false;
}

function startMedicalTimer(io, match, side, durationSeconds = 60) {
  if (!match.medicalTimers) match.medicalTimers = { red: 0, blue: 0 };
  const hadActiveMedical = Number(match.medicalTimers.red || 0) > 0 || Number(match.medicalTimers.blue || 0) > 0;
  if (!hadActiveMedical && [MATCH_STATUS.RUNNING, MATCH_STATUS.GOLDEN].includes(match.status)) {
    match.medicalPauseResume = true;
    match.status = MATCH_STATUS.PAUSED;
    const area = getArea(match.areaId);
    if (area) {
      area.status = AREA_STATUS.PAUSED;
      touch(area);
    }
    stopTimer(match.id);
  }
  stopMedicalTimer(match.id, side);
  match.medicalTimers[side] = Math.max(1, Number(durationSeconds) || 60);
  touch(match);
  emitArea(io, match.areaId);

  const key = medicalTimerKey(match.id, side);
  medicalTimers.set(key, setInterval(() => {
    const freshMatch = db.fightMatches.find((row) => row.id === match.id);
    if (!freshMatch) {
      stopMedicalTimer(match.id, side);
      return;
    }
    if (!freshMatch.medicalTimers) freshMatch.medicalTimers = { red: 0, blue: 0 };
    freshMatch.medicalTimers[side] = Math.max(0, Number(freshMatch.medicalTimers[side] || 0) - 1);
    touch(freshMatch);
    if (freshMatch.medicalTimers[side] === 0) {
      stopMedicalTimer(match.id, side);
      const otherSide = side === 'red' ? 'blue' : 'red';
      if (Number(freshMatch.medicalTimers[otherSide] || 0) === 0 && freshMatch.medicalPauseResume) {
        freshMatch.medicalPauseResume = false;
        freshMatch.status = freshMatch.goldenPoint ? MATCH_STATUS.GOLDEN : MATCH_STATUS.RUNNING;
        const area = getArea(freshMatch.areaId);
        if (area) {
          area.status = AREA_STATUS.FIGHTING_RUNNING;
          touch(area);
        }
        startTimer(io, freshMatch);
      }
    }
    emitArea(io, freshMatch.areaId);
  }, 1000));
}

function startTimer(io, match) {
  stopTimer(match.id);
  if (![MATCH_STATUS.RUNNING, MATCH_STATUS.GOLDEN, MATCH_STATUS.BREAK].includes(match.status)) return;

  timers.set(match.id, setInterval(() => {
    const freshMatch = db.fightMatches.find((row) => row.id === match.id);
    if (!freshMatch || ![MATCH_STATUS.RUNNING, MATCH_STATUS.GOLDEN, MATCH_STATUS.BREAK].includes(freshMatch.status)) {
      stopTimer(match.id);
      return;
    }

    if (freshMatch.remainingSeconds > 0) {
      freshMatch.remainingSeconds -= 1;
      touch(freshMatch);
      emitArea(io, freshMatch.areaId);
      return;
    }

    if (freshMatch.status === MATCH_STATUS.BREAK) {
      freshMatch.round += 1;
      freshMatch.remainingSeconds = freshMatch.roundSeconds;
      freshMatch.goldenPoint = freshMatch.round >= 4;
      freshMatch.status = freshMatch.goldenPoint ? MATCH_STATUS.GOLDEN : MATCH_STATUS.RUNNING;
      const area = getArea(freshMatch.areaId);
      if (area) {
        area.status = AREA_STATUS.FIGHTING_RUNNING;
        touch(area);
      }
      pushHistory(freshMatch, { type: 'round', label: `Bắt đầu ${freshMatch.goldenPoint ? 'hiệp phụ' : 'hiệp'} ${freshMatch.round}` });
      touch(freshMatch);
      emitArea(io, freshMatch.areaId);
      return;
    }

    if (freshMatch.round === 3 && freshMatch.redScore !== freshMatch.blueScore) {
      freshMatch.winner = getWinnerByScore(freshMatch.redScore, freshMatch.blueScore);
      freshMatch.winReason = 'Hết 3 hiệp chính';
      freshMatch.status = MATCH_STATUS.FINISHED;
      advanceBracket(freshMatch);
      stopTimer(freshMatch.id);
      touch(freshMatch);
      emitArea(io, freshMatch.areaId);
      return;
    }

    if (freshMatch.round >= 9) {
      freshMatch.status = MATCH_STATUS.DECISION;
      freshMatch.remainingSeconds = 0;
      stopTimer(freshMatch.id);
      const area = getArea(freshMatch.areaId);
      if (area) { area.status = AREA_STATUS.PAUSED; touch(area); }
      pushHistory(freshMatch, { type: 'decision', label: 'Hết hiệp phụ 9 · chờ Tổng trọng tài quyết định' });
      touch(freshMatch);
      emitArea(io, freshMatch.areaId);
      return;
    }

    freshMatch.status = MATCH_STATUS.BREAK;
    freshMatch.remainingSeconds = freshMatch.breakSeconds;
    pushHistory(freshMatch, { type: 'break', label: `Nghỉ giữa hiệp ${freshMatch.round}` });
    const area = getArea(freshMatch.areaId);
    if (area) {
      area.status = AREA_STATUS.PAUSED;
      touch(area);
    }
    touch(freshMatch);
    emitArea(io, freshMatch.areaId);
  }, 1000));
}

function resetJudgeIfOwned(socket, area) {
  let changed = false;
  Object.values(area.judgeSlots || {}).forEach((slot) => {
    if (slot.socketId === socket.id) {
      slot.status = JUDGE_STATUS.DISCONNECTED;
      slot.socketId = null;
      changed = true;
    }
  });
  if (changed) touch(area);
  return changed;
}

export function setupSocket(io) {
  io.on('connection', (socket) => {
    socket.on('join-area', ({ areaId }) => {
      const area = getArea(areaId);
      if (!area) return emitError(socket, 'Không tìm thấy sân');
      socket.join(`area:${areaId}`);
      socket.emit('area:state', getAreaState(areaId));
    });

    socket.on('judge:claim', ({ areaId, judgeNo, name }) => {
      const area = getArea(areaId);
      const no = Number(judgeNo);
      if (!area) return emitError(socket, 'Không tìm thấy sân');
      if (!area.judgeSlots[no]) return emitError(socket, 'Số thứ tự giám định không hợp lệ');
      const slot = area.judgeSlots[no];
      if (slot.socketId && slot.socketId !== socket.id) {
        return emitError(socket, `Giám định ${no} đã có người kết nối`);
      }

      socket.join(`area:${areaId}`);
      slot.status = JUDGE_STATUS.CONNECTED;
      slot.name = name || `Giám định ${no}`;
      slot.socketId = socket.id;
      slot.connectedAt = new Date().toISOString();
      touch(area);
      emitArea(io, areaId);
      socket.emit('judge:claimed', { areaId, judgeNo: no, redirect: area.type === AREA_TYPES.FORM ? `/forms/area/${areaId}/judge/${no}` : `/fighting/area/${areaId}/judge/${no}` });
    });

    socket.on('judge:release', ({ areaId, judgeNo }) => {
      const area = getArea(areaId);
      const no = Number(judgeNo);
      if (!area || !area.judgeSlots[no]) return;
      const slot = area.judgeSlots[no];
      if (!slot.socketId || slot.socketId === socket.id) {
        slot.status = JUDGE_STATUS.EMPTY;
        slot.name = '';
        slot.socketId = null;
        slot.connectedAt = null;
        touch(area);
        emitArea(io, areaId);
      }
    });

    socket.on('referee:reset-judge', ({ areaId, judgeNo }) => {
      const area = getArea(areaId);
      const no = Number(judgeNo);
      if (!area || !area.judgeSlots[no]) return emitError(socket, 'Không tìm thấy vị trí giám định');
      area.judgeSlots[no] = {
        judgeNo: no,
        status: JUDGE_STATUS.EMPTY,
        name: '',
        socketId: null,
        connectedAt: null
      };
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('form:select-entry', ({ areaId, entryId }) => {
      const result = selectFormEntryForArea(areaId, entryId);
      if (result.error) return emitError(socket, result.error);
      emitArea(io, areaId);
    });

    socket.on('form:update-status', ({ areaId, entryId, status }) => {
      const area = getArea(areaId);
      const entry = db.formEntries.find((row) => row.id === entryId && row.areaId === areaId);
      if (!area || area.type !== AREA_TYPES.FORM) return emitError(socket, 'Sân Quyền không hợp lệ');
      if (!entry) return emitError(socket, 'Không tìm thấy lượt thi');
      if (!Object.values(FORM_ENTRY_STATUS).includes(status)) return emitError(socket, 'Trạng thái lượt thi không hợp lệ');

      entry.status = status;
      if ([FORM_ENTRY_STATUS.SKIPPED, FORM_ENTRY_STATUS.CANCELLED].includes(status) && area.currentFormEntryId === entry.id) {
        area.currentFormEntryId = null;
        area.status = AREA_STATUS.IDLE;
      } else if (status === FORM_ENTRY_STATUS.COMPLETED && area.currentFormEntryId === entry.id) {
        // Giữ nguyên lượt đang trình chiếu sau khi chấm xong.
        // Màn trình chiếu Quyền chỉ chuyển sang người khác khi Tổng trọng tài Quyền chọn lượt khác.
        area.status = AREA_STATUS.IDLE;
      }
      touch(entry);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('form:clear-score', ({ areaId, entryId, judgeNo }) => {
      const area = getArea(areaId);
      const entry = db.formEntries.find((row) => row.id === entryId && row.areaId === areaId);
      const no = Number(judgeNo);
      if (!area || area.type !== AREA_TYPES.FORM) return emitError(socket, 'Sân Quyền không hợp lệ');
      if (!entry) return emitError(socket, 'Không tìm thấy lượt thi');
      if (!area.judgeSlots[no]) return emitError(socket, 'Giám định không hợp lệ');

      delete entry.scores[no];
      area.currentFormEntryId = entry.id;
      area.status = AREA_STATUS.FORM_RUNNING;
      updateFormFinalScore(entry);
      if (entry.status === FORM_ENTRY_STATUS.COMPLETED) {
        area.currentFormEntryId = entry.id;
        area.status = AREA_STATUS.IDLE;
      } else if (entry.status !== FORM_ENTRY_STATUS.CANCELLED) {
        entry.status = FORM_ENTRY_STATUS.RUNNING;
      }
      touch(entry);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('form:reset-entry', ({ areaId, entryId }) => {
      const area = getArea(areaId);
      const entry = db.formEntries.find((row) => row.id === entryId && row.areaId === areaId);
      if (!area || area.type !== AREA_TYPES.FORM) return emitError(socket, 'Sân Quyền không hợp lệ');
      if (!entry) return emitError(socket, 'Không tìm thấy lượt thi');

      entry.scores = {};
      entry.finalScore = null;
      entry.keptScores = [];
      entry.removedLow = null;
      entry.removedHigh = null;
      entry.status = FORM_ENTRY_STATUS.RUNNING;
      area.currentFormEntryId = entry.id;
      area.status = AREA_STATUS.FORM_RUNNING;
      touch(entry);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('form:calculate', ({ areaId, entryId }) => {
      const area = getArea(areaId);
      const entry = db.formEntries.find((row) => row.id === entryId && row.areaId === areaId) || findCurrentFormEntry(areaId);
      if (!area || area.type !== AREA_TYPES.FORM) return emitError(socket, 'Sân Quyền không hợp lệ');
      if (!entry) return emitError(socket, 'Không tìm thấy lượt thi');
      if (Object.keys(entry.scores || {}).length !== 5) return emitError(socket, 'Cần đủ 5 giám định nhập điểm mới tính được điểm');
      updateFormFinalScore(entry);
      if (entry.status === FORM_ENTRY_STATUS.COMPLETED) {
        // Không tự bỏ lượt khỏi màn trình chiếu sau khi tính điểm xong.
        // Tổng trọng tài Quyền sẽ chủ động bấm Trước/Sau hoặc Chọn thi để sang người khác.
        area.currentFormEntryId = entry.id;
        area.status = AREA_STATUS.IDLE;
      }
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('form:score', ({ areaId, entryId, judgeNo, score }) => {
      const area = getArea(areaId);
      if (!area || area.type !== AREA_TYPES.FORM) return emitError(socket, 'Sân Quyền không hợp lệ');
      const entry = db.formEntries.find((row) => row.id === entryId) || findCurrentFormEntry(areaId);
      if (!entry) return emitError(socket, 'Chưa có lượt thi hiện tại');
      if (entry.status === FORM_ENTRY_STATUS.COMPLETED) return emitError(socket, 'Lượt thi đã hoàn thành');
      const value = clampScore(score);
      if (value === null) return emitError(socket, 'Điểm phải từ 0 đến 100');
      const no = Number(judgeNo);
      if (!area.judgeSlots[no]) return emitError(socket, 'Giám định không hợp lệ');

      entry.scores[no] = value;
      updateFormFinalScore(entry);
      if (entry.status === FORM_ENTRY_STATUS.COMPLETED) {
        // Khi đủ 5 giám định, giữ nguyên người vừa thi trên màn trình chiếu để hiện điểm.
        // Chỉ chuyển sang lượt khác khi Tổng trọng tài Quyền chọn lượt khác.
        area.status = AREA_STATUS.IDLE;
        area.currentFormEntryId = entry.id;
      } else {
        area.status = AREA_STATUS.FORM_RUNNING;
        area.currentFormEntryId = entry.id;
      }
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('fight:select-match', ({ areaId, matchId }) => {
      const area = getArea(areaId);
      const match = db.fightMatches.find((row) => row.id === matchId && row.areaId === areaId);
      if (!area || area.type !== AREA_TYPES.FIGHTING) return emitError(socket, 'Sân Đối kháng không hợp lệ');
      if (!match) return emitError(socket, 'Không tìm thấy trận');
      const current = findCurrentMatch(areaId);
      if (current && current.id !== match.id && [MATCH_STATUS.RUNNING, MATCH_STATUS.PAUSED, MATCH_STATUS.GOLDEN, MATCH_STATUS.DECISION].includes(current.status)) {
        return emitError(socket, 'Không thể chuyển trận khi trận hiện tại chưa kết thúc/hủy/tạm bỏ qua');
      }
      area.currentFightMatchId = match.id;
      area.status = AREA_STATUS.IDLE;
      if ([MATCH_STATUS.PENDING, MATCH_STATUS.SKIPPED].includes(match.status)) match.status = MATCH_STATUS.PENDING;
      touch(area);
      touch(match);
      emitArea(io, areaId);
    });

    socket.on('fight:start', ({ areaId }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || area.type !== AREA_TYPES.FIGHTING || !match) return emitError(socket, 'Chưa chọn trận Đối kháng');
      if (match.testMode) resetFightTest(match);
      if ([MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED].includes(match.status)) return emitError(socket, 'Trận đã kết thúc/hủy');
      if (match.status === MATCH_STATUS.DECISION) return emitError(socket, 'Đang chờ Tổng trọng tài quyết định kết quả');
      if (!matchHasPassedWeighIn(match)) return emitError(socket, 'Chỉ được bắt đầu khi cả hai VĐV đã kiểm tra và đủ cân');
      if (match.status === MATCH_STATUS.BREAK) return emitError(socket, 'Đang trong thời gian nghỉ giữa hiệp');
      if (Number(match.medicalTimers?.red || 0) > 0 || Number(match.medicalTimers?.blue || 0) > 0) return emitError(socket, 'Đang trong thời gian y tế');
      match.status = match.goldenPoint ? MATCH_STATUS.GOLDEN : MATCH_STATUS.RUNNING;
      match.hasStarted = true;
      area.status = AREA_STATUS.FIGHTING_RUNNING;
      touch(match);
      touch(area);
      startTimer(io, match);
      emitArea(io, areaId);
    });

    socket.on('fight:test-mode', ({ areaId, enabled }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || area.type !== AREA_TYPES.FIGHTING || !match) return emitError(socket, 'Chưa chọn trận Đối kháng');
      if (match.hasStarted && !match.testMode) return emitError(socket, 'Trận đã bắt đầu, không thể bật test điểm');
      if (enabled) {
        if (match.status !== MATCH_STATUS.PENDING || match.hasStarted) return emitError(socket, 'Chỉ test điểm trước khi bắt đầu trận');
        match.testMode = true;
        pushHistory(match, { type: 'test', label: 'Bắt đầu test điểm' });
        touch(match);
      } else {
        resetFightTest(match);
      }
      area.status = AREA_STATUS.IDLE;
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('fight:pause', ({ areaId }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || !match) return;
      if (match.status === MATCH_STATUS.DECISION) return emitError(socket, 'Đang chờ Tổng trọng tài quyết định kết quả');
      match.status = MATCH_STATUS.PAUSED;
      area.status = AREA_STATUS.PAUSED;
      stopTimer(match.id);
      touch(match);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('fight:resume', ({ areaId }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || !match) return;
      if (match.status === MATCH_STATUS.DECISION) return emitError(socket, 'Đang chờ Tổng trọng tài quyết định kết quả');
      if (Number(match.medicalTimers?.red || 0) > 0 || Number(match.medicalTimers?.blue || 0) > 0) return emitError(socket, 'Đang trong thời gian y tế');
      match.status = match.goldenPoint ? MATCH_STATUS.GOLDEN : MATCH_STATUS.RUNNING;
      area.status = AREA_STATUS.FIGHTING_RUNNING;
      touch(match);
      touch(area);
      startTimer(io, match);
      emitArea(io, areaId);
    });

    socket.on('fight:next-round', ({ areaId }) => {
      const match = findCurrentMatch(areaId);
      if (!match) return emitError(socket, 'Chưa chọn trận');
      if (match.testMode) return emitError(socket, 'Hãy tắt test điểm trước khi đổi hiệp');
      if (match.round >= 9) return emitError(socket, 'Đã là hiệp cuối');
      match.round += 1;
      match.remainingSeconds = match.roundSeconds;
      match.status = MATCH_STATUS.PAUSED;
      match.goldenPoint = match.round >= 4;
      pushHistory(match, { type: 'round', label: `Sang hiệp ${match.round}` });
      stopTimer(match.id);
      touch(match);
      emitArea(io, areaId);
    });

    socket.on('fight:previous-round', ({ areaId }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || !match) return emitError(socket, 'Chưa chọn trận');
      if ([MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED, MATCH_STATUS.DECISION].includes(match.status)) return emitError(socket, 'Không thể quay hiệp khi trận đã kết thúc');
      if (match.round <= 1) return emitError(socket, 'Đang ở hiệp đầu tiên');
      stopTimer(match.id);
      stopAllMedicalTimers(match);
      match.round -= 1;
      match.remainingSeconds = match.roundSeconds;
      match.status = MATCH_STATUS.PAUSED;
      match.goldenPoint = match.round >= 4;
      area.status = AREA_STATUS.PAUSED;
      pushHistory(match, { type: 'round', label: `Quay lại hiệp ${match.round}` });
      touch(match);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('fight:set-time', ({ areaId, seconds }) => {
      const match = findCurrentMatch(areaId);
      if (!match) return emitError(socket, 'Chưa chọn trận');
      match.remainingSeconds = Math.max(0, Number(seconds) || 0);
      touch(match);
      emitArea(io, areaId);
    });

    socket.on('fight:set-break-time', ({ areaId, seconds }) => {
      const match = findCurrentMatch(areaId);
      if (!match) return emitError(socket, 'Chưa chọn trận');
      const value = Math.max(0, Number(seconds) || 0);
      match.breakSeconds = value;
      if (match.status === MATCH_STATUS.BREAK) {
        match.remainingSeconds = value;
      }
      pushHistory(match, { type: 'config', label: `Cài thời gian nghỉ giữa hiệp: ${value} giây` });
      touch(match);
      emitArea(io, areaId);
    });

    socket.on('fight:manual-score', ({ areaId, side, points }) => {
      const match = findCurrentMatch(areaId);
      if (!match) return emitError(socket, 'Chưa chọn trận');
      if (match.status === MATCH_STATUS.DECISION) return emitError(socket, 'Hiệp 9 đã kết thúc, hãy chọn trực tiếp bên thắng');
      if ([MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED].includes(match.status)) return emitError(socket, 'Trận đã kết thúc/hủy');
      if (!match.testMode && match.status === MATCH_STATUS.PENDING) return emitError(socket, 'Hãy bắt đầu trận hoặc bật test điểm trước khi chấm');
      if (![-2, -1, 1, 2, 3].includes(Number(points))) return emitError(socket, 'Mức điểm của Tổng trọng tài không hợp lệ');
      applyScore(io, match, {
        side,
        points: Number(points),
        source: 'referee',
        label: Number(points) === 3
          ? `${getSideLabel(side)} +3 · Đòn chân thành công tuyệt đối`
          : `${getSideLabel(side)} ${Number(points) > 0 ? '+' : ''}${Number(points)} do tổng trọng tài`
      });
      emitArea(io, areaId);
    });

    socket.on('fight:reminder', ({ areaId, side, kind }) => {
      const match = findCurrentMatch(areaId);
      if (!match) return emitError(socket, 'Chưa chọn trận');
      if (match.status === MATCH_STATUS.DECISION) return emitError(socket, 'Hiệp 9 đã kết thúc, hãy chọn trực tiếp bên thắng');
      if ([MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED].includes(match.status)) return emitError(socket, 'Trận đã kết thúc/hủy');
      if (!match.testMode && match.status === MATCH_STATUS.PENDING) return emitError(socket, 'Hãy bắt đầu trận hoặc bật test điểm trước khi thao tác');
      addReminder(io, match, side, kind);
      if (kind === 'medical' && ![MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED].includes(match.status)) startMedicalTimer(io, match, side);
      emitArea(io, areaId);
    });

    socket.on('fight:vote', ({ areaId, judgeNo, side, points }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || !match) return emitError(socket, 'Chưa chọn trận');
      if (!match.testMode && ![MATCH_STATUS.RUNNING, MATCH_STATUS.GOLDEN].includes(match.status)) return emitError(socket, 'Trận chưa chạy hoặc đang tạm dừng');
      if (![1, 2].includes(Number(points))) return emitError(socket, 'Giám định chỉ được bấm +1 hoặc +2');
      if (!['red', 'blue'].includes(side)) return emitError(socket, 'Bên điểm không hợp lệ');
      const no = Number(judgeNo);
      if (!area.judgeSlots[no]) return emitError(socket, 'Giám định không hợp lệ');

      const vote = {
        id: randomUUID(),
        judgeNo: no,
        side,
        points: Number(points),
        timestamp: Date.now(),
        used: false
      };
      match.pendingVotes.push(vote);

      // Dữ liệu nháy phiếu chỉ để trình chiếu/tổng trọng tài thấy ngay
      // GĐ nào vừa bấm ô 1 hoặc 2. Nó tách riêng với pendingVotes
      // để dù phiếu đã được xử lý thành điểm, ô của GĐ vẫn nháy rõ vài giây.
      match.voteFlashes = [
        ...((match.voteFlashes || []).filter((item) => Date.now() - Number(item.timestamp) <= 2200)),
        {
          id: vote.id,
          judgeNo: no,
          side,
          points: Number(points),
          timestamp: vote.timestamp
        }
      ];

      match.pendingVotes = match.pendingVotes.filter((item) => Date.now() - item.timestamp <= 6000 || item.used);
      processVotes(io, match);
      touch(match);
      emitArea(io, areaId);
    });

    socket.on('fight:win', ({ areaId, winner, reason = 'Tổng trọng tài chọn chiến thắng' }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || !match) return;
      if (match.testMode) return emitError(socket, 'Hãy tắt test điểm trước khi quyết định người thắng');
      if (!['red', 'blue'].includes(winner)) return emitError(socket, 'Bên thắng không hợp lệ');
      if ([MATCH_STATUS.PENDING, MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED].includes(match.status)) return emitError(socket, 'Trận chưa bắt đầu hoặc đã kết thúc');
      pushUndoState(match, `${getSideLabel(winner)} thắng trực tiếp`);
      match.winner = winner;
      match.winReason = reason;
      match.status = MATCH_STATUS.FINISHED;
      advanceBracket(match);
      area.status = AREA_STATUS.IDLE;
      stopTimer(match.id);
      stopAllMedicalTimers(match);
      pushHistory(match, { type: 'win', side: winner, winner, source: 'referee', label: `${getSideLabel(winner)} thắng trực tiếp` });
      touch(match);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('fight:end', ({ areaId }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || !match) return;
      if ([MATCH_STATUS.PENDING, MATCH_STATUS.FINISHED, MATCH_STATUS.CANCELLED].includes(match.status)) return emitError(socket, 'Trận chưa bắt đầu hoặc đã kết thúc');
      if (match.redScore === match.blueScore) return emitError(socket, 'Trận đang hòa; tiếp tục hiệp phụ hoặc chọn người thắng khi chờ quyết định');
      match.winner = getWinnerByScore(match.redScore, match.blueScore);
      match.winReason = match.winner ? 'Kết thúc trận' : 'Hòa - cần xử lý';
      match.status = MATCH_STATUS.FINISHED;
      advanceBracket(match);
      area.status = AREA_STATUS.IDLE;
      stopTimer(match.id);
      stopAllMedicalTimers(match);
      touch(match);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('fight:skip', ({ areaId }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!area || !match) return;
      match.status = MATCH_STATUS.SKIPPED;
      area.currentFightMatchId = null;
      area.status = AREA_STATUS.IDLE;
      stopTimer(match.id);
      stopAllMedicalTimers(match);
      touch(match);
      touch(area);
      emitArea(io, areaId);
    });

    socket.on('fight:undo', ({ areaId }) => {
      const area = getArea(areaId);
      const match = findCurrentMatch(areaId);
      if (!match) return emitError(socket, 'Chưa chọn trận');
      if (!Array.isArray(match.undoStack) || match.undoStack.length === 0) return emitError(socket, 'Không có hành động chấm điểm để hoàn tác');
      const snapshot = match.undoStack.pop();

      stopTimer(match.id);
      stopMedicalTimer(match.id, 'red');
      stopMedicalTimer(match.id, 'blue');
      match.redScore = snapshot.redScore;
      match.blueScore = snapshot.blueScore;
      match.reminders = snapshot.reminders;
      match.medicalTimers = snapshot.medicalTimers;
      match.medicalPauseResume = snapshot.medicalPauseResume;
      match.medicalCounts = snapshot.medicalCounts;
      match.round = snapshot.round;
      match.remainingSeconds = snapshot.remainingSeconds;
      match.goldenPoint = snapshot.goldenPoint;
      match.winner = snapshot.winner;
      match.winReason = snapshot.winReason;
      match.status = snapshot.status;
      const undoneItems = (match.history || []).slice(snapshot.historyLength);
      undoneItems.forEach((item) => { item.undone = true; item.undoneAt = new Date().toISOString(); });
      pushHistory(match, { type: 'undo', side: undoneItems.find((item) => item.side)?.side, source: 'referee', label: `Hoàn tác hành động: ${snapshot.label}` });

      if (area) {
        area.status = [MATCH_STATUS.RUNNING, MATCH_STATUS.GOLDEN].includes(match.status)
          ? AREA_STATUS.FIGHTING_RUNNING
          : match.status === MATCH_STATUS.PAUSED
            ? AREA_STATUS.PAUSED
            : AREA_STATUS.IDLE;
        touch(area);
      }
      if ([MATCH_STATUS.RUNNING, MATCH_STATUS.GOLDEN].includes(match.status)) startTimer(io, match);
      if (Number(match.medicalTimers?.red || 0) > 0) startMedicalTimer(io, match, 'red', match.medicalTimers.red);
      if (Number(match.medicalTimers?.blue || 0) > 0) startMedicalTimer(io, match, 'blue', match.medicalTimers.blue);
      touch(match);
      emitArea(io, areaId);
    });

    socket.on('disconnect', () => {
      for (const area of db.areas) {
        if (resetJudgeIfOwned(socket, area)) {
          emitArea(io, area.id);
        }
      }
    });
  });
}
