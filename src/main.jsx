import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const EMPTY_STATE = {
  status: 'inactive',
  isUserActive: false,
  isPdfActive: false,
};

const EMPTY_DAILY = {
  totalSeconds: 0,
  pdfsOpened: 0,
  longestSessionSeconds: 0,
};

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

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(totalSeconds) {
  if (!totalSeconds || totalSeconds < 60) {
    return totalSeconds > 0 ? `${totalSeconds}s` : '0m';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatClock(totalSeconds) {
  const hours = String(Math.floor((totalSeconds || 0) / 3600)).padStart(2, '0');
  const minutes = String(Math.floor(((totalSeconds || 0) % 3600) / 60)).padStart(2, '0');
  const seconds = String(Math.floor((totalSeconds || 0) % 60)).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatRelativeTime(value) {
  if (!value) return 'Today';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 'Today';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSeconds < 3600) return `${Math.max(1, Math.floor(diffSeconds / 60))}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  if (diffSeconds < 172800) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(time));
}

function getElapsedLegSeconds(state) {
  if (state?.status !== 'tracking' || !state.activeLegStartedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - state.activeLegStartedAt) / 1000));
}

function normalizeTrackingSnapshot(snapshot = {}) {
  const todayLog = snapshot.daily_logs?.[getTodayKey()];
  const documentEntries = Object.values(todayLog?.documents || {});
  const allDocuments = snapshot.documents || {};
  const state = snapshot.trackingState || EMPTY_STATE;
  const elapsedLegSeconds = getElapsedLegSeconds(state);
  const sessions = documentEntries
    .map(entry => {
      const document = allDocuments[entry.document_id] || {};
      const isCurrentDocument = entry.document_id === state.currentDocumentId;
      return {
        id: entry.document_id,
        category: document.category || 'PDF',
        pdfTitle: entry.title || document.title || 'Unknown PDF',
        seconds: (entry.seconds || 0) + (isCurrentDocument ? elapsedLegSeconds : 0),
        lastReadAt: entry.last_read_at || document.last_read_at || null,
      };
    })
    .sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''));

  const totalSeconds = (todayLog?.total_seconds || 0) + elapsedLegSeconds;

  return {
    state,
    daily: {
      totalSeconds,
      pdfsOpened: documentEntries.length,
      longestSessionSeconds: Math.max(0, ...sessions.map(session => session.seconds || 0)),
      estimatedPagesRead: Math.max(documentEntries.length * 12, Math.floor(totalSeconds / 90)),
    },
    settings: { ...DEFAULT_SETTINGS, ...(snapshot.settings || state.settings || {}) },
    sessions,
    streak: { lastActiveDate: todayLog?.date || null },
    isExtension: typeof chrome !== 'undefined' && Boolean(chrome.storage),
  };
}

function readTrackingSnapshotFromStorage() {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      resolve({});
      return;
    }

    chrome.storage.local.get(['trackingState', 'daily_logs', 'documents'], result => {
      resolve({
        trackingState: result.trackingState,
        daily_logs: result.daily_logs,
        documents: result.documents,
      });
    });
  });
}

function requestTrackingSnapshot() {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      resolve({});
      return;
    }

    chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.GET_TRACKING_STATE }, response => {
      if (chrome.runtime.lastError || !response) {
        readTrackingSnapshotFromStorage().then(resolve);
        return;
      }

      resolve(response);
    });
  });
}

function useTrackingData() {
  const [data, setData] = useState({
    state: EMPTY_STATE,
    daily: EMPTY_DAILY,
    settings: DEFAULT_SETTINGS,
    sessions: [],
    streak: {},
    isExtension: typeof chrome !== 'undefined' && Boolean(chrome.storage),
  });

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return undefined;

    function load() {
      requestTrackingSnapshot().then(snapshot => {
        setData(normalizeTrackingSnapshot(snapshot));
      });
    }

    function handleStorageChange(changes, area) {
      if (area === 'local' && (changes.trackingState || changes.daily_logs || changes.documents)) {
        load();
      }
    }

    load();
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  return { ...data, refresh: () => requestTrackingSnapshot().then(snapshot => setData(normalizeTrackingSnapshot(snapshot))) };
}

function sendRuntimeAction(action, payload = {}) {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      resolve({ ok: false });
      return;
    }

    chrome.runtime.sendMessage({ action, ...payload }, response => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false });
        return;
      }

      resolve(response);
    });
  });
}

function exportTrackingData() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  chrome.storage.local.get(null, data => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `flowtrakka-export-${getTodayKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}

function useExactLiveSeconds(state, fallbackSeconds) {
  const [seconds, setSeconds] = useState(fallbackSeconds || 0);

  useEffect(() => {
    setSeconds(fallbackSeconds || 0);
  }, [fallbackSeconds]);

  useEffect(() => {
    if (state.status !== 'tracking') return undefined;

    let isMounted = true;

    async function tick() {
      const snapshot = await readTrackingSnapshotFromStorage();
      if (!isMounted) return;
      const normalized = normalizeTrackingSnapshot(snapshot);
      setSeconds(normalized.daily.totalSeconds || 0);
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, [state.status, state.currentDocumentId, state.activeLegStartedAt]);

  return seconds;
}

function Icon({ children, className = 'h-5 w-5' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function StopwatchIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v5l3 2" />
      <path d="M9 2h6" />
      <path d="M12 2v3" />
    </Icon>
  );
}

function HistoryIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

function SettingsIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.05 1.57V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.05-1.57 1.7 1.7 0 0 0-1.86.34l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.57-1H3a2 2 0 0 1 0-4h.03A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.86l-.05-.05a2 2 0 0 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 8.95 4.6 1.7 1.7 0 0 0 10 3.03V3a2 2 0 0 1 4 0v.03a1.7 1.7 0 0 0 1.05 1.57 1.7 1.7 0 0 0 1.86-.34l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.16.39.53.68 1 .84.18.06.36.1.57.1H21a2 2 0 0 1 0 4h-.03a1.7 1.7 0 0 0-1.57 1.06z" />
    </Icon>
  );
}

function BookIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
    </Icon>
  );
}

function ChartIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 17v-4" />
      <path d="M12 17V7" />
      <path d="M16 17v-7" />
    </Icon>
  );
}

function FileIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </Icon>
  );
}

function UserCheckIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M17 11l2 2 4-4" />
    </Icon>
  );
}

function PauseIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8v8" />
      <path d="M14 8v8" />
    </Icon>
  );
}

function StopIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </Icon>
  );
}

function ShareIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.5l6.8-4" />
      <path d="M8.6 13.5l6.8 4" />
    </Icon>
  );
}

function LockIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  );
}

function ShieldIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-5" />
    </Icon>
  );
}

function DownloadIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </Icon>
  );
}

function TrendIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </Icon>
  );
}

function Header({ currentView, setCurrentView }) {
  const isSettings = currentView === 'settings';

  return (
    <header className="flex h-[58px] items-center justify-between border-b border-outline bg-white px-5">
      <h1 className="text-xl font-semibold tracking-normal text-ink">{isSettings ? 'Settings' : 'FlowTrakka'}</h1>
      <div className="flex items-center gap-3 text-ink">
        <button className="icon-button" aria-label="View insights" onClick={() => setCurrentView('insights')}>
          <HistoryIcon className="h-5 w-5" />
        </button>
        <button
          className={`icon-button ${isSettings ? 'text-primary' : ''}`}
          aria-label="Open settings"
          onClick={() => setCurrentView('settings')}
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

function StatusChip({ active = false, children, icon }) {
  return (
    <span className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium ${active ? 'border-[#c6f6dc] bg-[#d5f8e5] text-[#005b28]' : 'border-outline bg-[#eef2f7] text-ink'}`}>
      {icon || <span className={`h-2 w-2 rounded-full border ${active ? 'border-[#005b28] bg-transparent' : 'border-ink'}`} />}
      {children}
    </span>
  );
}

function MetricTile({ icon, label, value, horizontal = false }) {
  return (
    <article className={`card ${horizontal ? 'flex items-center justify-center gap-5 py-7' : 'grid min-h-[132px] place-items-center px-4 py-6 text-center'}`}>
      <div className="text-primary">{icon}</div>
      <div>
        <div className="mt-2 text-2xl font-semibold leading-tight text-ink">{value}</div>
        <div className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-variant">{label}</div>
      </div>
    </article>
  );
}

function SummaryCard({ daily }) {
  const goalProgress = Math.min(100, Math.round(((daily.totalSeconds || 0) / 7200) * 100));
  const displayProgress = Math.max(goalProgress, daily.totalSeconds ? 8 : 0);

  return (
    <section className="card p-5">
      <div className="grid grid-cols-2 items-center gap-4">
        <div>
          <div className="text-4xl font-normal text-ink">{daily.pdfsOpened || 0}</div>
          <div className="mt-1 text-sm font-medium text-variant">PDFs Opened</div>
        </div>
        <div className="border-l border-outline pl-6">
          <div className="text-4xl font-normal text-ink">{daily.estimatedPagesRead || 0}</div>
          <div className="mt-1 text-sm font-medium text-variant">Pages Read</div>
        </div>
      </div>
      <div className="my-5 h-px bg-outline/70" />
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-variant">Daily Goal - {goalProgress}%</p>
        <TrendIcon className="h-4 w-4 text-success" />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e4e7eb]">
        <div className="h-full rounded-full bg-primary" style={{ width: `${displayProgress}%` }} />
      </div>
    </section>
  );
}

function RecentActivity({ sessions, compact = false, onViewAll }) {
  const fallback = [
    { id: 'sample-1', pdfTitle: 'Neural_Networks_Intro.pdf', seconds: 4800, lastReadAt: null, progress: 84 },
    { id: 'sample-2', pdfTitle: 'Deep_Learning_Vol3.pdf', seconds: 2700, lastReadAt: null, progress: 32 },
  ];
  const items = sessions.length ? sessions : fallback;

  return (
    <section className={compact ? 'card p-5' : ''}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-ink">Recent Activity</h2>
        <button className="text-xs font-semibold uppercase tracking-wide text-primary" onClick={onViewAll}>View All</button>
      </div>
      <div className="space-y-3">
        {items.slice(0, compact ? 2 : 3).map((session, index) => {
          const progress = session.progress || Math.min(100, Math.max(12, Math.round((session.seconds || 0) / 60)));
          return compact ? (
            <div key={session.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-ink">{session.pdfTitle}</p>
                <span className="rounded-lg bg-[#eef2f7] px-2 py-0.5 text-xs font-semibold text-variant">{progress}%</span>
              </div>
              <p className="text-xs text-variant">Last read: {index === 0 ? '14 mins ago' : formatRelativeTime(session.lastReadAt)}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#e5e9ef]">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <article key={session.id} className="card flex items-center gap-4 p-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                <FileIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-ink">{session.pdfTitle}</h3>
                <p className="text-sm text-variant">Read {Math.max(1, Math.round((session.seconds || 0) / 90))} pages - {formatTime(session.seconds || 0)}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#f0f1f3] px-3 py-1 text-sm text-variant">{formatRelativeTime(session.lastReadAt)}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EmptyIllustration() {
  return (
    <div className="relative mx-auto grid h-28 w-28 place-items-center rounded-full bg-[#eef3fb] text-primary">
      <div className="relative grid h-14 w-14 place-items-center rounded-md border-4 border-primary bg-[#d9e7ff]">
        <span className="text-sm font-semibold">PDF</span>
      </div>
      <div className="absolute bottom-5 right-5 grid h-10 w-10 place-items-center rounded-full border border-outline bg-white text-variant">
        <StopwatchIcon className="h-6 w-6" />
      </div>
    </div>
  );
}

function TrackerEmptyView() {
  function openFileAccessSettings() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      return;
    }

    window.open('chrome://extensions', '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex flex-col items-center px-5 pt-8 text-center">
      <EmptyIllustration />
      <h2 className="mt-7 text-xl font-medium text-primary">Open a PDF</h2>
      <p className="mt-3 max-w-[260px] text-sm leading-5 text-variant">Tracking begins automatically when a PDF is active in your browser.</p>
      <div className="mt-7 flex items-center gap-3">
        <StatusChip>Waiting</StatusChip>
        <button onClick={openFileAccessSettings}>
          <StatusChip active icon={<LockIcon className="h-3.5 w-3.5" />}>Local Only</StatusChip>
        </button>
      </div>
      <article className="card mt-9 flex w-full items-center gap-4 p-4 text-left">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#edf0f4] text-variant">
          <Icon className="h-5 w-5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </Icon>
        </div>
        <div>
          <h3 className="text-base font-medium text-ink">No active session</h3>
          <p className="text-sm text-variant">Navigate to a PDF document to start log.</p>
        </div>
      </article>
    </div>
  );
}

function TrackerActiveView({ state, daily, sessions, onPause, onResume, onStopAndSave, onViewLogs }) {
  const liveSeconds = useExactLiveSeconds(state, daily.totalSeconds || 0);
  const currentTitle = state.currentPdfTitle || sessions[0]?.pdfTitle || 'Current PDF document';
  const trackingRunning = Boolean((state.isPdfActive || state.status === 'tracking') && state.isUserActive !== false);
  const buttonAction = trackingRunning ? onPause : onResume;

  return (
    <div className="px-5 py-5">
      <section className="text-center">
        <StatusChip active>LIVE TRACKING</StatusChip>
        <p className="mt-6 text-base font-medium text-variant">Deep Work Session</p>
        <h2 className="mt-3 text-[56px] font-semibold leading-none text-primary">{formatClock(liveSeconds)}</h2>
        <p className="mt-5 truncate text-sm text-variant">Current focus: {currentTitle}</p>
      </section>

      <section className="mt-8 grid grid-cols-2 gap-4">
        <article className="card p-5">
          <FileIcon className="h-7 w-7 text-success" />
          <h3 className="mt-4 text-base font-medium text-ink">PDF Active</h3>
          <p className="text-sm text-variant">Document detected</p>
        </article>
        <article className="card p-5">
          <UserCheckIcon className="h-7 w-7 text-primary" />
          <h3 className="mt-4 text-base font-medium text-ink">User Active</h3>
          <p className="text-sm text-variant">Focus maintained</p>
        </article>
      </section>

      <button className="primary-button mt-6" onClick={buttonAction}>
        <PauseIcon className="h-5 w-5" />
        {trackingRunning ? 'Pause Session' : 'Resume Session'}
      </button>
      <button className="mx-auto mt-5 flex items-center justify-center gap-2 text-sm font-semibold text-danger" onClick={onStopAndSave}>
        <StopIcon className="h-4 w-4" />
        Stop & Save
      </button>

      <div className="mt-9">
        <RecentActivity sessions={sessions} compact onViewAll={onViewLogs} />
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-lg border border-[#c9d8ee] bg-[#edf5ff] p-4 text-left text-sm text-variant">
        <TrendIcon className="h-5 w-5 shrink-0 text-primary" />
        <p>You've reached your flow state. Keep reading for 15 more minutes to beat yesterday's record.</p>
      </div>
    </div>
  );
}

function TrackerSummaryView({ daily, sessions, onStopAndSave, onViewLogs }) {
  return (
    <div className="px-5 py-5">
      <section className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-variant">Current Session</p>
        <h2 className="mt-4 text-[56px] font-normal leading-none text-primary">{formatTime(daily.totalSeconds || 0)}</h2>
        <div className="mt-7">
          <StatusChip active>Tracking Active</StatusChip>
        </div>
      </section>
      <section className="mt-8 grid grid-cols-2 gap-4">
        <article className="card p-5">
          <FileIcon className="h-7 w-7 text-success" />
          <h3 className="mt-4 text-base font-medium text-ink">PDF Active</h3>
          <p className="text-sm text-variant">Document detected</p>
        </article>
        <article className="card p-5">
          <UserCheckIcon className="h-7 w-7 text-primary" />
          <h3 className="mt-4 text-base font-medium text-ink">User Active</h3>
          <p className="text-sm text-variant">Focus maintained</p>
        </article>
      </section>
      <button className="primary-button mt-6" onClick={onStopAndSave}>
        <PauseIcon className="h-5 w-5" />
        Stop Tracking
      </button>
      <h2 className="mt-8 text-xl font-semibold text-ink">Today's Summary</h2>
      <div className="mt-4">
        <SummaryCard daily={daily} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button className="secondary-button" onClick={onViewLogs}>
          <ChartIcon className="h-4 w-4" />
          View Logs
        </button>
        <button className="ghost-button" onClick={exportTrackingData}>
          <ShareIcon className="h-4 w-4" />
          Export
        </button>
      </div>
      {sessions.length > 0 && (
        <div className="mt-6">
          <RecentActivity sessions={sessions} compact onViewAll={onViewLogs} />
        </div>
      )}
    </div>
  );
}

function PausedView({ state, currentSessionSeconds, onResume }) {
  function resume() {
    onResume?.();
  }

  return (
    <div className="px-5 py-8">
      <section className="card p-6 text-center">
        <StatusChip>Tracking Paused</StatusChip>
        <h2 className="mt-5 text-xl font-semibold text-ink">{state.currentPdfTitle || 'Current document'}</h2>
        <p className="mt-2 text-sm text-variant">Session time</p>
        <div className="mt-3 text-5xl font-semibold text-primary">{formatClock(currentSessionSeconds || 0)}</div>
        <button className="primary-button mt-8" onClick={resume}>
          <StopwatchIcon className="h-5 w-5" />
          Resume Manually
        </button>
      </section>
    </div>
  );
}

function LibraryView({ sessions, onViewAll }) {
  return (
    <div className="px-5 py-6">
      <h2 className="text-xl font-semibold text-ink">Library</h2>
      <p className="mt-2 text-sm text-variant">Recent PDFs tracked locally on this device.</p>
      <div className="mt-5">
        {sessions.length ? (
          <RecentActivity sessions={sessions} onViewAll={onViewAll} />
        ) : (
          <TrackerEmptyView />
        )}
      </div>
    </div>
  );
}

function InsightsView({ daily, sessions, onViewAll }) {
  const weeklyAverageSeconds = daily.totalSeconds || daily.longestSessionSeconds || 0;
  const totalFocusSeconds = sessions.reduce((sum, session) => sum + (session.seconds || 0), 0) || daily.totalSeconds || 0;

  return (
    <div className="px-5 py-8">
      <section className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-variant">Weekly Average</p>
        <h2 className="mt-4 text-[42px] font-semibold leading-none text-primary">{formatTime(weeklyAverageSeconds)}</h2>
        <p className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-success">
          <TrendIcon className="h-4 w-4" />
          +12% vs last week
        </p>
      </section>
      <section className="mt-10 grid grid-cols-2 gap-4">
        <MetricTile icon={<FileIcon className="h-8 w-8" />} value={daily.pdfsOpened || 0} label="PDFs Opened" />
        <MetricTile icon={<BookIcon className="h-8 w-8" />} value={(daily.estimatedPagesRead || 0).toLocaleString()} label="Pages Read" />
      </section>
      <div className="mt-4">
        <MetricTile horizontal icon={<StopwatchIcon className="h-8 w-8" />} value={formatTime(totalFocusSeconds)} label="Total Focus Time" />
      </div>
      <div className="mt-9">
        <RecentActivity sessions={sessions} onViewAll={onViewAll} />
      </div>
      <footer className="mt-10 text-center text-sm text-variant">
        <p className="inline-flex items-center justify-center gap-2">
          <ShieldIcon className="h-4 w-4" />
          All data is stored locally on this device.
        </p>
        <p className="mt-3 text-xs uppercase tracking-[0.18em]">Privacy First Tracking</p>
      </footer>
    </div>
  );
}

function Toggle({ enabled }) {
  return (
    <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${enabled ? 'bg-primary' : 'bg-[#cbd5e1]'}`}>
      <span className={`h-5 w-5 rounded-full bg-white transition ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </span>
  );
}

function ToggleButton({ enabled, label, onClick }) {
  return (
    <button type="button" aria-label={label} aria-pressed={enabled} onClick={onClick}>
      <Toggle enabled={enabled} />
    </button>
  );
}

function SettingsView({ settings, onSetEnabled, onSetPaused }) {
  const [saveLabel, setSaveLabel] = useState('Save Settings');

  function markSaved() {
    setSaveLabel('Settings Saved');
    window.setTimeout(() => setSaveLabel('Save Settings'), 1400);
  }

  async function toggleEnabled() {
    await onSetEnabled(!settings.enabled);
    markSaved();
  }

  async function togglePaused() {
    if (!settings.enabled) return;
    await onSetPaused(!settings.paused);
    markSaved();
  }

  return (
    <div className="px-5 py-6">
      <section>
        <h2 className="mb-4 text-xl font-semibold text-ink">Tracking</h2>
        <div className="card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-medium text-ink">Enable Tracking</h3>
              <p className="text-sm text-variant">Log document interactions and reading time.</p>
            </div>
            <ToggleButton enabled={settings.enabled} label="Enable Tracking" onClick={toggleEnabled} />
          </div>
          <div className="my-5 h-px bg-outline" />
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-medium text-ink">Pause Tracking</h3>
              <p className="text-sm text-variant">Temporarily suspend all logging activities.</p>
            </div>
            <ToggleButton enabled={settings.enabled && settings.paused} label="Pause Tracking" onClick={togglePaused} />
          </div>
        </div>
      </section>
      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold text-ink">Privacy</h2>
        <div className="card p-5">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#dff4e8] text-success">
              <ShieldIcon className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-base font-medium text-ink">100% Local Storage</h3>
              <p className="text-sm leading-5 text-variant">Your data never leaves this browser. All processing is local.</p>
            </div>
          </div>
          <button className="secondary-button mt-6 w-full" onClick={exportTrackingData}>
            <DownloadIcon className="h-4 w-4" />
            Export Data
          </button>
        </div>
      </section>
      <p className="mt-8 text-center text-sm text-variant">FlowTrakka v2.4.0 - Google Workspace Integrated</p>
      <button className="primary-button mt-8" onClick={markSaved}>{saveLabel}</button>
    </div>
  );
}

function BottomNav({ currentView, setCurrentView }) {
  const items = [
    ['tracker', 'Tracker', <StopwatchIcon className="h-5 w-5" />],
    ['library', 'Library', <BookIcon className="h-5 w-5" />],
    ['insights', 'Insights', <ChartIcon className="h-5 w-5" />],
  ];

  return (
    <nav className="grid grid-cols-3 border-t border-outline bg-white px-4 pb-4 pt-3">
      {items.map(([id, label, icon]) => {
        const active = currentView === id || (currentView === 'settings' && id === 'insights' ? false : false);
        return (
          <button
            key={id}
            className={`grid justify-items-center gap-1 text-[11px] font-semibold transition ${active ? 'text-primary' : 'text-[#6f7480]'}`}
            onClick={() => setCurrentView(id)}
          >
            {icon}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ExtensionApiNotice({ isExtension }) {
  if (isExtension) return null;

  return (
    <div className="mx-5 mt-4 rounded-lg border border-[#c9d8ee] bg-[#edf5ff] px-3 py-2 text-xs font-medium text-primary">
      Extension APIs unavailable in browser preview.
    </div>
  );
}

function App() {
  const { state, daily, settings, sessions, isExtension, refresh } = useTrackingData();
  const [manualView, setManualView] = useState(null);

  const stateView = useMemo(() => {
    if (state.status === 'paused') return 'paused';
    return 'tracker';
  }, [state.status]);

  const currentView = manualView || stateView;
  const isTracking = state.status === 'tracking';
  const currentSessionSeconds = sessions.find(session => session.id === state.currentDocumentId)?.seconds || daily.totalSeconds || 0;

  async function runAction(action, payload = {}) {
    const response = await sendRuntimeAction(action, payload);
    if (response?.ok) {
      await refresh();
    }
    return response;
  }

  async function pauseTracking() {
    await runAction(MESSAGE_ACTIONS.PAUSE_TRACKING);
    setManualView('paused');
  }

  async function resumeTracking() {
    await runAction(MESSAGE_ACTIONS.RESUME_TRACKING);
    setManualView('tracker');
  }

  async function stopAndSave() {
    await runAction(MESSAGE_ACTIONS.STOP_AND_SAVE);
    setManualView('library');
  }

  async function setTrackingEnabled(enabled) {
    await runAction(MESSAGE_ACTIONS.SET_TRACKING_ENABLED, { enabled });
    setManualView(enabled ? 'tracker' : 'settings');
  }

  async function setTrackingPaused(paused) {
    await runAction(MESSAGE_ACTIONS.SET_TRACKING_PAUSED, { paused });
    setManualView(paused ? 'paused' : 'tracker');
  }

  function viewLogs() {
    setManualView('library');
  }

  return (
    <div className="min-h-[600px] w-[390px] overflow-hidden bg-surface text-ink">
      <Header currentView={currentView} setCurrentView={setManualView} />
      <ExtensionApiNotice isExtension={isExtension} />
      <main className="min-h-[492px] overflow-y-auto">
        {currentView === 'tracker' &&
          (isTracking ? (
            <TrackerActiveView
              state={state}
              daily={daily}
              sessions={sessions}
              onPause={pauseTracking}
              onResume={resumeTracking}
              onStopAndSave={stopAndSave}
              onViewLogs={viewLogs}
            />
          ) : (
            <TrackerEmptyView />
          ))}
        {currentView === 'paused' && <PausedView state={state} currentSessionSeconds={currentSessionSeconds} onResume={resumeTracking} />}
        {currentView === 'library' && <LibraryView sessions={sessions} onViewAll={viewLogs} />}
        {currentView === 'insights' && <InsightsView daily={daily} sessions={sessions} onViewAll={viewLogs} />}
        {currentView === 'settings' && <SettingsView settings={settings || DEFAULT_SETTINGS} onSetEnabled={setTrackingEnabled} onSetPaused={setTrackingPaused} />}
      </main>
      <BottomNav currentView={currentView} setCurrentView={setManualView} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
