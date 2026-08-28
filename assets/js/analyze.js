/**
 * Pure set operations over parsed records. No DOM, no I/O - so every view in
 * the app is directly unit-testable (see tests/parse.test.html).
 */

function keySet(records) {
  return new Set(records.map((record) => record.key));
}

/** Records in `source` whose username does not appear in `other`. */
function difference(source, other) {
  const exclude = keySet(other);
  return source.filter((record) => !exclude.has(record.key));
}

/** Records in `source` whose username also appears in `other`. */
function intersection(source, other) {
  const include = keySet(other);
  return source.filter((record) => include.has(record.key));
}

/**
 * Build every view the results screen can show.
 *
 * The headline answer is `notFollowingBack`: accounts you follow that do not
 * follow you. `fans` is the mirror image, which people are usually just as
 * curious about.
 */
export function analyze(sets) {
  const {
    followers, following, pending, unfollowed, favorited, blocked,
    receivedRequests, recentRequests, removedSuggestions,
  } = sets;

  return {
    notFollowingBack: difference(following, followers),
    fans: difference(followers, following),
    mutuals: intersection(following, followers),
    pending,
    unfollowed,
    favorited,
    blocked,
    receivedRequests,
    recentRequests,
    removedSuggestions,
    totals: {
      followers: followers.length,
      following: following.length,
    },
  };
}

const SORTERS = {
  username: (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }),
  // Newest first. Records without a timestamp (the HTML export has none) sink
  // to the bottom rather than pretending to be old.
  newest: (a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity),
  oldest: (a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity),
};

export function sortRecords(records, mode) {
  const sorter = SORTERS[mode];
  if (!sorter) return records;
  return [...records].sort(sorter);
}

export function filterRecords(records, query) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return records;
  return records.filter((record) => record.key.includes(trimmed));
}

/** RFC 4180 quoting: wrap in quotes and double any internal quote. */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(records) {
  const header = ['username', 'profile_url', 'followed_on'];
  const rows = records.map((record) =>
    [
      csvCell(record.username),
      csvCell(record.href),
      csvCell(
        record.timestamp
          ? new Date(record.timestamp).toISOString().slice(0, 10)
          : record.dateText || ''
      ),
    ].join(',')
  );
  return [header.join(','), ...rows].join('\r\n');
}
