import { randomUUID } from 'node:crypto';

export const AREA_TYPES = {
  FORM: 'form',
  FIGHTING: 'fighting'
};

export const AREA_STATUS = {
  IDLE: 'idle',
  FORM_RUNNING: 'form_running',
  FIGHTING_RUNNING: 'fighting_running',
  PAUSED: 'paused',
  FINISHED: 'finished',
  LOCKED: 'locked'
};

export const FORM_ENTRY_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  SKIPPED: 'skipped',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

export const MATCH_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  BREAK: 'break',
  GOLDEN: 'golden',
  SKIPPED: 'skipped',
  FINISHED: 'finished',
  CANCELLED: 'cancelled'
};

export const JUDGE_STATUS = {
  EMPTY: 'empty',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  LOCKED: 'locked'
};

const now = () => new Date().toISOString();

export function deriveAgeGroup(birthYear) {
  const year = Number(birthYear);
  if (!year) return '';
  const age = new Date().getFullYear() - year;
  if (age <= 10) return 'Nhi đồng';
  if (age <= 12) return 'Lứa tuổi 1';
  if (age <= 15) return 'Lứa tuổi 2';
  if (age <= 18) return 'Lứa tuổi 3';
  return 'Thanh niên';
}

export function normalizeAthleteMeta(payload = {}) {
  const birthYear = payload.birthYear ? Number(payload.birthYear) : null;
  const weightKg = payload.weightKg ? Number(payload.weightKg) : null;
  return {
    unit: payload.unit || '',
    birthYear,
    gender: payload.gender || '',
    weightKg,
    // Hạng cân không nhập tay ở thí sinh. Hạng cân được lấy từ nội dung khi đăng ký/tạo lượt/tạo trận.
    weightClass: '',
    ageGroup: payload.ageGroup || deriveAgeGroup(birthYear)
  };
}

export function athleteSnapshot(athlete = {}) {
  return {
    athleteId: athlete.id || null,
    name: athlete.name || '',
    unit: athlete.unit || '',
    birthYear: athlete.birthYear || null,
    gender: athlete.gender || '',
    weightKg: athlete.weightKg || null,
    weightClass: '',
    ageGroup: athlete.ageGroup || deriveAgeGroup(athlete.birthYear)
  };
}

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function numberFromText(value) {
  const parsed = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWeightRange(value) {
  const text = normalizeText(value).replace(/kg|kgs|can|hang can/g, ' ');
  const range = text.match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|den|toi|to)\s*(\d+(?:[.,]\d+)?)/i);
  if (!range) return { min: null, max: null };
  const min = numberFromText(range[1]);
  const max = numberFromText(range[2]);
  if (min === null || max === null) return { min: null, max: null };
  return min <= max ? { min, max } : { min: max, max: min };
}

export function deriveContentWeightRange(content = {}) {
  const directMin = content.weightMin !== null && content.weightMin !== undefined && content.weightMin !== '' ? Number(content.weightMin) : null;
  const directMax = content.weightMax !== null && content.weightMax !== undefined && content.weightMax !== '' ? Number(content.weightMax) : null;
  if (Number.isFinite(directMin) || Number.isFinite(directMax)) {
    return {
      min: Number.isFinite(directMin) ? directMin : null,
      max: Number.isFinite(directMax) ? directMax : null
    };
  }
  const fromWeightClass = parseWeightRange(content.weightClass);
  if (fromWeightClass.min !== null || fromWeightClass.max !== null) return fromWeightClass;
  return parseWeightRange(content.name);
}

export function contentWeightClassLabel(content = {}) {
  if (!content) return '';
  if (content.weightClass) return content.weightClass;
  const range = deriveContentWeightRange(content);
  if (range.min !== null || range.max !== null) return `${range.min ?? '...'}-${range.max ?? '...'}kg`;
  return '';
}

export function deriveContentAgeGroup(content = {}) {
  if (!content) return '';
  if (content.type === AREA_TYPES.FORM && content.ageGroupScope === 'all') return '';
  if (content.ageGroup) return content.ageGroup;
  const text = normalizeText(content.name || '');
  if (text.includes('nhi dong')) return 'Nhi đồng';
  if (text.includes('lua tuoi 1') || text.includes('lt1')) return 'Lứa tuổi 1';
  if (text.includes('lua tuoi 2') || text.includes('lt2')) return 'Lứa tuổi 2';
  if (text.includes('lua tuoi 3') || text.includes('lt3')) return 'Lứa tuổi 3';
  if (text.includes('thanh nien')) return 'Thanh niên';
  return '';
}

export function deriveContentGender(content = {}) {
  if (!content) return '';
  if (content.gender) return content.gender;
  const text = normalizeText(content.name || '');
  if (/(^|\s)(nam|male)(\s|$)/.test(text)) return 'male';
  if (/(^|\s)(nu|female)(\s|$)/.test(text)) return 'female';
  return '';
}

