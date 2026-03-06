#!/bin/bash
set -e

# n8n 用データベースを作成（eventdb は POSTGRES_DB で自動作成済み）
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE n8ndb'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8ndb')\gexec
EOSQL
