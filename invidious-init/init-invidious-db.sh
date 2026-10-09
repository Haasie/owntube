#!/bin/bash
set -eou pipefail

SQL_DIR="/config/sql"
if [ ! -d "$SQL_DIR" ]; then
  SQL_DIR="config/sql"
fi

for f in channels videos channel_videos users session_ids nonces annotations playlists playlist_videos; do
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" < "$SQL_DIR/$f.sql"
done
