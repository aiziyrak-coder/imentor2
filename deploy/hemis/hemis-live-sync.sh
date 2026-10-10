#!/usr/bin/env bash
# Schedule polling only; run every five minutes after checking HEMIS capacity.
# Full student/staff imports remain in the daily job.
set -euo pipefail
exec 9>/home/imentor/backups/hemis-live-sync.lock
flock -n 9 || exit 0
printf '%s schedule-start\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker exec imentor-backend_fastapi-1 python /app/scripts/sync_hemis_lessons.py --weeks 2 --back-weeks 1
printf '%s schedule-success\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
