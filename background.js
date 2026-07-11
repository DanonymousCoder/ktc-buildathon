// FlowTrakka PDF Tracker - Manifest V3 background service worker
//
// Sprint 2 engine:
// - Store reading totals in chrome.storage.local under daily_logs and documents.
// - Track active PDF tab state with Chrome tab events.
// - Track user activity with chrome.idle.
// - Add one heartbeat minute to the active document and today's total only when
//   the user is active and a PDF is active.

const HEARTBEAT_ALARM = 'flowtrakka-heartbeat';
const HEARTBEAT_SECONDS = 60;
const IDLE_THRESHOLD_SECONDS = 60;
const PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
const MESSAGE_ACTIONS = {
  GET_TRACKING_STATE: 'GET_TRACKING_STATE',
  PAUSE_TRACKING: 'PAUSE_TRACKING',
  RESUME_TRACKING: 'RESUME_TRACKING',
  SET_TRACKING_ENABLED: 'SET_TRACKING_ENABLED',
  SET_TRACKING_PAUSED: 'SET_TRACKING_PAUSED',
  STOP_AND_SAVE: 'STOP_AND_SAVE',
};

const DEFAULT_SETTINGS = {
  enabled: true,
  paused: false,
};

let isUserActive = true;
let isPdfActive = false;
let activeDocumentId = null;
let activeDocumentUrl = null;
let activeDocumentTitle = null;
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

function isPdfUrl(url = '') {
  if (!url) return false;

  if (/\.pdf(?:[?#]|$)/i.test(url)) return true;

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'chrome-extension:' &&
      parsed.hostname === PDF_VIEWER_EXTENSION_ID
    );
  } catch {
    return false;
  }
}

function getPdfTitle(tab) {
  if (tab?.title && tab.title !== tab.url && !tab.title.endsWith('- Google Chrome')) {
    return tab.title.replace(/ - PDF.*$/i, '').trim();
  }

  try {
    const path = new URL(tab.url).pathname;
    return decodeURIComponent(path.split('/').pop()) || 'Unknown PDF';
  } catch {
    return 'Unknown PDF';
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

async function getTrackingSettings() {
  const { settings } = await getFromStorage(['settings']);
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function setTrackingSettings(settings) {
  trackingSettings = { ...DEFAULT_SETTINGS, ...settings };
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

function createDocument({ id, url, title }) {
  const now = new Date().toISOString();
  return {
    id,
    url,
    title,
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
      isPdfActive: false,
      currentTabId: null,
      currentDocumentId: null,
      currentPdfUrl: null,
      currentPdfTitle: null,
      activeLegStartedAt: null,
      pauseReason: 'disabled',
      settings: trackingSettings,
    };
  }

  if (trackingSettings.paused && isPdfActive) {
    return {
      status: 'paused',
      isUserActive,
      isPdfActive,
      currentTabId: activeTabId,
      currentDocumentId: activeDocumentId,
      currentPdfUrl: activeDocumentUrl,
      currentPdfTitle: activeDocumentTitle,
      activeLegStartedAt: null,
      pauseReason: 'manual',
      settings: trackingSettings,
    };
  }

  return {
    status: isPdfActive ? (isUserActive ? 'tracking' : 'paused') : 'inactive',
    isUserActive,
    isPdfActive,
    currentTabId: activeTabId,
    currentDocumentId: activeDocumentId,
    currentPdfUrl: activeDocumentUrl,
    currentPdfTitle: activeDocumentTitle,
    activeLegStartedAt,
    pauseReason: isPdfActive && !isUserActive ? 'idle' : null,
    settings: trackingSettings,
  };
}

async function publishTrackingState() {
  await setInStorage({ trackingState: buildTrackingState() });
}

async function ensureDocumentForTab(tab) {
  const documentId = getDocumentId(tab.url);
  const title = getPdfTitle(tab);
  const documents = await getDocuments();

  if (!documents[documentId]) {
    documents[documentId] = createDocument({
      id: documentId,
      url: tab.url,
      title,
    });
    await setDocuments(documents);
  }

  activeDocumentId = documentId;
  activeDocumentUrl = tab.url;
  activeDocumentTitle = documents[documentId].title || title;
  activeTabId = tab.id;
}

async function setActivePdfFromTab(tab) {
  if (!trackingSettings.enabled) {
    isPdfActive = false;
    activeDocumentId = null;
    activeDocumentUrl = null;
    activeDocumentTitle = null;
    activeTabId = null;
    activeLegStartedAt = null;
    await publishTrackingState();
    return;
  }

  if (!tab || !isPdfUrl(tab.url)) {
    isPdfActive = false;
    activeDocumentId = null;
    activeDocumentUrl = null;
    activeDocumentTitle = null;
    activeTabId = null;
    activeLegStartedAt = null;
    await publishTrackingState();
    return;
  }

  const previousDocumentId = activeDocumentId;
  isPdfActive = true;
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
    await setActivePdfFromTab(tab);
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
      title: activeDocumentTitle || 'Unknown PDF',
    });

  const currentDailyLog = dailyLogs[today] || createDailyLog(today);
  const dailyDocument = currentDailyLog.documents[activeDocumentId] || {
    document_id: activeDocumentId,
    title: currentDocument.title,
    url: currentDocument.url,
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
    !isPdfActive ||
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
    !isPdfActive ||
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

async function sendTrackingSnapshot(sendResponse) {
  await checkCurrentTab();
  sendResponse(await getTrackingSnapshot());
}

async function resumeTrackingManually(sendResponse) {
  await setTrackingSettings({ ...trackingSettings, enabled: true, paused: false });
  isUserActive = true;
  if (isPdfActive) {
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
    isPdfActive = false;
    activeDocumentId = null;
    activeDocumentUrl = null;
    activeDocumentTitle = null;
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
    setActivePdfFromTab(null);
  }
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    isPdfActive = false;
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
  } else if (trackingSettings.enabled && !trackingSettings.paused && isPdfActive && !activeLegStartedAt) {
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
  if (request.action === MESSAGE_ACTIONS.GET_TRACKING_STATE || request.action === 'getState') {
    sendTrackingSnapshot(sendResponse);
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
