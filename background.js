// FlowSpace PDF Tracker — Background Service Worker
// Responsibilities:
//   1. Detect when a PDF tab is active in the focused window
//   2. Start/pause/stop tracking based on tab focus + user idle state
//   3. Persist elapsed time to chrome.storage.local every minute via chrome.alarms
//   4. Save per-session data (PDF title, duration) to recentSessions

// ============================================================
// HELPERS
// ============================================================

/** Returns today's date as "YYYY-MM-DD" in local time */
function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Returns true if the tab URL points to a PDF */
function isPdfUrl(url) {
  if (!url) return false;
  // .pdf before an optional query string / hash / end-of-string
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  // Chrome's built-in PDF viewer (varies by Chrome version)
  if (url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')) return true;
  return false;
}

/** Extract a readable PDF filename from a tab */
function getPdfTitle(tab) {
  // Chrome often sets the tab title to the filename
  if (tab.title && tab.title !== tab.url && !tab.title.endsWith('- Google Chrome')) {
    return tab.title.replace(/ - PDF.*$/i, '').trim();
  }
  try {
    const path = new URL(tab.url).pathname;
    return decodeURIComponent(path.split('/').pop()) || 'Unknown PDF';
  } catch {
    return 'Unknown PDF';
  }
}

/** Guess a category from the PDF filename */
function guessCategory(title) {
  const t = title.toLowerCase();
  if (/research|paper|journal|study|survey/.test(t)) return 'RESEARCH';
  if (/system|architect|design|pattern|infra/.test(t)) return 'ARCHITECTURE';
  if (/ai|machine|neural|learning|deep|gpt|llm/.test(t)) return 'TECHNOLOGY';
  if (/finance|econom|market|invest|budget/.test(t)) return 'FINANCE';
  if (/law|legal|regulation|compliance|policy/.test(t)) return 'LEGAL';
  if (/medical|health|clinical|drug|pharma/.test(t)) return 'MEDICAL';
  return 'DOCUMENT';
}

// ============================================================
// DEFAULT STATE SHAPES
// ============================================================

const EMPTY_TRACKING = {
  status: 'inactive',          // 'inactive' | 'tracking' | 'paused'
  currentTabId: null,
  currentPdfUrl: null,
  currentPdfTitle: null,
  sessionStartTimestamp: null, // when the current running leg started
  sessionAccumulatedMs: 0,     // ms saved from previous legs of this session
  pauseReason: null,           // 'idle' | 'unfocused' | 'manual'
};

function freshDailyData() {
  return {
    date: getTodayKey(),
    totalSeconds: 0,
    pdfsOpened: 0,
    longestSessionSeconds: 0,
    openedPdfUrls: [],         // dedup guard — track which URLs were opened today
  };
}

// ============================================================
// STORAGE ACCESSORS
// ============================================================

function readStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['trackingState', 'dailyData', 'recentSessions', 'streak'],
      result => {
        // Roll over daily data if it's a new day
        let daily = result.dailyData || freshDailyData();
        if (daily.date !== getTodayKey()) {
          daily = freshDailyData();
        }
        resolve({
          state:    result.trackingState  || { ...EMPTY_TRACKING },
          daily,
          sessions: result.recentSessions || [],
          streak:   result.streak         || { lastActiveDate: null },
        });
      }
    );
  });
}

function writeTracking(trackingState) {
  return new Promise(resolve => chrome.storage.local.set({ trackingState }, resolve));
}

// ============================================================
// TIMING HELPERS
// ============================================================

/** Ms elapsed in the current running leg (0 if paused/inactive) */
function runningLegMs(state) {
  if (state.status === 'tracking' && state.sessionStartTimestamp) {
    return Date.now() - state.sessionStartTimestamp;
  }
  return 0;
}

/** Total session duration in ms */
function totalSessionMs(state) {
  return (state.sessionAccumulatedMs || 0) + runningLegMs(state);
}

// ============================================================
// CORE TRACKING ACTIONS
// ============================================================

