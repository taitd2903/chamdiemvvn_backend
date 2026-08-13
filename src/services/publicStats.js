import { db } from '../store.js';
import { syncAllBrackets } from './draw.js';

function medal(type, contentId, athleteId, name, unit, discipline) {
  return { type, contentId, athleteId, name: name || '—', unit: unit || '—', discipline };
}

export function buildMedals() {
  const medals = [];
  for (const content of db.contents.filter((row) => row.type === 'form')) {
    const rows = db.formEntries.filter((row) => row.contentId === content.id && row.status === 'completed' && Number.isFinite(Number(row.finalScore)))
      .sort((a, b) => Number(b.finalScore) - Number(a.finalScore) || a.orderNo - b.orderNo);
    if (rows[0]) medals.push(medal('gold', content.id, rows[0].athleteId, rows[0].participantName, rows[0].participantUnit, 'form'));
    if (rows[1]) medals.push(medal('silver', content.id, rows[1].athleteId, rows[1].participantName, rows[1].participantUnit, 'form'));
    if (rows[2]) medals.push(medal('bronze', content.id, rows[2].athleteId, rows[2].participantName, rows[2].participantUnit, 'form'));
  }

  for (const bracket of syncAllBrackets()) {
    const rounds = bracket.rounds || [];
    const finalNode = rounds.at(-1)?.matches?.[0];
    const finalFight = db.fightMatches.find((row) => row.id === finalNode?.fightMatchId && row.status === 'finished');
    if (!finalFight?.winner) continue;
    const winnerSide = finalFight.winner;
    const loserSide = winnerSide === 'red' ? 'blue' : 'red';
    medals.push(medal('gold', bracket.contentId, finalFight[`${winnerSide}AthleteId`], finalFight[`${winnerSide}Name`], finalFight[`${winnerSide}Unit`], 'fighting'));
    medals.push(medal('silver', bracket.contentId, finalFight[`${loserSide}AthleteId`], finalFight[`${loserSide}Name`], finalFight[`${loserSide}Unit`], 'fighting'));
    const semiRound = rounds.at(-2);
    for (const node of semiRound?.matches || []) {
      const fight = db.fightMatches.find((row) => row.id === node.fightMatchId && row.status === 'finished');
      if (!fight?.winner) continue;
      const side = fight.winner === 'red' ? 'blue' : 'red';
      medals.push(medal('bronze', bracket.contentId, fight[`${side}AthleteId`], fight[`${side}Name`], fight[`${side}Unit`], 'fighting'));
    }
  }
  return medals;
}

export function buildRankings(medals = buildMedals()) {
  const formUnits = new Set(db.formEntries.filter((row) => row.status === 'completed').map((row) => row.participantUnit).filter(Boolean));
  const units = new Map();
  for (const registration of db.registrations) {
    const athlete = db.athletes.find((row) => row.id === registration.athleteId);
    const unit = athlete?.unit || '—';
    if (!units.has(unit)) units.set(unit, { unit, gold: 0, silver: 0, bronze: 0, total: 0, competedForm: formUnits.has(unit) });
  }
  for (const item of medals) {
    if (!units.has(item.unit)) units.set(item.unit, { unit: item.unit, gold: 0, silver: 0, bronze: 0, total: 0, competedForm: formUnits.has(item.unit) });
    const row = units.get(item.unit); row[item.type] += 1; row.total += 1;
  }
  for (const unit of formUnits) if (!units.has(unit)) units.set(unit, { unit, gold: 0, silver: 0, bronze: 0, total: 0, competedForm: true });
  const compare = (a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.unit.localeCompare(b.unit, 'vi');
  const eligible = [...units.values()].filter((row) => row.competedForm).sort(compare);
  const topThree = eligible.slice(0, 3);
  const topNames = new Set(topThree.map((row) => row.unit));
  const rest = [...units.values()].filter((row) => !topNames.has(row.unit)).sort(compare);
  return [...topThree.map((row, index) => ({ ...row, rank: index + 1 })), ...rest.map((row, index) => ({ ...row, rank: index + 4 }))];
}

export function getPublicTournamentState() {
  const medals = buildMedals();
  const participants = db.registrations.map((registration) => {
    const athlete = db.athletes.find((row) => row.id === registration.athleteId);
    const content = db.contents.find((row) => row.id === registration.contentId);
    if (!athlete || !content) return null;
    return { athleteId: athlete.id, name: athlete.name, unit: athlete.unit || '—', contentId: content.id, contentName: content.name, discipline: content.type };
  }).filter(Boolean);
  const brackets = syncAllBrackets().map((bracket) => ({
    ...bracket,
    rounds: bracket.rounds.map((round) => ({ ...round, matches: round.matches.map((node) => ({
      ...node,
      red: node.red ? { athleteId: node.red.athleteId, name: node.red.name, unit: node.red.unit, disqualifiedReason: node.red.disqualifiedReason } : null,
      blue: node.blue ? { athleteId: node.blue.athleteId, name: node.blue.name, unit: node.blue.unit, disqualifiedReason: node.blue.disqualifiedReason } : null
    })) }))
  }));
  return {
    tournamentName: db.settings.tournamentName,
    contents: db.contents,
    brackets,
    medals,
    participants,
    rankings: buildRankings(medals),
    formResults: db.formEntries.filter((row) => row.status === 'completed').map(({ scores, undoStack, ...row }) => row),
    fightResults: db.fightMatches.filter((row) => row.status === 'finished').map(({ history, undoStack, pendingVotes, ...row }) => row)
  };
}
