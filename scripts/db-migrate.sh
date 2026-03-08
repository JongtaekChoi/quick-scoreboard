#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "[error] supabase CLI not found. Install first: brew install supabase/tap/supabase"
  exit 1
fi

TARGET="${1:-develop}"

case "$TARGET" in
  develop)
    DB_URL="${SUPABASE_DB_URL_DEVELOP:-}"
    ;;
  main|prod|production)
    DB_URL="${SUPABASE_DB_URL_MAIN:-}"
    ;;
  *)
    echo "[error] unknown target: $TARGET (use: develop | main)"
    exit 1
    ;;
esac

if [[ -z "$DB_URL" ]]; then
  echo "[error] DB url env is empty for target=$TARGET"
  if [[ "$TARGET" == "develop" ]]; then
    echo "export SUPABASE_DB_URL_DEVELOP='postgresql://...'"
  else
    echo "export SUPABASE_DB_URL_MAIN='postgresql://...'"
  fi
  exit 1
fi

if [[ "$TARGET" == "main" || "$TARGET" == "prod" || "$TARGET" == "production" ]]; then
  echo "[warn] You are about to apply migrations to MAIN (production) database."
  read -r -p "Type YES to continue: " CONFIRM
  if [[ "$CONFIRM" != "YES" ]]; then
    echo "[abort] canceled"
    exit 1
  fi
fi

echo "[info] applying migrations to $TARGET"
supabase db push --db-url "$DB_URL" --include-all

echo "[done] migration applied to $TARGET"