async function startTracking(tab) {
  const { state, daily, sessions, streak } = await readStorage();

  // Already tracking this exact tab — no-op
  if (state.status === 'tracking' && state.currentTabId === tab.id) return;

  // Finish the previous session if there was one
  if (state.status !== 'inactive' && state.currentPdfUrl) {
    await finaliseSession(state, daily, sessions);
  }

  const { daily: freshDaily } = await readStorage(); // re-read after finalise

  const title = getPdfTitle(tab);
  const isNewPdf = !freshDaily.openedPdfUrls.includes(tab.url);

  const newState = {
    status: 'tracking',
    currentTabId: tab.id,
    currentPdfUrl: tab.url,
    currentPdfTitle: title,
    sessionStartTimestamp: Date.now(),
    sessionAccumulatedMs: 0,
    pauseReason: null,
  };

  const updatedDaily = {
    ...freshDaily,
    pdfsOpened: freshDaily.pdfsOpened + (isNewPdf ? 1 : 0),
    openedPdfUrls: isNewPdf
      ? [...freshDaily.openedPdfUrls, tab.url]
      : freshDaily.openedPdfUrls,
  };

  await chrome.storage.local.set({
    trackingState: newState,
    dailyData: updatedDaily,
    streak: { lastActiveDate: getTodayKey() },
  });

  console.log(`[FlowSpace] ▶ Tracking: ${title}`);
}

async function pauseTracking(reason) {
  const { state, daily } = await readStorage();
  if (state.status !== 'tracking') return;

  const legMs = runningLegMs(state);
  const addedSeconds = Math.floor(legMs / 1000);

  const paused = {
    ...state,
    status: 'paused',
    sessionStartTimestamp: null,
    sessionAccumulatedMs: (state.sessionAccumulatedMs || 0) + legMs,
    pauseReason: reason || 'manual',
  };

  const updatedDaily = {
    ...daily,
    totalSeconds: (daily.totalSeconds || 0) + addedSeconds,
  };

  await chrome.storage.local.set({ trackingState: paused, dailyData: updatedDaily });
  console.log(`[FlowSpace] ⏸ Paused (${reason})`);
}

async function resumeTracking() {
  const { state } = await readStorage();
  if (state.status !== 'paused' || !state.currentPdfUrl) return;

  // Verify the PDF tab still exists and is a PDF
  try {
    const tab = await chrome.tabs.get(state.currentTabId);
    if (!tab || !isPdfUrl(tab.url)) {
      await stopTracking();
      return;
    }
  } catch {
    await stopTracking();
    return;
  }

  await writeTracking({
    ...state,
    status: 'tracking',
    sessionStartTimestamp: Date.now(),
    pauseReason: null,
  });

  console.log('[FlowSpace] ▶ Resumed');
}

async function stopTracking() {
  const { state, daily, sessions } = await readStorage();
  if (state.status === 'inactive') return;

  await finaliseSession(state, daily, sessions);
  await writeTracking({ ...EMPTY_TRACKING });
  console.log('[FlowSpace] ■ Stopped');
}

/** Save final session duration and update longestSession in daily stats */
async function finaliseSession(state, daily, sessions) {
  const sessionSeconds = Math.floor(totalSessionMs(state) / 1000);
  if (sessionSeconds < 5) return; // ignore accidental blips

  // Build session record
  const title = state.currentPdfTitle || 'Unknown PDF';
  const record = {
    id: Date.now(),
    pdfTitle: title,
    pdfUrl: state.currentPdfUrl,
    category: guessCategory(title),
    seconds: sessionSeconds,
    date: getTodayKey(),
  };

  const updatedSessions = [record, ...sessions].slice(0, 20); // keep last 20

  const newLongest = Math.max(daily.longestSessionSeconds || 0, sessionSeconds);

  // Flush any in-flight running leg seconds into daily total
  const legSeconds = Math.floor(runningLegMs(state) / 1000);
  const updatedDaily = {
    ...daily,
    totalSeconds: (daily.totalSeconds || 0) + legSeconds,
    longestSessionSeconds: newLongest,
  };

  await chrome.storage.local.set({
    dailyData: updatedDaily,
    recentSessions: updatedSessions,
  });
}

