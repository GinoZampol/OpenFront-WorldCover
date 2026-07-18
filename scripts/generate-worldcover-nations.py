#!/usr/bin/env python3
"""Place WorldCover nation bots at national-capital coordinates.

Capital latitude/longitude is projected through the same equirectangular crop
used by generate-worldcover-map.py. A projected point is moved only when the
capital pixel is water (or already occupied), and only to the closest unique
tile that remains playable at every selectable WorldCover resolution.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np


REFERENCE_WIDTH = 6400
REFERENCE_HEIGHT = 2576
DEFAULT_CROP_TOP = 0.035
DEFAULT_CROP_BOTTOM = 0.16

# Recognizable anchors for prominent countries. Remaining countries receive a
# stable color from the curated palette below, so their identity never changes
# between games or map resolutions.
COUNTRY_COLORS = {
    "Argentina": "#5996C8",
    "Australia": "#405F9E",
    "Brazil": "#3F8654",
    "Canada": "#B64A4A",
    "China": "#B73D45",
    "Colombia": "#C4973B",
    "Egypt": "#B18A45",
    "Finland": "#4678A8",
    "France": "#486FA8",
    "Germany": "#B48C3C",
    "India": "#C27B3C",
    "Indonesia": "#AD4A4F",
    "Iran": "#3E8077",
    "Italy": "#4C865D",
    "Japan": "#B34855",
    "Mexico": "#4B8058",
    "Netherlands": "#C16D3D",
    "New Zealand": "#4B6599",
    "Nigeria": "#4A8756",
    "Norway": "#A84952",
    "Pakistan": "#477A54",
    "Poland": "#B65C70",
    "Russia": "#91485D",
    "Saudi Arabia": "#4A7E56",
    "South Africa": "#4F8059",
    "Spain": "#C3923F",
    "Sweden": "#4D78A5",
    "Turkey": "#AC4850",
    "Ukraine": "#527DAA",
    "United Kingdom": "#405F91",
    "United States": "#315B9A",
}

COUNTRY_COLOR_PALETTE = (
    "#5D719A",
    "#A65357",
    "#52805F",
    "#B18445",
    "#745F96",
    "#4D8188",
    "#A05D7B",
    "#718044",
    "#956548",
    "#557DA4",
    "#895660",
    "#4F7B72",
    "#AD7046",
    "#626B94",
    "#70884E",
    "#9B536B",
    "#4B7894",
    "#8D7044",
    "#61806B",
    "#795E8D",
    "#9F5D47",
    "#59808A",
    "#7B884D",
    "#9B5054",
)


def country_color(name: str) -> str:
    explicit = COUNTRY_COLORS.get(name)
    if explicit is not None:
        return explicit
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    palette_index = int.from_bytes(digest[:2], "big") % len(
        COUNTRY_COLOR_PALETTE
    )
    return COUNTRY_COLOR_PALETTE[palette_index]


def load_land_mask(path: Path, width: int, height: int) -> np.ndarray:
    data = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    expected = width * height
    if data.size != expected:
        raise ValueError(f"{path} has {data.size} bytes; expected {expected}")
    packed = data.reshape((height, width))
    return ((packed & 0x80) != 0) & ((packed & 0x1F) != 31)


def project_capital(
    latitude: float,
    longitude: float,
    crop_top: float,
    crop_bottom: float,
) -> tuple[int, int]:
    """Project WGS84 coordinates into the cropped 6400x2576 reference map."""
    retained = 1 - crop_top - crop_bottom
    x = round(((longitude + 180) / 360) * REFERENCE_WIDTH)
    source_y_fraction = (90 - latitude) / 180
    y = round(
        ((source_y_fraction - crop_top) / retained) * REFERENCE_HEIGHT
    )
    return x % REFERENCE_WIDTH, min(max(y, 0), REFERENCE_HEIGHT - 1)


def valid_at_every_size(
    x: int,
    y: int,
    masks: list[np.ndarray],
) -> bool:
    for mask in masks:
        height, width = mask.shape
        # TerrainMapLoader uses the width ratio for both axes. The 10K asset is
        # one row shorter than a mathematically exact scale, so mirror the game
        # rather than independently scaling Y by the height ratio.
        coordinate_scale = width / REFERENCE_WIDTH
        scaled_x = math.floor(x * coordinate_scale)
        scaled_y = math.floor(y * coordinate_scale)
        if scaled_y >= height:
            return False
        if not mask[scaled_y, scaled_x]:
            return False
    return True


def search_offsets(max_radius: int) -> list[tuple[int, int, int]]:
    offsets = [
        (dx * dx + dy * dy, dx, dy)
        for dy in range(-max_radius, max_radius + 1)
        for dx in range(-max_radius, max_radius + 1)
        if dx * dx + dy * dy <= max_radius * max_radius
    ]
    offsets.sort(key=lambda item: (item[0], abs(item[2]), abs(item[1])))
    return offsets


def nearest_available_land(
    projected_x: int,
    projected_y: int,
    masks: list[np.ndarray],
    used: set[tuple[int, int]],
    offsets: list[tuple[int, int, int]],
) -> tuple[int, int, float] | None:
    for distance_squared, dx, dy in offsets:
        y = projected_y + dy
        if y < 0 or y >= REFERENCE_HEIGHT:
            continue
        x = (projected_x + dx) % REFERENCE_WIDTH
        if (x, y) in used:
            continue
        if valid_at_every_size(x, y, masks):
            return x, y, math.sqrt(distance_squared)
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--capitals",
        type=Path,
        default=Path("scripts/worldcover-capitals.json"),
    )
    parser.add_argument(
        "--info",
        type=Path,
        default=Path("map-generator/assets/maps/worldcover/info.json"),
    )
    parser.add_argument(
        "--resources",
        type=Path,
        default=Path("resources/maps/worldcover"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("scripts/worldcover-capital-spawn-report.json"),
    )
    parser.add_argument("--crop-top", type=float, default=DEFAULT_CROP_TOP)
    parser.add_argument("--crop-bottom", type=float, default=DEFAULT_CROP_BOTTOM)
    parser.add_argument(
        "--max-snap-pixels",
        type=int,
        default=9,
        help="maximum reference-map distance from a capital (default: 9)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    manifest_path = args.resources / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    expected_reference = manifest["map"]
    if (expected_reference["width"], expected_reference["height"]) != (
        REFERENCE_WIDTH,
        REFERENCE_HEIGHT,
    ):
        raise ValueError("WorldCover reference dimensions changed")

    variants = [
        ("map4x", "map4x.bin"),
        ("map", "map.bin"),
        ("map8k", "map8k.bin"),
        ("map10k", "map10k.bin"),
    ]
    masks: list[np.ndarray] = []
    for metadata_key, filename in variants:
        metadata = manifest[metadata_key]
        masks.append(
            load_land_mask(
                args.resources / filename,
                metadata["width"],
                metadata["height"],
            )
        )

    capital_data = json.loads(args.capitals.read_text())
    offsets = search_offsets(args.max_snap_pixels)
    used: set[tuple[int, int]] = set()
    nations: list[dict[str, object]] = []
    report: list[dict[str, object]] = []
    excluded: list[dict[str, object]] = []

    for country in capital_data["countries"]:
        projected_x, projected_y = project_capital(
            country["latitude"],
            country["longitude"],
            args.crop_top,
            args.crop_bottom,
        )
        placement = nearest_available_land(
            projected_x, projected_y, masks, used, offsets
        )
        if placement is None:
            excluded.append(
                {
                    "name": country["name"],
                    "capital": country["capital"],
                    "projected": [projected_x, projected_y],
                }
            )
            continue

        x, y, snap_pixels = placement
        used.add((x, y))
        nations.append(
            {
                "coordinates": [x, y],
                "name": country["name"],
                "flag": country["flag"],
                "color": country_color(country["name"]),
            }
        )
        report.append(
            {
                "name": country["name"],
                "flag": country["flag"],
                "capital": country["capital"],
                "latitude": country["latitude"],
                "longitude": country["longitude"],
                "projected": [projected_x, projected_y],
                "coordinates": [x, y],
                "snap_pixels": round(snap_pixels, 2),
            }
        )

    output_report = {
        "source": capital_data.get("source"),
        "crop_top": args.crop_top,
        "crop_bottom": args.crop_bottom,
        "max_snap_pixels": args.max_snap_pixels,
        "placed": len(nations),
        "excluded": excluded,
        "countries": report,
    }

    if not args.dry_run:
        info = json.loads(args.info.read_text())
        info["coordinate_reference_size"] = [REFERENCE_WIDTH, REFERENCE_HEIGHT]
        info["nations"] = nations
        args.info.write_text(json.dumps(info, indent=2, ensure_ascii=False) + "\n")
        manifest["nations"] = nations
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
        )
        args.report.write_text(
            json.dumps(output_report, indent=2, ensure_ascii=False) + "\n"
        )

    snap_distances = [entry["snap_pixels"] for entry in report]
    print(
        f"placed {len(nations)}/{len(capital_data['countries'])} capitals; "
        f"excluded {len(excluded)}"
    )
    if snap_distances:
        print(
            f"snap pixels: max={max(snap_distances):.2f}, "
            f"mean={sum(snap_distances) / len(snap_distances):.2f}, "
            f"exact={sum(distance == 0 for distance in snap_distances)}"
        )
    if excluded:
        print("excluded: " + ", ".join(entry["name"] for entry in excluded))


if __name__ == "__main__":
    main()