export function matchesContentCriteria(athlete = {}, content = {}) {
  if (!athlete || !content) return false;

  const contentGender = deriveContentGender(content);
  if (contentGender && athlete.gender !== contentGender) return false;

  const contentAgeGroup = deriveContentAgeGroup(content);
  if (contentAgeGroup && (athlete.ageGroup || deriveAgeGroup(athlete.birthYear)) !== contentAgeGroup) return false;

  const birthYear = Number(athlete.birthYear) || null;
  if (content.birthYearFrom && (!birthYear || birthYear < Number(content.birthYearFrom))) return false;
  if (content.birthYearTo && (!birthYear || birthYear > Number(content.birthYearTo))) return false;

  const weightKg = Number(athlete.weightKg) || null;
  const weightRange = deriveContentWeightRange(content);
  if (weightRange.min !== null && (!weightKg || weightKg < weightRange.min)) return false;
  if (weightRange.max !== null && (!weightKg || weightKg > weightRange.max)) return false;

  return true;
}

function makeJudgeSlots(count = 5) {
  const slots = {};
  for (let i = 1; i <= count; i += 1) {
    slots[i] = {
      judgeNo: i,
      status: JUDGE_STATUS.EMPTY,
      name: '',
      socketId: null,
      connectedAt: null
    };
  }
  return slots;
}

