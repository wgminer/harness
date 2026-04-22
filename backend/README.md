# Personal API Backend

Minimal Node backend for personal data with one shared API key (`x-api-key`).

## Stack

- Fastify + TypeScript
- SQLite (`better-sqlite3`)
- Drizzle ORM schema
- SQL migrations in `src/db/migrations`

## Endpoints

- `GET /health` (public)
- `GET/POST /api/conversations`
- `GET/POST /api/conversations/:id/messages`
- `GET/POST/PATCH/DELETE /api/tasks`
- `GET/PUT/DELETE /api/memory`
- `GET/POST /api/plans`

All `/api/*` routes require header:

`x-api-key: <API_SECRET_KEY>`

## Local Run

1. Copy env file:
   - `cp .env.example .env`
2. Set `API_SECRET_KEY` in `.env`.
3. Install + run:
   - `npm install`
   - `npm run dev`

Server defaults to `http://localhost:3000`.

## Render Deploy

This folder includes `render.yaml`.

In Render:

1. Create a new Web Service from this repo.
2. Set root directory to `backend` (or use Blueprint with `render.yaml`).
3. Set `API_SECRET_KEY` as a secret env var.
4. Deploy and verify `/health`.

## Curl Smoke Tests

```bash
curl http://localhost:3000/health
```

```bash
curl -X POST http://localhost:3000/api/conversations \
  -H "content-type: application/json" \
  -H "x-api-key: dev-secret" \
  -d '{"title":"hello"}'
```
