"""Average the last 30 days of samples into a GeoJSON of track segments coloured by speed.

Usage: python3 scripts/speed/build.py DATA_DIR OUT.geojson
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from segments import Segments

WINDOW_DAYS = 30
MIN_SAMPLES = 3  # hide segments with too few observations to mean anything


def main():
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    cutoff = (datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
    days = sorted(p for p in (data / "daily").glob("*.json") if p.stem >= cutoff)

    totals = {}
    for p in days:
        for key, (mph, n) in json.loads(p.read_text()).items():
            t = totals.setdefault(key, [0.0, 0])
            t[0] += mph
            t[1] += n

    segments = Segments()
    features = [
        {
            "type": "Feature",
            "properties": {"mph": round(mph / n, 1), "samples": n},
            "geometry": {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in segments.geometry[key]]},
        }
        for key, (mph, n) in totals.items()
        if n >= MIN_SAMPLES and key in segments.geometry
    ]
    meta = {"days": len(days), "from": days[0].stem if days else None, "to": days[-1].stem if days else None, "generated": datetime.now(timezone.utc).isoformat(timespec="minutes")}
    out.write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": features}, separators=(",", ":")))
    print(f"{len(features)} segments from {len(days)} days -> {out}")


if __name__ == "__main__":
    main()