function createSeedState() {
  const areaA = {
    id: 'A',
    name: 'Sân A',
    type: AREA_TYPES.FORM,
    status: AREA_STATUS.IDLE,
    judgeCount: 5,
    judgeSlots: makeJudgeSlots(5),
    currentFormEntryId: null,
    currentFightMatchId: null,
    createdAt: now(),
    updatedAt: now()
  };

  const areaB = {
    id: 'B',
    name: 'Sân B',
    type: AREA_TYPES.FIGHTING,
    status: AREA_STATUS.IDLE,
    judgeCount: 5,
    judgeSlots: makeJudgeSlots(5),
    currentFormEntryId: null,
    currentFightMatchId: null,
    createdAt: now(),
    updatedAt: now()
  };

  const formContentId = randomUUID();
  const fightingContentId = randomUUID();

  const formEntries = [
    { participantName: 'Nguyễn Văn A', participantUnit: 'CLB A', birthYear: 2012, gender: 'male', weightKg: 39, weightClass: '', orderNo: 1 },
    { participantName: 'Trần Văn B', participantUnit: 'CLB B', birthYear: 2011, gender: 'male', weightKg: 42, weightClass: '', orderNo: 2 },
    { participantName: 'Lê Văn C', participantUnit: 'CLB C', birthYear: 2012, gender: 'male', weightKg: 38, weightClass: '', orderNo: 3 }
  ].map((item) => ({
    id: randomUUID(),
    contentId: formContentId,
    areaId: 'A',
    participantName: item.participantName,
    participantUnit: item.participantUnit || '',
    birthYear: item.birthYear || null,
    gender: item.gender || '',
    weightKg: item.weightKg || null,
    weightClass: item.weightClass || '',
    ageGroup: item.ageGroup || deriveAgeGroup(item.birthYear),
    orderNo: item.orderNo,
    status: FORM_ENTRY_STATUS.PENDING,
    scores: {},
    finalScore: null,
    keptScores: [],
    removedLow: null,
    removedHigh: null,
    createdAt: now(),
    updatedAt: now()
  }));

  const fightMatches = [
    { redName: 'Võ sĩ Đỏ 1', blueName: 'Võ sĩ Xanh 1', orderNo: 1 },
    { redName: 'Võ sĩ Đỏ 2', blueName: 'Võ sĩ Xanh 2', orderNo: 2 },
    { redName: 'Võ sĩ Đỏ 3', blueName: 'Võ sĩ Xanh 3', orderNo: 3 }
  ].map((item) => createFightMatch({
    id: randomUUID(),
    contentId: fightingContentId,
    areaId: 'B',
    orderNo: item.orderNo,
    redName: item.redName,
    blueName: item.blueName
  }));

  return {
    settings: {
      tournamentName: 'GIẢI VOVINAM HỌC SINH PHƯỜNG TÙNG THIỆN NH 2025-2026',
      logoLeftUrl: '',
      logoRightUrl: '',
      updatedAt: now()
    },
    areas: [areaA, areaB],
    contents: [
      {
        id: formContentId,
        name: 'Long hổ quyền',
        type: AREA_TYPES.FORM,
        mode: 'individual',
        memberCount: 1,
        memberCountMax: 1,
        formSize: '1',
        ageGroupScope: 'all',
        limit: null,
        gender: '',
        ageGroup: '',
        birthYearFrom: null,
        birthYearTo: null,
        weightMin: null,
        weightMax: null,
        weightClass: '',
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: fightingContentId,
        name: 'Lứa tuổi 1 35-40kg',
        type: AREA_TYPES.FIGHTING,
        mode: 'individual',
        memberCount: 1,
        memberCountMax: 1,
        formSize: '1',
        ageGroupScope: 'specific',
        limit: null,
        gender: 'male',
        ageGroup: 'Lứa tuổi 1',
        birthYearFrom: null,
        birthYearTo: null,
        weightMin: 35,
        weightMax: 40,
        weightClass: '35-40kg',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    athletes: [
      { id: randomUUID(), name: 'Nguyễn Văn A', unit: 'CLB A', birthYear: 2012, gender: 'male', weightKg: 39, weightClass: '', ageGroup: 'Lứa tuổi 1', createdAt: now(), updatedAt: now() },
      { id: randomUUID(), name: 'Trần Văn B', unit: 'CLB B', birthYear: 2011, gender: 'male', weightKg: 42, weightClass: '', ageGroup: 'Lứa tuổi 1', createdAt: now(), updatedAt: now() },
      { id: randomUUID(), name: 'Lê Văn C', unit: 'CLB C', birthYear: 2012, gender: 'male', weightKg: 38, weightClass: '', ageGroup: 'Lứa tuổi 1', createdAt: now(), updatedAt: now() }
    ],
    registrations: [],
    formEntries,
    fightMatches
  };
}

export function createFightMatch({ id = randomUUID(), contentId = null, areaId, orderNo, redName, blueName, redAthleteId = null, blueAthleteId = null, redUnit = '', blueUnit = '', redBirthYear = null, blueBirthYear = null, redGender = '', blueGender = '', redWeightKg = null, blueWeightKg = null, redWeightClass = '', blueWeightClass = '', redAgeGroup = '', blueAgeGroup = '', roundSeconds = 120, breakSeconds = 45, maxRounds = 3 }) {
  return {
    id,
    contentId,
    areaId,
    orderNo: Number(orderNo) || 1,
    redName,
    blueName,
    redAthleteId,
    blueAthleteId,
    redUnit,
    blueUnit,
    redBirthYear,
    blueBirthYear,
    redGender,
    blueGender,
    redWeightKg,
    blueWeightKg,
    redWeightClass,
    blueWeightClass,
    redAgeGroup: redAgeGroup || deriveAgeGroup(redBirthYear),
    blueAgeGroup: blueAgeGroup || deriveAgeGroup(blueBirthYear),
    status: MATCH_STATUS.PENDING,
    round: 1,
    maxRounds: Math.max(1, Number(maxRounds) || 3),
    roundSeconds: Math.max(1, Number(roundSeconds) || 120),
    breakSeconds: Math.max(0, Number(breakSeconds) || 0),
    remainingSeconds: Math.max(1, Number(roundSeconds) || 120),
    redScore: 0,
    blueScore: 0,
    winner: null,
    winReason: null,
    goldenPoint: false,
    reminders: {
      red: { fault: 0, medical: 0, warnings: 0 },
      blue: { fault: 0, medical: 0, warnings: 0 }
    },
    pendingVotes: [],
    voteFlashes: [],
    processedVoteGroups: [],
    history: [],
    createdAt: now(),
    updatedAt: now()
  };
}

export const db = createSeedState();

export function makeId() {
  return randomUUID();
}

export function touch(row) {
  row.updatedAt = now();
  return row;
}

export function touchSettings() {
  db.settings.updatedAt = now();
  return db.settings;
}

export function publicArea(area) {
  return {
    ...area,
    judgeSlots: Object.fromEntries(
      Object.entries(area.judgeSlots || {}).map(([key, slot]) => [
        key,
        {
          judgeNo: slot.judgeNo,
          status: slot.status,
          name: slot.name,
          connectedAt: slot.connectedAt
        }
      ])
    )
  };
}

export function getArea(areaId) {
  return db.areas.find((area) => area.id === areaId);
}

export function getAreaState(areaId) {
  const area = getArea(areaId);
  if (!area) return null;
  return {
    settings: db.settings,
    area: publicArea(area),
    contents: db.contents.filter((content) => content.type === area.type),
    formEntries: db.formEntries.filter((entry) => entry.areaId === areaId),
    fightMatches: db.fightMatches.filter((match) => match.areaId === areaId),
    currentFormEntry: db.formEntries.find((entry) => entry.id === area.currentFormEntryId) || null,
    currentFightMatch: db.fightMatches.find((match) => match.id === area.currentFightMatchId) || null
  };
}

export function getGlobalState() {
  return {
    settings: db.settings,
    areas: db.areas.map(publicArea),
    contents: db.contents,
    athletes: db.athletes,
    registrations: db.registrations,
    formEntries: db.formEntries,
    fightMatches: db.fightMatches
  };
}

export function resetJudgeSlots(area, judgeCount = area.judgeCount || 5) {
  area.judgeCount = judgeCount;
  area.judgeSlots = makeJudgeSlots(judgeCount);
  touch(area);
  return area;
}

export function resetTournamentData() {
  db.athletes = [];
  db.registrations = [];
  db.formEntries = [];
  db.fightMatches = [];

  db.areas.forEach((area) => {
    area.status = AREA_STATUS.IDLE;
    area.currentFormEntryId = null;
    area.currentFightMatchId = null;
    resetJudgeSlots(area, area.judgeCount || 5);
    touch(area);
  });

  touchSettings();
  return getGlobalState();
}
