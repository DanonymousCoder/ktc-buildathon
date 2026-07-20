// FlowTrakka document tracker - Manifest V3 background service worker
//
// Tracking engine:
// - Store reading totals in chrome.storage.local under daily_logs and documents.
// - Track active document tab state with Chrome tab events.
// - Track user activity with chrome.idle.
// - Add one heartbeat minute to the active document and today's total only when
//   the user is active and a supported document is active.

const HEARTBEAT_ALARM = 'flowtrakka-heartbeat';
const HEARTBEAT_SECONDS = 60;
const IDLE_THRESHOLD_SECONDS = 60;
const PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
const SUPPORTED_FILE_TYPES = {
  pdf: { type: 'pdf', label: 'PDF', family: 'reading' },
  ppt: { type: 'slides', label: 'Slides', family: 'presentation' },
  pptx: { type: 'slides', label: 'Slides', family: 'presentation' },
  key: { type: 'slides', label: 'Slides', family: 'presentation' },
  doc: { type: 'doc', label: 'Document', family: 'writing' },
  docx: { type: 'doc', label: 'Document', family: 'writing' },
  odt: { type: 'doc', label: 'Document', family: 'writing' },
  xls: { type: 'sheet', label: 'Sheet', family: 'analysis' },
  xlsx: { type: 'sheet', label: 'Sheet', family: 'analysis' },
  csv: { type: 'sheet', label: 'Sheet', family: 'analysis' },
};

