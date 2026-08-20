export function mergeIntervals(intervals) {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = intervals
    .map(([start, end]) => [start, end])
    .sort((left, right) => left[0] - right[0]);
  const merged = [sorted[0]];

  for (const [start, end] of sorted.slice(1)) {
    const current = merged[merged.length - 1];
    if (start <= current[1]) {
      current[1] = Math.max(current[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}
