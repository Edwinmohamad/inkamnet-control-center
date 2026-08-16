# INKAMNET Control Center v1.8.0 — Validation

Validated before packaging:
- JavaScript syntax: app/routes/services/middleware/config/scripts
- EJS static syntax, modal targets, POST CSRF tokens
- package.json JSON
- docker-compose.yml and GitHub Actions YAML
- shell scripts syntax
- CSS brace balance
- no production .env included
- ticket and server-duty evidence storage excluded from GitHub deploy deletion
- v1.8 schema bootstrap wired into application startup

Runtime-sensitive database changes are idempotent (`IF NOT EXISTS`) and execute after DB connectivity is confirmed.
