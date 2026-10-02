#!/bin/sh
# Container start: apply migrations, optionally seed demo data, then serve.
set -e

echo "Applying database migrations..."
alembic upgrade head

if [ "${RUN_SEED:-false}" = "true" ]; then
    echo "Seeding demo data (idempotent)..."
    python -m app.seed
fi

echo "Starting API on port ${PORT:-8000}"
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers 1 \
    --proxy-headers \
    --forwarded-allow-ips="*"
