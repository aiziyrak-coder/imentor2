#!/usr/bin/env sh
# Kunlik analytics rollup — cron: 0 23 * * * /app/scripts/run_daily_rollup.sh
set -e
cd /app
python - <<'PY'
import datetime as dt
from app.core.db import SessionLocal
from app.services.report_rollup_service import rollup_day

day = dt.datetime.now(dt.timezone.utc).date()
db = SessionLocal()
try:
    n = rollup_day(db, day)
    db.commit()
    print(f"rollup_ok date={day.isoformat()} teachers={n}")
finally:
    db.close()
PY
