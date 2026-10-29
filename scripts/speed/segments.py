"""Cut the GTFS route shapes into fixed-length track segments shared by every route.

Overlapping routes (e.g. Acela and Northeast Regional) have separate shapes over the same
track, so each bin is keyed by its rounded midpoint and coarse direction; bins from different
shapes that land on the same key are treated as one segment.
"""

import json
import math
from bisect import bisect_left, bisect_right
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIN_M = 1000  # segment length along the track
KEY_DEG = 0.01  # ~1 km grid for merging overlapping shapes
MAX_OFF_TRACK_M = 1000

M_PER_DEG_LAT = 110_540
M_PER_DEG_LON = 111_320


def _cumulative(coords):
    cum = [0.0]
    for (ax, ay), (bx, by) in zip(coords, coords[1:]):
        kx = math.cos(math.radians((ay + by) / 2)) * M_PER_DEG_LON
        cum.append(cum[-1] + math.hypot((bx - ax) * kx, (by - ay) * M_PER_DEG_LAT))
    return cum


def _point_at(coords, cum, along):
    i = min(max(1, bisect_left(cum, along)), len(cum) - 1)
    seg = cum[i] - cum[i - 1] or 1e-9
    u = min(1.0, max(0.0, (along - cum[i - 1]) / seg))
    (ax, ay), (bx, by) = coords[i - 1], coords[i]
    return ax + u * (bx - ax), ay + u * (by - ay)


def _slice(coords, cum, lo, hi):
    inner = coords[bisect_right(cum, lo) : bisect_left(cum, hi)]
    return [_point_at(coords, cum, lo), *map(tuple, inner), _point_at(coords, cum, hi)]


def _key(line):
    (ax, ay), (bx, by) = line[0], line[-1]
    cum = _cumulative(line)
    mx, my = _point_at(line, cum, cum[-1] / 2)
    # Direction-agnostic bearing in 45° buckets so parallel tracks in one cell stay apart.
    bearing = math.degrees(math.atan2((bx - ax) * math.cos(math.radians(my)), by - ay)) % 180
    return f"{round(mx / KEY_DEG)}:{round(my / KEY_DEG)}:{int(bearing // 45)}"


class Segments:
    def __init__(self, routes_path=ROOT / "data" / "routes.geojson", shapes_path=ROOT / "data" / "train-shapes.json"):
        routes = json.loads(Path(routes_path).read_text())
        self.train_shapes = json.loads(Path(shapes_path).read_text())
        self.shapes = {}  # shape id -> (coords, cum, [segment key per bin])
        self.geometry = {}  # segment key -> [[lon, lat], ...]
        for f in sorted(routes["features"], key=lambda f: f["properties"]["shape"]):
            coords = f["geometry"]["coordinates"]
            cum = _cumulative(coords)
            keys = []
            for i in range(max(1, math.ceil(cum[-1] / BIN_M))):
                line = _slice(coords, cum, i * BIN_M, min(cum[-1], (i + 1) * BIN_M))
                key = _key(line)
                self.geometry.setdefault(key, line)
                keys.append(key)
            self.shapes[f["properties"]["shape"]] = (coords, cum, keys)

    def locate(self, train_num, lon, lat):
        """Segment key for a train's position on its own route, or None if it is off its track."""
        shape = self.shapes.get(self.train_shapes.get(train_num))
        if not shape:
            return None
        coords, cum, keys = shape
        kx = math.cos(math.radians(lat)) * M_PER_DEG_LON
        best_off, best_along = math.inf, 0.0
        for i in range(len(coords) - 1):
            (ax, ay), (bx, by) = coords[i], coords[i + 1]
            dx, dy = (bx - ax) * kx, (by - ay) * M_PER_DEG_LAT
            px, py = (lon - ax) * kx, (lat - ay) * M_PER_DEG_LAT
            len2 = dx * dx + dy * dy
            u = max(0.0, min(1.0, (px * dx + py * dy) / len2)) if len2 else 0.0
            off = math.hypot(px - u * dx, py - u * dy)
            if off < best_off:
                best_off, best_along = off, cum[i] + u * (cum[i + 1] - cum[i])
        if best_off > MAX_OFF_TRACK_M:
            return None
        return keys[min(len(keys) - 1, int(best_along // BIN_M))]
