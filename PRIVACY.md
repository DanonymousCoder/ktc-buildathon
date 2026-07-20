# FlowTrakka Privacy Policy

Effective date: July 20, 2026

FlowTrakka is a Chrome extension that helps users track focused study and document review time across supported browser documents, including PDFs, slide decks, documents, and spreadsheets.

## Data FlowTrakka Stores

FlowTrakka stores the following data locally in your browser:

- Tracking settings, such as whether tracking is enabled or paused.
- Daily focus-time totals.
- Document activity metadata, such as document type, document category, total tracked seconds, and last-read timestamps.
- Leaderboard opt-in settings, such as display name and a locally generated user ID.
- Aggregate leaderboard statistics if leaderboard sharing is enabled.

## Data FlowTrakka Does Not Collect

FlowTrakka does not collect or store document contents.

FlowTrakka does not collect or store keystrokes.

FlowTrakka does not collect browsing history unrelated to supported document tracking.

FlowTrakka does not include document titles, document URLs, or raw session history in leaderboard sharing payloads.

## Local Storage

By default, FlowTrakka stores data locally using Chrome's `chrome.storage.local` API. This data remains on your device unless you choose to export it or opt in to a leaderboard feature.

## Leaderboard Sharing

Leaderboard sharing is optional and disabled by default.

If you opt in, FlowTrakka prepares aggregate statistics for competition and reward features. These aggregate statistics may include:

- Display name.
- Locally generated user ID.
- Today's total focus time.
- All-time focus time.
- Number of tracked documents.
- Current streak.
- Focus-time totals by document type.
- Recent daily aggregate totals.

Leaderboard sharing does not include document contents, document titles, document URLs, or raw session history.

You can disable leaderboard sharing from the extension settings.

## Data Export

FlowTrakka allows you to export your local data as a JSON file. Exported files are controlled by you and are not automatically transmitted by the extension.

## Permissions

FlowTrakka requests Chrome permissions only to provide its core tracking features:

- `storage`: stores settings, local focus totals, document metadata, and opt-in leaderboard preferences.
- `tabs`: detects whether the active tab is a supported document so tracking can start or stop automatically.
- `idle`: detects inactivity so idle time is not counted as focused time.
- `alarms`: runs a lightweight periodic heartbeat to update focus totals.

FlowTrakka does not use these permissions to read document contents.

## Remote Code

FlowTrakka does not execute remotely hosted code. All extension code is packaged with the installed extension.

## Data Retention

Local data remains in your browser until you remove it, clear extension storage, or uninstall the extension.

## Changes To This Policy

This privacy policy may be updated as FlowTrakka evolves. Material changes should be reflected in the extension listing or associated project documentation.

## Contact

For questions about this privacy policy, contact the FlowTrakka publisher using the contact email listed on the Chrome Web Store publisher profile.
