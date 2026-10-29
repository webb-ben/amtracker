"""Build Amtrak route geometry from the official GTFS feed.

Writes:
  data/routes.geojson     one LineString per rail shape (actual track geometry)
  data/train-shapes.json  train number -> shape_id, used to highlight a train's route

Usage: python3 scripts/build_routes.py [path/to/GTFS.zip]
Stdlib only; downloads the feed when no path is given.
"""

import csv
import io
import json
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

GTFS_URL = "https://content.amtrak.com/content/gtfs/GTFS.zip"
OUT = Path(__file__).resolve().parent.parent / "data"
TOLERANCE = 0.00015  # degrees (~15 m); Douglas-Peucker simplification
PRECISION = 5


def read_csv(zf, name):
    with zf.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def simplify(points, tol):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
        best, idx = 0.0, None
        for i in range(a + 1, b):
            x, y = points[i]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def main():
    if len(sys.argv) > 1:
        data = Path(sys.argv[1]).read_bytes()
    else:
        req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "amtracker-build"})
        data = urllib.request.urlopen(req).read()
    zf = zipfile.ZipFile(io.BytesIO(data))

    # route_type 2 = rail; skip Thruway buses
    routes = {r["route_id"]: r for r in read_csv(zf, "routes.txt") if r["route_type"] == "2"}

    shape_route = {}
    train_shapes = defaultdict(Counter)
    for t in read_csv(zf, "trips.txt"):
        if t["route_id"] not in routes or not t["shape_id"]:
            continue
        shape_route[t["shape_id"]] = t["route_id"]
        if t["trip_short_name"]:
            train_shapes[t["trip_short_name"]][t["shape_id"]] += 1

    pts = defaultdict(list)
    for s in read_csv(zf, "shapes.txt"):
        if s["shape_id"] in shape_route:
            pts[s["shape_id"]].append((int(s["shape_pt_sequence"]), float(s["shape_pt_lon"]), float(s["shape_pt_lat"])))

    features = []
    for shape_id, seq in pts.items():
        seq.sort()
        line = simplify([(x, y) for _, x, y in seq], TOLERANCE)
        route = routes[shape_route[shape_id]]
        features.append(
            {
                "type": "Feature",
                "properties": {"shape": shape_id, "route": route["route_long_name"], "color": "#" + (route["route_color"] or "2f5bc4")},
                "geometry": {"type": "LineString", "coordinates": [[round(x, PRECISION), round(y, PRECISION)] for x, y in line]},
            }
        )

    OUT.mkdir(exist_ok=True)
    (OUT / "routes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    mapping = {num: c.most_common(1)[0][0] for num, c in train_shapes.items()}
    (OUT / "train-shapes.json").write_text(json.dumps(mapping, separators=(",", ":"), sort_keys=True))
    print(f"{len(features)} shapes, {len(mapping)} train numbers -> {OUT}")


if __name__ == "__main__":
    main()
