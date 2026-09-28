#!/bin/sh
# iMentor kunlik baza zaxirasi — 14 kunlik rotatsiya.
set -e
DIR=/home/imentor/backups
STAMP=$(date +%Y%m%d_%H%M)
docker exec imentor-postgres-1 pg_dump -U imentorfer imentorfer | gzip > "$DIR/imentor_$STAMP.sql.gz"
find "$DIR" -name "imentor_*.sql.gz" -mtime +14 -delete
echo "backup_ok $STAMP $(du -h "$DIR/imentor_$STAMP.sql.gz" | cut -f1)"
