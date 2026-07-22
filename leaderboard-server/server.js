import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FLOWTRAKKA_DATA_DIR || join(SERVER_DIR, 'data');
const DB_FILE = join(DATA_DIR, 'leaderboard.json');
const MAX_ENTRIES = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readStore() {
  try {
    const contents = await readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(contents);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      waitlist: Array.isArray(parsed.waitlist) ? parsed.waitlist : [],
    };
  } catch {
    return { entries: [], waitlist: [] };
  }
}

async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, `${JSON.stringify(store, null, 2)}\n`);
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

function sortEntries(entries) {
  return [...entries]
    .sort((a, b) => (b.todaySeconds || 0) - (a.todaySeconds || 0) || (b.allTimeSeconds || 0) - (a.allTimeSeconds || 0))
    .slice(0, MAX_ENTRIES);
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
    serverEntryId: randomUUID(),
  };
}

async function handleLeaderboardGet(response) {
  const store = await readStore();
  sendJson(response, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    entries: sortEntries(store.entries),
  });
}

async function handleLeaderboardPost(request, response) {
  try {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const entry = toLeaderboardEntry(payload);
    const store = await readStore();
    const entries = sortEntries([entry, ...store.entries.filter(item => item.userId !== entry.userId)]);
    await writeStore({ ...store, entries });
    sendJson(response, 200, { ok: true, entry, entries });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error?.message || 'invalid_leaderboard_payload',
    });
  }
}

async function handleWaitlistPost(request, response) {
  try {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const email = normalizeEmail(payload.email);
    const source = String(payload.source || 'landing-page').trim().slice(0, 40) || 'landing-page';
    const store = await readStore();
    const existing = store.waitlist.find(item => item.email === email);
    const now = new Date().toISOString();
    const subscriber = {
      email,
      source,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const waitlist = [subscriber, ...store.waitlist.filter(item => item.email !== email)];

    await writeStore({ ...store, waitlist });
    sendJson(response, 200, { ok: true, subscribed: true });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error?.message || 'waitlist_subscription_failed',
    });
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'flowtrakka-leaderboard' });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/leaderboard') {
    await handleLeaderboardGet(response);
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/leaderboard/entries') {
    await handleLeaderboardPost(request, response);
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/waitlist') {
    await handleWaitlistPost(request, response);
    return;
  }

  sendJson(response, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`FlowTrakka leaderboard server listening on http://localhost:${PORT}`);
});