const WEB_DOCUMENT_HOSTS = [
  {
    host: 'docs.google.com',
    tests: [
      { pattern: /^\/document\//, type: 'doc', label: 'Google Doc', family: 'writing' },
      { pattern: /^\/presentation\//, type: 'slides', label: 'Google Slides', family: 'presentation' },
      { pattern: /^\/spreadsheets\//, type: 'sheet', label: 'Google Sheet', family: 'analysis' },
      { pattern: /^\/forms\//, type: 'form', label: 'Google Form', family: 'form' },
    ],
  },
  {
    host: 'onedrive.live.com',
    tests: [{ pattern: /^\//, type: 'office', label: 'Office Document', family: 'office' }],
  },
  {
    host: 'office.com',
    tests: [{ pattern: /^\//, type: 'office', label: 'Office Document', family: 'office' }],
  },
  {
    host: 'www.office.com',
    tests: [{ pattern: /^\//, type: 'office', label: 'Office Document', family: 'office' }],
  },
];

const MESSAGE_ACTIONS = {
  GET_LEADERBOARD: 'GET_LEADERBOARD',
  GET_TRACKING_STATE: 'GET_TRACKING_STATE',
  GET_LEADERBOARD_PAYLOAD: 'GET_LEADERBOARD_PAYLOAD',
  PAUSE_TRACKING: 'PAUSE_TRACKING',
  RESUME_TRACKING: 'RESUME_TRACKING',
  SET_LEADERBOARD_OPT_IN: 'SET_LEADERBOARD_OPT_IN',
  SET_TRACKING_ENABLED: 'SET_TRACKING_ENABLED',
  SET_TRACKING_PAUSED: 'SET_TRACKING_PAUSED',
  STOP_AND_SAVE: 'STOP_AND_SAVE',
};

const DEFAULT_SETTINGS = {
  enabled: true,
  leaderboard: {
    enabled: false,
    displayName: 'Anonymous Reader',
    userId: null,
    consentedAt: null,
    revokedAt: null,
  },
  paused: false,
};

let isUserActive = true;
let isDocumentActive = false;
let activeDocumentId = null;
let activeDocumentUrl = null;
let activeDocumentTitle = null;
let activeDocumentType = null;
let activeDocumentTypeLabel = null;
let activeTabId = null;
let activeLegStartedAt = null;
let trackingSettings = { ...DEFAULT_SETTINGS };

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFileExtension(url = '') {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\.([a-z0-9]+)$/i);
    return match?.[1]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

function detectDocument(tabOrUrl) {
  const url = typeof tabOrUrl === 'string' ? tabOrUrl : tabOrUrl?.url;
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'chrome-extension:' && parsed.hostname === PDF_VIEWER_EXTENSION_ID) {
      return { type: 'pdf', label: 'PDF', family: 'reading', source: 'chrome-pdf-viewer' };
    }

    const extension = getFileExtension(url);
    if (extension && SUPPORTED_FILE_TYPES[extension]) {
      return { ...SUPPORTED_FILE_TYPES[extension], source: 'file-extension', extension };
    }

    const webHost = WEB_DOCUMENT_HOSTS.find(({ host }) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    const webMatch = webHost?.tests.find(test => test.pattern.test(parsed.pathname));
    if (webMatch) {
      return { ...webMatch, source: 'web-app' };
    }
  } catch {
    return null;
  }

  return null;
}

function getDocumentTitle(tab, documentInfo) {
  if (tab?.title && tab.title !== tab.url && !tab.title.endsWith('- Google Chrome')) {
    return tab.title
      .replace(/ - (Google Docs|Google Slides|Google Sheets)$/i, '')
      .replace(/ - (PDF|PowerPoint|Word|Excel).*$/i, '')
      .trim();
  }

  try {
    const path = new URL(tab.url).pathname;
    return decodeURIComponent(path.split('/').pop()) || `Unknown ${documentInfo?.label || 'Document'}`;
  } catch {
    return `Unknown ${documentInfo?.label || 'Document'}`;
  }
}

function getDocumentId(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function guessCategory(title) {
  const text = title.toLowerCase();
  if (/research|paper|journal|study|survey/.test(text)) return 'RESEARCH';
  if (/system|architect|design|pattern|infra/.test(text)) return 'ARCHITECTURE';
  if (/ai|machine|neural|learning|deep|gpt|llm/.test(text)) return 'TECHNOLOGY';
  if (/finance|econom|market|invest|budget/.test(text)) return 'FINANCE';
  if (/law|legal|regulation|compliance|policy/.test(text)) return 'LEGAL';
  if (/medical|health|clinical|drug|pharma/.test(text)) return 'MEDICAL';
  return 'DOCUMENT';
}

function getFromStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setInStorage(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function createUserId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `flowtrakka-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    leaderboard: {
      ...DEFAULT_SETTINGS.leaderboard,
      ...(settings.leaderboard || {}),
    },
  };
}

async function getDailyLogs() {
  const { daily_logs } = await getFromStorage(['daily_logs']);
  return daily_logs || {};
}

async function setDailyLogs(dailyLogs) {
  await setInStorage({ daily_logs: dailyLogs });
}

async function getDocuments() {
  const { documents } = await getFromStorage(['documents']);
  return documents || {};
}

async function setDocuments(documents) {
  await setInStorage({ documents });
}

async function getLeaderboardEntries() {
  const { leaderboard_entries } = await getFromStorage(['leaderboard_entries']);
  return Array.isArray(leaderboard_entries) ? leaderboard_entries : [];
}

async function setLeaderboardEntries(entries) {
  await setInStorage({ leaderboard_entries: entries });
}

async function getTrackingSettings() {
  const { settings } = await getFromStorage(['settings']);
  return normalizeSettings(settings);
}

async function setTrackingSettings(settings) {
  trackingSettings = normalizeSettings(settings);
  await setInStorage({ settings: trackingSettings });
}

function createDailyLog(date) {
  return {
    date,
    total_seconds: 0,
    documents: {},
    updated_at: new Date().toISOString(),
  };
}

function createDocument({ id, url, title, documentInfo }) {
  const now = new Date().toISOString();
  return {
    id,
    url,
    title,
    type: documentInfo?.type || 'document',
    type_label: documentInfo?.label || 'Document',
    family: documentInfo?.family || 'document',
    source: documentInfo?.source || 'unknown',
    category: guessCategory(title),
    total_seconds: 0,
    first_opened_at: now,
    last_read_at: now,
  };
}

function buildTrackingState() {
  if (!trackingSettings.enabled) {
    return {
      status: 'disabled',
      isUserActive,
      isDocumentActive: false,
      isPdfActive: false,
      currentTabId: null,
      currentDocumentId: null,
      currentDocumentUrl: null,
      currentDocumentTitle: null,
      currentDocumentType: null,
      currentDocumentTypeLabel: null,
      currentPdfUrl: null,
      currentPdfTitle: null,
      activeLegStartedAt: null,
      pauseReason: 'disabled',
      settings: trackingSettings,
    };
  }

  if (trackingSettings.paused && isDocumentActive) {
    return {
      status: 'paused',
      isUserActive,
      isDocumentActive,
      isPdfActive: activeDocumentType === 'pdf',
      currentTabId: activeTabId,
      currentDocumentId: activeDocumentId,
      currentDocumentUrl: activeDocumentUrl,
      currentDocumentTitle: activeDocumentTitle,
      currentDocumentType: activeDocumentType,
      currentDocumentTypeLabel: activeDocumentTypeLabel,
      currentPdfUrl: activeDocumentUrl,
      currentPdfTitle: activeDocumentTitle,
      activeLegStartedAt: null,
      pauseReason: 'manual',
      settings: trackingSettings,
    };
  }

  return {
    status: isDocumentActive ? (isUserActive ? 'tracking' : 'paused') : 'inactive',
    isUserActive,
    isDocumentActive,
    isPdfActive: activeDocumentType === 'pdf',
    currentTabId: activeTabId,
    currentDocumentId: activeDocumentId,
    currentDocumentUrl: activeDocumentUrl,
    currentDocumentTitle: activeDocumentTitle,
    currentDocumentType: activeDocumentType,
    currentDocumentTypeLabel: activeDocumentTypeLabel,
    currentPdfUrl: activeDocumentUrl,
    currentPdfTitle: activeDocumentTitle,
    activeLegStartedAt,
    pauseReason: isDocumentActive && !isUserActive ? 'idle' : null,
    settings: trackingSettings,
  };
}

async function publishTrackingState() {
  await setInStorage({ trackingState: buildTrackingState() });
}

async function ensureDocumentForTab(tab) {
  const documentInfo = detectDocument(tab);
  const documentId = getDocumentId(tab.url);
  const title = getDocumentTitle(tab, documentInfo);
  const documents = await getDocuments();

  if (!documents[documentId]) {
    documents[documentId] = createDocument({
      id: documentId,
      url: tab.url,
      title,
      documentInfo,
    });
    await setDocuments(documents);
  } else {
    documents[documentId] = {
      ...documents[documentId],
      type: documents[documentId].type || documentInfo?.type || 'document',
      type_label: documents[documentId].type_label || documentInfo?.label || 'Document',
      family: documents[documentId].family || documentInfo?.family || 'document',
      source: documents[documentId].source || documentInfo?.source || 'unknown',
    };
    await setDocuments(documents);
  }

  activeDocumentId = documentId;
  activeDocumentUrl = tab.url;
  activeDocumentTitle = documents[documentId].title || title;
  activeDocumentType = documents[documentId].type || documentInfo?.type || 'document';
  activeDocumentTypeLabel = documents[documentId].type_label || documentInfo?.label || 'Document';
  activeTabId = tab.id;
}

async function setActiveDocumentFromTab(tab) {
  if (!trackingSettings.enabled) {
    isDocumentActive = false;
    activeDocumentId = null;
    activeDocumentUrl = null;
    activeDocumentTitle = null;
    activeDocumentType = null;
    activeDocumentTypeLabel = null;
    activeTabId = null;
    activeLegStartedAt = null;
    await publishTrackingState();
    return;
  }

  if (!tab || !detectDocument(tab)) {
    isDocumentActive = false;
    activeDocumentId = null;
    activeDocumentUrl = null;
    activeDocumentTitle = null;
    activeDocumentType = null;
    activeDocumentTypeLabel = null;
    activeTabId = null;
    activeLegStartedAt = null;
    await publishTrackingState();
    return;
  }

  const previousDocumentId = activeDocumentId;
  isDocumentActive = true;
  await ensureDocumentForTab(tab);
  if (!trackingSettings.paused && isUserActive && (!activeLegStartedAt || previousDocumentId !== activeDocumentId)) {
    activeLegStartedAt = Date.now();
  } else if (trackingSettings.paused) {
    activeLegStartedAt = null;
  }
  await publishTrackingState();
}

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await setActiveDocumentFromTab(tab);
  } catch (error) {
    console.warn('[FlowTrakka] Unable to inspect active tab', error);
  }
}

async function addReadingSeconds(seconds) {
  if (!seconds || seconds <= 0 || !activeDocumentId) return;

  const today = getTodayKey();
  const now = new Date().toISOString();
  const [dailyLogs, documents] = await Promise.all([getDailyLogs(), getDocuments()]);

  const currentDocument =
    documents[activeDocumentId] ||
    createDocument({
      id: activeDocumentId,
      url: activeDocumentUrl,
      title: activeDocumentTitle || 'Unknown Document',
      documentInfo: {
        type: activeDocumentType,
        label: activeDocumentTypeLabel,
      },
    });

  const currentDailyLog = dailyLogs[today] || createDailyLog(today);
  const dailyDocument = currentDailyLog.documents[activeDocumentId] || {
    document_id: activeDocumentId,
    title: currentDocument.title,
    url: currentDocument.url,
    type: currentDocument.type || activeDocumentType || 'document',
    type_label: currentDocument.type_label || activeDocumentTypeLabel || 'Document',
    seconds: 0,
  };

  documents[activeDocumentId] = {
    ...currentDocument,
    total_seconds: (currentDocument.total_seconds || 0) + seconds,
    last_read_at: now,
  };

  dailyLogs[today] = {
    ...currentDailyLog,
    total_seconds: (currentDailyLog.total_seconds || 0) + seconds,
    documents: {
      ...currentDailyLog.documents,
      [activeDocumentId]: {
        ...dailyDocument,
        type: dailyDocument.type || currentDocument.type || activeDocumentType || 'document',
        type_label: dailyDocument.type_label || currentDocument.type_label || activeDocumentTypeLabel || 'Document',
        seconds: (dailyDocument.seconds || 0) + seconds,
        last_read_at: now,
      },
    },
    updated_at: now,
  };

  activeLegStartedAt = Date.now();

  await setInStorage({
    daily_logs: dailyLogs,
    documents,
    trackingState: buildTrackingState(),
  });

  console.log(`[FlowTrakka] Added ${seconds}s to ${currentDocument.title}`);
}

async function addHeartbeatMinute() {
  if (
    !trackingSettings.enabled ||
    trackingSettings.paused ||
    !isUserActive ||
    !isDocumentActive ||
    !activeDocumentId
  ) {
    return;
  }

  await addReadingSeconds(HEARTBEAT_SECONDS);
}

async function commitActiveLeg() {
  if (
    !trackingSettings.enabled ||
    trackingSettings.paused ||
    !isUserActive ||
    !isDocumentActive ||
    !activeDocumentId ||
    !activeLegStartedAt
  ) {
    return;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - activeLegStartedAt) / 1000));
  if (elapsedSeconds > 0) {
    await addReadingSeconds(elapsedSeconds);
  }
}

function startHeartbeat() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
}

async function refreshRuntimeState() {
  trackingSettings = await getTrackingSettings();

  try {
    const idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS);
    isUserActive = idleState === 'active';
  } catch {
    isUserActive = true;
  }

  if (!isUserActive) {
    activeLegStartedAt = null;
  }

  await checkCurrentTab();
}

async function initializeEngine() {
  trackingSettings = await getTrackingSettings();
  chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
  startHeartbeat();
  await refreshRuntimeState();
}

async function handleHeartbeatAlarm() {
  await refreshRuntimeState();
  await addHeartbeatMinute();
}

async function getTrackingSnapshot() {
  const [dailyLogs, documents, settings] = await Promise.all([getDailyLogs(), getDocuments(), getTrackingSettings()]);
  trackingSettings = settings;
  return {
    trackingState: buildTrackingState(),
    daily_logs: dailyLogs,
    documents,
    settings,
  };
}

function getLeaderboardStreak(dailyLogs) {
  const dayKeys = new Set(
    Object.entries(dailyLogs)
      .filter(([, log]) => (log.total_seconds || 0) > 0)
      .map(([date]) => date)
  );
  let streak = 0;
  const cursor = new Date();

  while (true) {
    const key = [
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, '0'),
      String(cursor.getDate()).padStart(2, '0'),
    ].join('-');

    if (!dayKeys.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function buildTypeTotals(documents) {
  return Object.values(documents).reduce((totals, document) => {
    const type = document.type || 'document';
    totals[type] = (totals[type] || 0) + (document.total_seconds || 0);
    return totals;
  }, {});
}

function buildDailyLeaderboardSummary(dailyLogs) {
  return Object.entries(dailyLogs)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 30)
    .map(([date, log]) => ({
      date,
      totalSeconds: log.total_seconds || 0,
      documentsOpened: Object.keys(log.documents || {}).length,
    }));
}

function buildLeaderboardPayload(dailyLogs, documents, settings) {
  const today = getTodayKey();
  const allTimeSeconds = Object.values(documents).reduce((sum, document) => sum + (document.total_seconds || 0), 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    user: {
      id: settings.leaderboard.userId,
      displayName: settings.leaderboard.displayName || 'Anonymous Reader',
    },
    leaderboard: {
      todaySeconds: dailyLogs[today]?.total_seconds || 0,
      allTimeSeconds,
      documentsTracked: Object.keys(documents).length,
      currentStreakDays: getLeaderboardStreak(dailyLogs),
      typeTotals: buildTypeTotals(documents),
      recentDailyTotals: buildDailyLeaderboardSummary(dailyLogs),
    },
    privacy: {
      includesDocumentTitles: false,
      includesDocumentUrls: false,
      includesRawSessionHistory: false,
    },
  };
}

function toLeaderboardEntry(payload) {
  return {
    userId: payload.user.id,
    displayName: payload.user.displayName,
    todaySeconds: payload.leaderboard.todaySeconds,
    allTimeSeconds: payload.leaderboard.allTimeSeconds,
    documentsTracked: payload.leaderboard.documentsTracked,
    currentStreakDays: payload.leaderboard.currentStreakDays,
    typeTotals: payload.leaderboard.typeTotals,
    updatedAt: payload.generatedAt,
  };
}

async function upsertLeaderboardEntry(entry) {
  const entries = await getLeaderboardEntries();
  const nextEntries = [entry, ...entries.filter(item => item.userId !== entry.userId)]
    .sort((a, b) => (b.todaySeconds || 0) - (a.todaySeconds || 0) || (b.allTimeSeconds || 0) - (a.allTimeSeconds || 0))
    .slice(0, 50);
  await setLeaderboardEntries(nextEntries);
  return nextEntries;
}

async function getLeaderboardPayload(sendResponse) {
  const [dailyLogs, documents, settings] = await Promise.all([getDailyLogs(), getDocuments(), getTrackingSettings()]);
  trackingSettings = settings;

  if (!settings.leaderboard.enabled) {
    sendResponse({ ok: false, error: 'leaderboard_opt_in_required', leaderboardEnabled: false });
    return;
  }

  const payload = buildLeaderboardPayload(dailyLogs, documents, settings);
  await upsertLeaderboardEntry(toLeaderboardEntry(payload));

  sendResponse({ ok: true, leaderboardEnabled: true, payload });
}

async function getLeaderboard(sendResponse) {
  const [dailyLogs, documents, settings] = await Promise.all([getDailyLogs(), getDocuments(), getTrackingSettings()]);
  trackingSettings = settings;

  if (!settings.leaderboard.enabled) {
    sendResponse({
      ok: true,
      leaderboardEnabled: false,
      ownEntry: null,
      entries: await getLeaderboardEntries(),
      privacy: {
        includesDocumentTitles: false,
        includesDocumentUrls: false,
        includesRawSessionHistory: false,
      },
    });
    return;
  }

  const payload = buildLeaderboardPayload(dailyLogs, documents, settings);
  const ownEntry = toLeaderboardEntry(payload);
  const entries = await upsertLeaderboardEntry(ownEntry);

  sendResponse({
    ok: true,
    leaderboardEnabled: true,
    ownEntry,
    entries,
    privacy: payload.privacy,
  });
}

async function sendTrackingSnapshot(sendResponse) {
  await checkCurrentTab();
  sendResponse(await getTrackingSnapshot());
}

async function resumeTrackingManually(sendResponse) {
  await setTrackingSettings({ ...trackingSettings, enabled: true, paused: false });
  isUserActive = true;
  if (isDocumentActive) {
    activeLegStartedAt = Date.now();
  }

  await checkCurrentTab();
  await publishTrackingState();
  sendResponse({ ok: true, ...(await getTrackingSnapshot()) });
}

async function pauseTrackingManually(sendResponse) {
  await commitActiveLeg();
  activeLegStartedAt = null;
  await setTrackingSettings({ ...trackingSettings, paused: true });
  await checkCurrentTab();
  await publishTrackingState();
  sendResponse({ ok: true, ...(await getTrackingSnapshot()) });
}

async function stopAndSave(sendResponse) {
  await commitActiveLeg();
  activeLegStartedAt = null;
  await setTrackingSettings({ ...trackingSettings, paused: true });
  await publishTrackingState();
  sendResponse({ ok: true, ...(await getTrackingSnapshot()) });
}

async function setTrackingEnabled(enabled, sendResponse) {
  await commitActiveLeg();
  await setTrackingSettings({
    ...trackingSettings,
    enabled: Boolean(enabled),
    paused: Boolean(enabled) ? trackingSettings.paused : false,
  });
  if (!enabled) {
    isDocumentActive = false;
    activeDocumentId = null;
    activeDocumentUrl = null;
    activeDocumentTitle = null;
    activeDocumentType = null;
    activeDocumentTypeLabel = null;
    activeTabId = null;
    activeLegStartedAt = null;
  }
  await checkCurrentTab();
  await publishTrackingState();
  sendResponse({ ok: true, ...(await getTrackingSnapshot()) });
}

async function setTrackingPaused(paused, sendResponse) {
  if (paused) {
    await pauseTrackingManually(sendResponse);
    return;
  }

  await resumeTrackingManually(sendResponse);
}

async function setLeaderboardOptIn(request, sendResponse) {
  const currentSettings = await getTrackingSettings();
  const enabled = Boolean(request.enabled);
  const displayName = String(request.displayName || currentSettings.leaderboard.displayName || 'Anonymous Reader').trim() || 'Anonymous Reader';

  await setTrackingSettings({
    ...currentSettings,
    leaderboard: {
      ...currentSettings.leaderboard,
      enabled,
      displayName,
      userId: currentSettings.leaderboard.userId || createUserId(),
      consentedAt: enabled ? currentSettings.leaderboard.consentedAt || new Date().toISOString() : currentSettings.leaderboard.consentedAt,
      revokedAt: enabled ? null : new Date().toISOString(),
    },
  });

  sendResponse({ ok: true, ...(await getTrackingSnapshot()) });
}

chrome.runtime.onInstalled.addListener(() => {
  initializeEngine();
});

chrome.runtime.onStartup.addListener(() => {
  initializeEngine();
});

chrome.tabs.onActivated.addListener(() => {
  checkCurrentTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  if (tab.active) {
    checkCurrentTab();
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === activeTabId) {
    setActiveDocumentFromTab(null);
  }
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    isDocumentActive = false;
    activeTabId = null;
    activeLegStartedAt = null;
    publishTrackingState();
    return;
  }

  checkCurrentTab();
});

chrome.idle.onStateChanged.addListener(idleState => {
  isUserActive = idleState === 'active';
  if (!isUserActive) {
    activeLegStartedAt = null;
  } else if (trackingSettings.enabled && !trackingSettings.paused && isDocumentActive && !activeLegStartedAt) {
    activeLegStartedAt = Date.now();
  }
  publishTrackingState();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === HEARTBEAT_ALARM) {
    handleHeartbeatAlarm();
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === MESSAGE_ACTIONS.GET_LEADERBOARD || request.action === 'getLeaderboard') {
    getLeaderboard(sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.GET_TRACKING_STATE || request.action === 'getState') {
    sendTrackingSnapshot(sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.GET_LEADERBOARD_PAYLOAD || request.action === 'getLeaderboardPayload') {
    getLeaderboardPayload(sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.PAUSE_TRACKING || request.action === 'pauseTracking') {
    pauseTrackingManually(sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.RESUME_TRACKING || request.action === 'resumeManually') {
    resumeTrackingManually(sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.SET_LEADERBOARD_OPT_IN || request.action === 'setLeaderboardOptIn') {
    setLeaderboardOptIn(request, sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.STOP_AND_SAVE || request.action === 'stopAndSave') {
    stopAndSave(sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.SET_TRACKING_ENABLED || request.action === 'setTrackingEnabled') {
    setTrackingEnabled(request.enabled, sendResponse);
    return true;
  }

  if (request.action === MESSAGE_ACTIONS.SET_TRACKING_PAUSED || request.action === 'setTrackingPaused') {
    setTrackingPaused(request.paused, sendResponse);
    return true;
  }

  return false;
});

initializeEngine();
