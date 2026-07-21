# FlowTrakka Cloudflare Leaderboard

This is the recommended free production backend for FlowTrakka's shared leaderboard. It uses Cloudflare Workers for the API and Cloudflare D1 for durable SQL storage.

Unlike Render Free web services, Workers do not need a warm server process, so the leaderboard API does not spin down after idle periods.

## Setup

Install Wrangler when you are ready to deploy:

```bash
npm install
npx wrangler login
```

Create the D1 database:

```bash
npx wrangler d1 create flowtrakka_leaderboard
```

Copy the returned `database_id` into `leaderboard-worker/wrangler.toml`.

Create the table:

```bash
npx wrangler d1 execute flowtrakka_leaderboard --remote --file=leaderboard-worker/schema.sql
```

Deploy the Worker:

```bash
npm run leaderboard:worker:deploy
```

Your API will be available at a URL similar to:

```text
https://flowtrakka-leaderboard.flowtrakka.workers.dev
```

## Extension Update

After deployment, update the extension's leaderboard URL defaults and `manifest.json` host permissions to the Workers URL.

Required endpoints:

- `GET /health`
- `GET /api/leaderboard`
- `POST /api/leaderboard/entries`

The Worker rejects payloads that do not explicitly exclude document titles, document URLs, and raw session history.
