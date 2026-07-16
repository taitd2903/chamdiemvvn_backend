export function calculateFormFinalScore(scoresByJudge) {
  const values = Object.values(scoresByJudge)
    .map(Number)
    .filter((value) => Number.isFinite(value));

  if (values.length !== 5) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const kept = sorted.slice(1, 4);
  const finalScore = kept.reduce((sum, value) => sum + value, 0);

  return {
    finalScore,
    keptScores: kept,
    removedLow: low,
    removedHigh: high
  };
}

export function clampScore(score) {
  const number = Number(score);
  if (!Number.isFinite(number)) return null;
  if (number < 0 || number > 100) return null;
  return Math.round(number * 100) / 100;
}

export function getWinnerByScore(redScore, blueScore) {
  if (redScore > blueScore) return 'red';
  if (blueScore > redScore) return 'blue';
  return null;
}

export function getSideLabel(side) {
  if (side === 'red') return 'Đỏ';
  if (side === 'blue') return 'Xanh';
  return side;
}