// ============================================================
// PERIODIC SAVE (every 1 minute via chrome.alarms)
// Saves the running leg to daily total without resetting state,
// then resets sessionStartTimestamp to avoid double-counting.
// ============================================================
async function periodicSave() {
  const { state, daily } = await readStorage();
  if (state.status !== 'tracking' || !state.sessionStartTimestamp) return;

  const legMs = runningLegMs(state);
  const legSeconds = Math.floor(legMs / 1000);
  if (legSeconds < 1) return;

  const updatedDaily = {
    ...daily,
    totalSeconds: (daily.totalSeconds || 0) + legSeconds,
  };

  // Reset start timestamp; zero the unconfirmed leg from accumulated
  const updatedState = {
    ...state,
    sessionAccumulatedMs: (state.sessionAccumulatedMs || 0) + legMs,
    sessionStartTimestamp: Date.now(),
  };

  await chrome.storage.local.set({
    trackingState: updatedState,
    dailyData: updatedDaily,
  });

  console.log(`[FlowSpace] ✓ Saved ${legSeconds}s — daily total: ${updatedDaily.totalSeconds}s`);
}

// ============================================================
// MASTER CHECK — reads active tab and updates state accordingly
// ============================================================
async function checkCurrentState() {
  let activeTab;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    activeTab = tabs[0];
  } catch {
    return;
  }

  const onPdf = activeTab ? isPdfUrl(activeTab.url) : false;
  const { state } = await readStorage();

  if (onPdf) {
    // Check system idle state (threshold: 60s)
    const idleState = await chrome.idle.queryState(60);

    if (idleState === 'active') {
      if (state.status === 'tracking' && state.currentTabId === activeTab.id) {
        // Already tracking — nothing to do
      } else if (state.status === 'paused' && state.currentTabId === activeTab.id) {
        await resumeTracking();
      } else {
        await startTracking(activeTab);
      }
    } else {
      // System is idle
      if (state.status === 'tracking') {
        await pauseTracking('idle');
      }
    }
  } else {
    // No PDF in the foreground
    if (state.status !== 'inactive') {
      await stopTracking();
    }
  }
}

// ============================================================
// CHROME EVENT LISTENERS
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FlowSpace] Installed');
  chrome.alarms.create('periodicSave', { periodInMinutes: 1 });
  chrome.idle.setDetectionInterval(60);
  checkCurrentState();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[FlowSpace] Startup');
  chrome.alarms.create('periodicSave', { periodInMinutes: 1 });
  chrome.idle.setDetectionInterval(60);
  checkCurrentState();
});

// User switches between tabs
chrome.tabs.onActivated.addListener(() => {
  checkCurrentState();
});

// Tab URL changes (e.g. navigating to a PDF)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
      if (tabs[0] && tabs[0].id === tabId) checkCurrentState();
    });
  }
});

// Tab is closed — stop tracking if it was the tracked tab
chrome.tabs.onRemoved.addListener(async tabId => {
  const { state } = await readStorage();
  if (state.currentTabId === tabId) {
    await stopTracking();
  }
});

// Chrome window gains / loses focus
chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome lost focus (user switched to another app)
    const { state } = await readStorage();
    if (state.status === 'tracking') await pauseTracking('unfocused');
  } else {
    // Chrome regained focus — re-evaluate
    checkCurrentState();
  }
});

// System idle state changes (Chrome's built-in idle detection)
chrome.idle.onStateChanged.addListener(async idleState => {
  const { state } = await readStorage();

  if ((idleState === 'idle' || idleState === 'locked') && state.status === 'tracking') {
    await pauseTracking('idle');
  }

  if (idleState === 'active' && state.status === 'paused' &&
      (state.pauseReason === 'idle' || state.pauseReason === 'unfocused')) {
    checkCurrentState(); // will resume if PDF tab is still active
  }
});

// Periodic save alarm
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'periodicSave') periodicSave();
});

// Messages from popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'resumeManually') {
    resumeTracking().then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async response
  }
  if (request.action === 'getState') {
    readStorage().then(data => sendResponse(data));
    return true;
  }
});
