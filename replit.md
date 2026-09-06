# Project

This workspace has been reset and is ready for a new project.

## Production data safety

- Production PostgreSQL backup schedule and retention are not exposed to the Agent API; verify them in Database → Production → Restore settings before an incident.
- The "External database detected" banner is expected and must never be acted on. This project uses Neon via `DATABASE_URL`. Removing it disconnects production.

## User preferences

(none yet)
