"""Sample current train speeds into today's per-segment totals.

Run on a schedule (see .github/workflows/speed-heatmap.yml). Each run adds one sample per
train whose position fix is new since the last run, so a slow schedule never double-counts.

Usage: python3 scripts/speed/collect.py DATA_DIR
DATA_DIR holds daily/YYYY-MM-DD.json and state.json. Daily totals are keyed
"<segment>@<period>" -> [mph_sum, samples], where period is the 4-hour slice of the day
(0 = midnight-4am ... 5 = 8pm-midnight) on the train's own local clock. Older files keyed by
bare segment count toward the all-day average only.
"""

import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from segments import Segments

API = "https://api-v3.amtraker.com/v3/trains"
MIN_MPH = 2  # stopped trains (station dwell, holds) would drag every average toward zero
KEEP_DAYS = 35
PERIOD_HOURS = 4


def main():
    data = Path(sys.argv[1])
    (data / "daily").mkdir(parents=True, exist_ok=True)
    state_path = data / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}

    req = urllib.request.Request(API, headers={"User-Agent": "amtracker-speed-heatmap"})
    trains = [t for group in json.load(urllib.request.urlopen(req, timeout=60)).values() for t in group]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day_path = data / "daily" / f"{today}.json"
    day = json.loads(day_path.read_text()) if day_path.exists() else {}

    segments = Segments()
    added = 0
    seen = {}
    for t in trains:
        fix = t.get("lastValTS")
        seen[t["trainID"]] = fix
        if not fix or state.get(t["trainID"]) == fix:
            continue
        mph = t.get("velocity") or 0
        if mph < MIN_MPH or not isinstance(t.get("lat"), (int, float)):
            continue
        key = segments.locate(t["trainNum"], t["lon"], t["lat"])
        if not key:
            continue
        # The fix carries the train's local UTC offset, so its hour is local time of day.
        try:
            period = datetime.fromisoformat(fix).hour // PERIOD_HOURS
        except ValueError:
            continue
        total = day.setdefault(f"{key}@{period}", [0.0, 0])
        total[0] = round(total[0] + mph, 2)
        total[1] += 1
        added += 1

    day_path.write_text(json.dumps(day, separators=(",", ":"), sort_keys=True))
    state_path.write_text(json.dumps(seen, separators=(",", ":"), sort_keys=True))

    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    for old in (data / "daily").glob("*.json"):
        if old.stem < cutoff:
            old.unlink()

    print(f"{added} samples added from {len(trains)} trains -> {day_path.name} ({len(day)} segment periods)")


if __name__ == "__main__":
    main()
