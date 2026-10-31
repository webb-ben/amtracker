"""Average the last 30 days of samples into a GeoJSON of track segments coloured by speed.

Each segment gets its all-day average (`mph`, `samples`) plus one per 4-hour slice of the day
(`mph0`..`mph5`, `samples0`..`samples5`, local time; see collect.py), each only where it has
enough samples to mean anything.

Usage: python3 scripts/speed/build.py DATA_DIR OUT.geojson
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from segments import Segments

WINDOW_DAYS = 30
MIN_SAMPLES = 3  # hide segments with too few observations to mean anything
PERIODS = 6


def main():
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    cutoff = (datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
    days = sorted(p for p in (data / "daily").glob("*.json") if p.stem >= cutoff)

    totals = {}  # segment -> [mph_sum, samples]
    by_period = {}  # (segment, period) -> [mph_sum, samples]
    for p in days:
        for key, (mph, n) in json.loads(p.read_text()).items():
            segment, _, period = key.partition("@")
            targets = [totals.setdefault(segment, [0.0, 0])]
            if period:  # older files have bare segment keys: all-day only
                targets.append(by_period.setdefault((segment, period), [0.0, 0]))
            for t in targets:
                t[0] += mph
                t[1] += n

    segments = Segments()
    features = []
    for key, (mph, n) in totals.items():
        if n < MIN_SAMPLES or key not in segments.geometry:
            continue
        props = {"mph": round(mph / n, 1), "samples": n}
        for period in range(PERIODS):
            pm, pn = by_period.get((key, str(period)), (0, 0))
            if pn >= MIN_SAMPLES:
                props[f"mph{period}"] = round(pm / pn, 1)
                props[f"samples{period}"] = pn
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in segments.geometry[key]]},
            }
        )
    meta = {"periods": PERIODS, "days": len(days), "from": days[0].stem if days else None, "to": days[-1].stem if days else None, "generated": datetime.now(timezone.utc).isoformat(timespec="minutes")}
    out.write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": features}, separators=(",", ":")))
    print(f"{len(features)} segments from {len(days)} days -> {out}")


if __name__ == "__main__":
    main()
