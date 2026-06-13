// FlowSpace PDF Tracker — Popup Controller
// Merges: user's nav logic + screen 5 timer/badge pattern + live storage data binding

// SVG snippets for badge icons (avoids emoji dependency)
const SVG_CHECK = `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_PAUSE = `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

document.addEventListener('DOMContentLoaded', () => {

  // ============================================================
  // DOM REFS
  // ============================================================
  const navButtons  = document.querySelectorAll('.nav-item');
  const views       = document.querySelectorAll('.view');
  const appTitle    = document.getElementById('app-title');
  const resumeBtn   = document.getElementById('resume-btn');

  // Screen 5 (Live view) elements
  const liveTimeEl      = document.getElementById('live-time');
  const badgePdfEl      = document.getElementById('badge-pdf');
  const badgeUserEl     = document.getElementById('badge-user');
  const badgeTrackingEl = document.getElementById('badge-tracking');

  // Dashboard elements
  const dashTimeEl  = document.getElementById('dashboard-time');
  const statOpened  = document.getElementById('stat-opened');
  const statLongest = document.getElementById('stat-longest');
  const statStreak  = document.getElementById('stat-streak');
  const recentList  = document.getElementById('recent-pdfs-list');

  // Paused view elements
  const pausedDocEl     = document.getElementById('paused-doc-name');
  const pausedSessionEl = document.getElementById('paused-session-time');

  // ============================================================
  // NAVIGATION  (user's original logic)
  // ============================================================
  const titles = {
    'view-dashboard': 'PDF Tracker',
    'view-tracking' : 'Flow Space',
    'view-paused'   : 'PDF Tracker',
    'view-empty'    : 'ReadFlow',
  };

  function switchToView(viewId) {
    navButtons.forEach(btn => btn.classList.remove('active'));
    views.forEach(view => view.classList.add('hidden'));

    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');

    if (appTitle) appTitle.textContent = titles[viewId] || 'FlowSpace';

    const matchBtn = document.querySelector(`[data-target="${viewId}"]`);
    if (matchBtn) matchBtn.classList.add('active');
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchToView(btn.getAttribute('data-target'));
      // Stop live timer if user manually navigates away from tracking view
      if (btn.getAttribute('data-target') !== 'view-tracking') {
        stopLiveTimer();
      }
    });
  });

  // ============================================================
  // UTILITY — formatTime  (seconds → "Xh Ym" or "Ym")
  // ============================================================
  function formatTime(totalSeconds) {
    if (!totalSeconds || totalSeconds < 60) {
      return totalSeconds > 0 ? `${totalSeconds}s` : '0m';
    }
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ============================================================
  // LIVE TIMER  (screen 5 — user's pattern, now wired to real data)
  // ============================================================
  let timerInterval = null;

  function startLiveTimer(trackingState, savedTodaySeconds) {
    clearInterval(timerInterval);

    // Seconds already persisted to storage for today
    const base = savedTodaySeconds || 0;

    // Seconds elapsed in the current running leg (not yet saved)
    const legStart = trackingState.sessionStartTimestamp || Date.now();
    const legAtOpen = Math.floor((Date.now() - legStart) / 1000);

    // Total at popup-open time
    const totalAtOpen = base + legAtOpen;
    const openedAt = Date.now();

    function tick() {
      const elapsed = Math.floor((Date.now() - openedAt) / 1000);
      if (liveTimeEl) liveTimeEl.textContent = formatTime(totalAtOpen + elapsed);
    }

    tick(); // immediate render
    // Tick every second so minute-boundary updates are smooth
    timerInterval = setInterval(tick, 1000);
  }

  function stopLiveTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // ============================================================
  // BADGE HELPER  (screen 5 — user's handleUserIdle pattern)
  // ============================================================
  function setBadge(el, isActive, text) {
    if (!el) return;
    const icon = isActive ? SVG_CHECK : SVG_PAUSE;
    el.innerHTML = `${icon}${text}`;
    el.className = `badge ${isActive ? 'active' : 'inactive'}`;
  }

  // All badges → active (tracking running)
  function setBadgesTracking() {
    setBadge(badgePdfEl,      true,  'PDF ACTIVE');
    setBadge(badgeUserEl,     true,  'USER ACTIVE');
    setBadge(badgeTrackingEl, true,  'TRACKING RUNNING');
  }

  // User-idle / paused state
  function setBadgesPaused(reason) {
    setBadge(badgePdfEl,      true,  'PDF ACTIVE');
    setBadge(badgeUserEl,     false, reason === 'idle' ? 'USER IDLE' : 'USER INACTIVE');
    setBadge(badgeTrackingEl, false, 'TRACKING PAUSED');
  }

  // ============================================================
  // RENDER — Tracking view (screen 5)
  // ============================================================
  function renderTrackingView(state, daily) {
    setBadgesTracking();
    startLiveTimer(state, daily.totalSeconds || 0);
  }

  // ============================================================
  // RENDER — Paused view
  // ============================================================
  function renderPausedView(state) {
    if (pausedDocEl) {
      pausedDocEl.textContent = state.currentPdfTitle || 'Unknown PDF';
    }
    if (pausedSessionEl) {
      const secs = Math.floor((state.sessionAccumulatedMs || 0) / 1000);
      pausedSessionEl.textContent = formatTime(secs);
    }
  }

  // ============================================================
  // RENDER — Dashboard
  // ============================================================
  function renderDashboard(daily, sessions, streak) {
    if (dashTimeEl) dashTimeEl.textContent = formatTime(daily.totalSeconds || 0);
    if (statOpened)  statOpened.textContent  = daily.pdfsOpened || 0;
    if (statLongest) statLongest.textContent = formatTime(daily.longestSessionSeconds || 0);

    if (statStreak) {
      const today = new Date().toISOString().split('T')[0];
      const last  = streak.lastActiveDate;
      if (last === today) {
        statStreak.textContent = 'Today';
      } else {
        // Check if yesterday
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        statStreak.textContent = last === yesterday ? 'Yesterday' : last ? last : 'None';
      }
    }

    if (recentList) {
      if (!sessions || sessions.length === 0) {
        recentList.innerHTML = '<p class="empty-recent">No PDFs tracked yet today.</p>';
      } else {
        recentList.innerHTML = sessions.slice(0, 5).map(s => `
          <div class="pdf-item">
            <div class="pdf-item-info">
              <span class="pdf-category">${s.category || 'PDF'}</span>
              <span class="pdf-title">${s.pdfTitle || 'Unknown PDF'}</span>
            </div>
            <span class="pdf-time">${formatTime(s.seconds || 0)}</span>
          </div>
        `).join('');
      }
    }
  }

  // ============================================================
  // RESUME BUTTON
  // ============================================================
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'resumeManually' }, () => {
          loadAndRender();
        });
      } else {
        // Dev/offline fallback — just switch view
        switchToView('view-tracking');
      }
    });
  }

  // ============================================================
  // MAIN — Load from storage and render correct view
  // ============================================================
  function loadAndRender() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      // Not running as extension — show empty state for dev preview
      switchToView('view-empty');
      return;
    }

    chrome.storage.local.get(
      ['trackingState', 'dailyData', 'recentSessions', 'streak'],
      (result) => {
        const state   = result.trackingState  || { status: 'inactive' };
        const daily   = result.dailyData      || { totalSeconds: 0, pdfsOpened: 0, longestSessionSeconds: 0 };
        const sessions = result.recentSessions || [];
        const streak  = result.streak         || {};

        // Always keep the dashboard up to date in the background
        renderDashboard(daily, sessions, streak);
        stopLiveTimer();

        // Show the correct view based on tracking state
        if (state.status === 'tracking') {
          renderTrackingView(state, daily);
          switchToView('view-tracking');
        } else if (state.status === 'paused') {
          renderPausedView(state);
          setBadgesPaused(state.pauseReason);
          switchToView('view-paused');
        } else {
          // status === 'inactive' — no PDF open
          switchToView('view-empty');
        }
      }
    );
  }

  // ============================================================
  // INIT
  // ============================================================
  loadAndRender();

  // React in real-time to any state changes made by background.js
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.trackingState || changes.dailyData || changes.recentSessions)) {
        loadAndRender();
      }
    });
  }

});
