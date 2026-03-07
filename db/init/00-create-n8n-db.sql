SELECT 'CREATE DATABASE n8ndb'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'n8ndb'
)\gexec
