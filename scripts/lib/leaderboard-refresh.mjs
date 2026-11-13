export const sourceDate = value => new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit',
}).format(new Date(value));

// A file's import time (or mtime) is not evidence of when its page was read.
export function validateBrowserCapture(capture, source, previous, now = new Date()) {
  if (typeof capture.html !== 'string' || !capture.html.trim()) throw Error('Browser capture must contain the public page html');
  if (capture.url !== source.url) throw Error('Browser capture URL does not match the requested board');
  if (typeof capture.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(capture.capturedAt)
      || !Number.isFinite(Date.parse(capture.capturedAt)) || Date.parse(capture.capturedAt) > now.getTime())
    throw Error('Browser capture requires a valid non-future capturedAt timestamp with timezone');
  const checkedAt = sourceDate(capture.capturedAt);
  if (previous && (checkedAt < previous.checkedAt || (previous.capturedAt && Date.parse(capture.capturedAt) < Date.parse(previous.capturedAt))))
    throw Error('Browser capture predates the published snapshot');
  return {html:capture.html, checkedAt, capturedAt:capture.capturedAt};
}

export function attachRefreshStatus(data, report) {
  if (report.version !== 1 || !Array.isArray(report.results)) throw Error('Invalid leaderboard refresh report');
  const statuses = {};
  for (const result of report.results) {
    const board = data.boardAliases[result.board], coverage = data.leaderboardCoverage[board];
    // An older report must not describe a subsequently replaced snapshot.
    if (!coverage || result.retainedCheckedAt !== coverage.checkedAt || report.attemptedAt < coverage.checkedAt) continue;
    if (!['updated','retained-previous','failed'].includes(result.status)) throw Error('Invalid leaderboard refresh status');
    statuses[board] = {status:result.status, attemptedAt:report.attemptedAt, checkedAt:coverage.checkedAt,
      ...(result.error ? {error:result.error} : {})};
  }
  return {...data, leaderboardRefresh:statuses};
}
