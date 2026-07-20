# FlowTrakka QA Checklist

## File URL Test

1. Build and load `/dist` as the unpacked extension.
2. Open `chrome://extensions`, select FlowTrakka, and enable **Allow access to file URLs**.
3. Open a local supported document with Chrome, for example `file:///Users/<you>/Documents/sample.pdf` or a `.pptx`/`.docx` file that Chrome can display.
4. Open the popup.

Expected:
- The popup switches to the live tracking view.
- `chrome.storage.local` contains `trackingState.status === "tracking"`.
- The active document URL in `documents` starts with `file:///`.
- The stored document includes `type` and `type_label`.

## Web Document Test

1. Open a Google Doc, Google Slides deck, or Google Sheet.
2. Open the popup.

Expected:
- The popup switches to the live tracking view.
- The status card says the active document type, such as `Google Slides Active`.
- The document is stored locally with the correct `type`, such as `slides`, `doc`, or `sheet`.

## Suspension Test

1. Open a supported document tab and confirm FlowTrakka is tracking.
2. Leave Chrome alone long enough for the extension service worker to suspend.
3. Wait for the next heartbeat alarm.
4. Inspect `chrome.storage.local`.

Expected:
- The alarm wakes the service worker.
- `daily_logs[<today>].total_seconds` increments by 60 while the document remains active and the user is not idle.
- No service-worker error appears on the extension card.

## Distraction Test

1. Open a supported document tab and confirm tracking.
2. Switch to an unsupported tab, such as YouTube.
3. Wait one heartbeat interval.

Expected:
- `trackingState.status === "inactive"`.
- `daily_logs[<today>].total_seconds` does not increment while the unsupported tab is active.

## Midnight Roll-over

1. Open a supported document and confirm tracking.
2. Set the system clock near 11:59 PM.
3. Wait until after midnight and one heartbeat fires.
4. Inspect `chrome.storage.local.daily_logs`.

Expected:
- A new key appears for the new local date.
- The new date entry starts/increments independently.
- The previous date entry remains intact.
