const MAX_ENTRIES = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function sanitizeDisplayName(value) {
  const displayName = String(value || '').trim().replace(/\s+/g, ' ');
  return displayName.slice(0, 40) || 'Anonymous Reader';
}

function sanitizeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function sanitizeTypeTotals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((totals, [type, seconds]) => {
    const key = String(type || 'document').slice(0, 30);
    totals[key] = sanitizeNumber(seconds);
    return totals;
  }, {});
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('invalid_email');
  }
  return email;
}

function assertPrivacySafe(payload) {
  const privacy = payload?.privacy || {};
  return (
    privacy.includesDocumentTitles === false &&
    privacy.includesDocumentUrls === false &&
    privacy.includesRawSessionHistory === false
  );
}

function toLeaderboardEntry(payload) {
  if (!payload || payload.schemaVersion !== 1 || !assertPrivacySafe(payload)) {
    throw new Error('invalid_or_unsafe_payload');
  }

  const userId = String(payload.user?.id || '').trim();
  if (!userId) throw new Error('missing_user_id');

  return {
    userId,
    displayName: sanitizeDisplayName(payload.user?.displayName),
    todaySeconds: sanitizeNumber(payload.leaderboard?.todaySeconds),
    allTimeSeconds: sanitizeNumber(payload.leaderboard?.allTimeSeconds),
    documentsTracked: sanitizeNumber(payload.leaderboard?.documentsTracked),
    currentStreakDays: sanitizeNumber(payload.leaderboard?.currentStreakDays),
    typeTotals: sanitizeTypeTotals(payload.leaderboard?.typeTotals),
    updatedAt: new Date().toISOString(),
  };
}

function rowToEntry(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    todaySeconds: row.today_seconds,
    allTimeSeconds: row.all_time_seconds,
    documentsTracked: row.documents_tracked,
    currentStreakDays: row.current_streak_days,
    typeTotals: JSON.parse(row.type_totals || '{}'),
    updatedAt: row.updated_at,
  };
}

async function getLeaderboard(env) {
  const { results } = await env.DB.prepare(
    `SELECT user_id, display_name, today_seconds, all_time_seconds, documents_tracked,
      current_streak_days, type_totals, updated_at
     FROM leaderboard_entries
     ORDER BY today_seconds DESC, all_time_seconds DESC
     LIMIT ?`
  )
    .bind(MAX_ENTRIES)
    .all();

  return jsonResponse({
    ok: true,
    generatedAt: new Date().toISOString(),
    entries: (results || []).map(rowToEntry),
  });
}

async function upsertLeaderboardEntry(request, env) {
  try {
    const payload = await request.json();
    const entry = toLeaderboardEntry(payload);

    await env.DB.prepare(
      `INSERT INTO leaderboard_entries (
        user_id, display_name, today_seconds, all_time_seconds, documents_tracked,
        current_streak_days, type_totals, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        today_seconds = excluded.today_seconds,
        all_time_seconds = excluded.all_time_seconds,
        documents_tracked = excluded.documents_tracked,
        current_streak_days = excluded.current_streak_days,
        type_totals = excluded.type_totals,
        updated_at = excluded.updated_at`
    )
      .bind(
        entry.userId,
        entry.displayName,
        entry.todaySeconds,
        entry.allTimeSeconds,
        entry.documentsTracked,
        entry.currentStreakDays,
        JSON.stringify(entry.typeTotals),
        entry.updatedAt
      )
      .run();

    const leaderboardResponse = await getLeaderboard(env);
    const leaderboard = await leaderboardResponse.json();
    return jsonResponse({ ok: true, entry, entries: leaderboard.entries });
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || 'invalid_leaderboard_payload' }, 400);
  }
}

async function subscribeToWaitlist(request, env) {
  try {
    const payload = await request.json();
    const email = normalizeEmail(payload?.email);
    const source = String(payload?.source || 'landing-page').trim().slice(0, 40) || 'landing-page';
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO waitlist_subscribers (email, source, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         source = excluded.source,
         updated_at = excluded.updated_at`
    )
      .bind(email, source, now, now)
      .run();

    return jsonResponse({ ok: true, subscribed: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || 'waitlist_subscription_failed' }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'flowtrakka-leaderboard-worker' });
    }

    if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
      return getLeaderboard(env);
    }

    if (request.method === 'POST' && url.pathname === '/api/leaderboard/entries') {
      return upsertLeaderboardEntry(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/waitlist') {
      return subscribeToWaitlist(request, env);
    }

    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  },
};
