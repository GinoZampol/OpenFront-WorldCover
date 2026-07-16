#!/usr/bin/env python3
"""Convert the ESA WorldCover RGB preview into an OpenFront terrain source.

The OpenFront map generator reads the blue channel. Exact blue magnitudes are
reserved here for WorldCover classes; black/no-data and ESA permanent water
both become OpenFront's explicit water key (blue=106).
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


WORLDCOVER_TO_OPENFRONT = {
    (250, 0, 0): (250, 0, 140),       # Built-up -> magnitude 0, plains
    (240, 150, 255): (240, 150, 142), # Cropland -> magnitude 1, plains
    (255, 255, 76): (255, 255, 144),  # Grassland -> magnitude 2, plains
    (255, 187, 34): (255, 187, 146),  # Shrubland -> magnitude 3, plains
    (0, 150, 160): (0, 150, 148),     # Herbaceous wetland -> magnitude 4
    (0, 207, 117): (0, 207, 148),     # Mangroves -> merged wet class, magnitude 4
    (250, 230, 160): (250, 230, 148), # Moss/lichen -> merged wet class, magnitude 4
    (0, 100, 0): (0, 100, 160),       # Tree cover -> magnitude 10, highland/hill
    (180, 180, 180): (180, 180, 182), # Bare/sparse -> magnitude 21, mountain
    (240, 240, 240): (240, 240, 184), # Snow/ice -> magnitude 22, mountain
    (0, 100, 200): (0, 0, 106),       # Permanent water -> water
    (0, 0, 0): (0, 0, 106),           # Preview ocean/no-data -> water
}

CLASS_NAMES = {
    (250, 0, 0): "built_up",
    (240, 150, 255): "cropland",
    (255, 255, 76): "grassland",
    (255, 187, 34): "shrubland",
    (0, 150, 160): "herbaceous_wetland",
    (0, 207, 117): "mangroves",
    (250, 230, 160): "moss_lichen",
    (0, 100, 0): "tree_cover",
    (180, 180, 180): "bare_sparse",
    (240, 240, 240): "snow_ice",
    (0, 100, 200): "permanent_water",
    (0, 0, 0): "ocean_no_data",
}

LAND_CLASS_COLORS = tuple(
    color
    for color in WORLDCOVER_TO_OPENFRONT
    if color not in {(0, 100, 200), (0, 0, 0)}
)
WATER_CLASS_COLORS = ((0, 100, 200), (0, 0, 0))


def parse_size(value: str) -> tuple[int, int]:
    try:
        width, height = (int(part) for part in value.lower().split("x", 1))
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("size must look like 2048x1024") from exc
    if width <= 0 or height <= 0 or width % 4 or height % 4:
        raise argparse.ArgumentTypeError("dimensions must be positive multiples of 4")
    return width, height


def parse_crop_fraction(value: str) -> float:
    try:
        fraction = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("crop must be a decimal fraction") from exc
    if fraction < 0 or fraction >= 1:
        raise argparse.ArgumentTypeError("crop must be at least 0 and less than 1")
    return fraction


def resize_categorical(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Area-resample class labels without inventing blended RGB colors.

    Each destination pixel receives the class covering the largest fraction of
    its source footprint. Permanent water and black ocean/no-data vote as one
    water class so coastlines are not biased merely because water has two RGB
    labels. If the input already has the requested size this is a pixel-exact
    copy.
    """
    if source.size == size:
        return source.copy()

    pixels = np.asarray(source, dtype=np.uint8)
    out_width, out_height = size
    best_coverage = np.zeros((out_height, out_width), dtype=np.uint8)
    best_class = np.zeros((out_height, out_width), dtype=np.uint8)
    class_colors = ((0, 0, 0),) + LAND_CLASS_COLORS

    source_water = np.zeros(pixels.shape[:2], dtype=bool)
    for color in WATER_CLASS_COLORS:
        source_water |= np.all(pixels == color, axis=2)

    for class_index, color in enumerate(class_colors):
        if class_index == 0:
            mask = source_water
        else:
            mask = np.all(pixels == color, axis=2)
        coverage = np.asarray(
            Image.fromarray(mask.astype(np.uint8) * 255, mode="L").resize(
                size, Image.Resampling.BOX
            ),
            dtype=np.uint8,
        )
        replace = coverage > best_coverage
        best_coverage[replace] = coverage[replace]
        best_class[replace] = class_index

    palette = np.asarray(class_colors, dtype=np.uint8)
    return Image.fromarray(palette[best_class], mode="RGB")


def fill_tiny_enclosed_water(
    magnitude: np.ndarray, max_component_size: int = 2
) -> tuple[int, int]:
    """Fill only enclosed 1–2 pixel water components with surrounding land.

    Eight-connected component labeling preserves even diagonally connected
    coastlines. Components touching the image boundary are never filled. The
    replacement is the local 8-neighbor
    majority land class; ties prefer whichever tied class is more common across
    the whole map, avoiding an arbitrary bias toward low magnitude IDs such as
    built-up land.
    """
    if max_component_size <= 0:
        return 0, 0

    water = magnitude < 0
    structure = ndimage.generate_binary_structure(2, 2)
    labels, count = ndimage.label(water, structure)
    if count == 0:
        return 0, 0

    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    border_labels = np.unique(
        np.concatenate(
            (labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1])
        )
    )
    eligible = (sizes > 0) & (sizes <= max_component_size)
    eligible[0] = False
    eligible[border_labels] = False
    tiny_mask = water & eligible[labels]
    coordinates = np.argwhere(tiny_mask)
    if coordinates.size == 0:
        return 0, 0

    components: dict[int, list[tuple[int, int]]] = {}
    for y, x in coordinates:
        components.setdefault(int(labels[y, x]), []).append((int(y), int(x)))

    land_values = magnitude[magnitude >= 0]
    global_counts = np.bincount(land_values, minlength=31)
    height, width = magnitude.shape
    filled_pixels = 0
    for points in components.values():
        neighbor_values: list[int] = []
        for y, x in points:
            y0, y1 = max(0, y - 1), min(height, y + 2)
            x0, x1 = max(0, x - 1), min(width, x + 2)
            window = magnitude[y0:y1, x0:x1]
            neighbor_values.extend(int(value) for value in window[window >= 0])
        if not neighbor_values:
            continue

        local_counts = np.bincount(neighbor_values, minlength=31)
        candidates = np.flatnonzero(local_counts == local_counts.max())
        replacement = int(candidates[np.argmax(global_counts[candidates])])
        for y, x in points:
            magnitude[y, x] = replacement
            filled_pixels += 1

    return filled_pixels, len(components)


def clean_and_pack(magnitude: np.ndarray, remove_small: bool) -> tuple[bytes, int]:
    """Apply OpenFront's connected-area rules and pack one terrain scale."""
    land = magnitude >= 0
    structure = ndimage.generate_binary_structure(2, 1)
    if remove_small:
        labels, count = ndimage.label(land, structure)
        sizes = np.bincount(labels.ravel(), minlength=count + 1)
        land[sizes[labels] < 30] = False
        magnitude[~land] = -1

    water = ~land
    labels, count = ndimage.label(water, structure)
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    ocean_label = int(np.argmax(sizes[1:]) + 1) if count else 0
    if remove_small and count:
        small_lakes = (labels != ocean_label) & (sizes[labels] < 200)
        land[small_lakes] = True
        magnitude[small_lakes] = 0
        water = ~land
        labels, count = ndimage.label(water, structure)
        sizes = np.bincount(labels.ravel(), minlength=count + 1)
        ocean_label = int(np.argmax(sizes[1:]) + 1) if count else 0

    adjacent_water = land & ndimage.binary_dilation(water, structure)
    adjacent_land = water & ndimage.binary_dilation(land, structure)
    shoreline = adjacent_water | adjacent_land
    distance = ndimage.distance_transform_cdt(water, metric="taxicab")
    water_magnitude = np.clip(np.ceil(np.maximum(distance - 1, 0) / 2), 0, 31)

    packed = np.zeros(magnitude.shape, dtype=np.uint8)
    packed[land] = 0x80 | np.clip(magnitude[land], 0, 30).astype(np.uint8)
    packed[shoreline] |= 0x40
    packed[(labels == ocean_label) & water] |= 0x20
    packed[water] |= water_magnitude[water].astype(np.uint8)
    return packed.tobytes(order="C"), int(land.sum())


def downsample(magnitude: np.ndarray) -> np.ndarray:
    """Match OpenFront's water-wins 2x2 minimap rule."""
    height, width = magnitude.shape
    blocks = magnitude.reshape(height // 2, 2, width // 2, 2)
    result = blocks[:, 1, :, 1].copy()
    result[np.any(blocks < 0, axis=(1, 3))] = -1
    return result


def build_game_assets(
    converted: Image.Image,
    thumbnail_source: Image.Image,
    output_root: Path,
    info_path: Path,
) -> None:
    pixels = np.asarray(converted, dtype=np.uint8)
    blue = pixels[:, :, 2]
    magnitude = np.where(blue == 106, -1, (blue.astype(np.int16) - 140) // 2)

    filled_water_pixels, filled_water_components = fill_tiny_enclosed_water(
        magnitude, 2
    )

    full = magnitude.copy()
    # Preserve every classified full-resolution tile. The old conversion used
    # OpenFront cleanup thresholds that deleted small islands and filled small
    # lakes, visibly changing the supplied map.
    map_bin, full_land = clean_and_pack(full, remove_small=False)
    mini4 = downsample(full)
    map4_bin, mini4_land = clean_and_pack(mini4, remove_small=True)
    mini16 = downsample(mini4)
    map16_bin, mini16_land = clean_and_pack(mini16, remove_small=False)

    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "map.bin").write_bytes(map_bin)
    (output_root / "map4x.bin").write_bytes(map4_bin)
    (output_root / "map16x.bin").write_bytes(map16_bin)

    info = json.loads(info_path.read_text())
    width, height = converted.size
    reference_width, reference_height = info.pop(
        "coordinate_reference_size", [width, height]
    )
    for nation in info.get("nations", []):
        if "coordinates" not in nation:
            continue
        x, y = nation["coordinates"]
        nation["coordinates"] = [
            round(x * width / reference_width),
            round(y * height / reference_height),
        ]
    info["map"] = {"width": width, "height": height, "num_land_tiles": full_land}
    info["map4x"] = {
        "width": width // 2,
        "height": height // 2,
        "num_land_tiles": mini4_land,
    }
    info["map16x"] = {
        "width": width // 4,
        "height": height // 4,
        "num_land_tiles": mini16_land,
    }
    info["tiny_water_cleanup"] = {
        "max_component_size": 2,
        "components_filled": filled_water_components,
        "pixels_filled": filled_water_pixels,
    }
    (output_root / "manifest.json").write_text(json.dumps(info, indent=2) + "\n")

    # Keep the recognizable WorldCover classes in the picker thumbnail.
    thumbnail = thumbnail_source.resize(
        (width // 4, height // 4), Image.Resampling.NEAREST
    )
    thumbnail.save(output_root / "thumbnail.webp", "WEBP", quality=82, method=6)
    print(
        "game assets: "
        f"full={full_land:,}, map4x={mini4_land:,}, map16x={mini16_land:,} land tiles"
    )
    print(
        "tiny enclosed water cleanup: "
        f"components={filled_water_components:,}, pixels={filled_water_pixels:,}"
    )


def build_scaled_game_assets(
    converted: Image.Image,
    output_root: Path,
    size_name: str,
) -> dict[str, object]:
    """Build an optional high-resolution playfield and half-size minimap."""
    pixels = np.asarray(converted, dtype=np.uint8)
    blue = pixels[:, :, 2]
    magnitude = np.where(blue == 106, -1, (blue.astype(np.int16) - 140) // 2)

    filled_water_pixels, filled_water_components = fill_tiny_enclosed_water(
        magnitude, 2
    )
    full = magnitude.copy()
    map_bin, full_land = clean_and_pack(full, remove_small=False)
    mini4 = downsample(full)
    map4_bin, mini4_land = clean_and_pack(mini4, remove_small=True)

    output_root.mkdir(parents=True, exist_ok=True)
    map_key = f"map{size_name}"
    mini_map_key = f"map{size_name}4x"
    (output_root / f"{map_key}.bin").write_bytes(map_bin)
    (output_root / f"{mini_map_key}.bin").write_bytes(map4_bin)

    width, height = converted.size
    print(
        f"{size_name} game assets: "
        f"full={full_land:,}, map4x={mini4_land:,} land tiles"
    )
    return {
        map_key: {
            "width": width,
            "height": height,
            "num_land_tiles": full_land,
        },
        mini_map_key: {
            "width": width // 2,
            "height": height // 2,
            "num_land_tiles": mini4_land,
        },
        f"tiny_water_cleanup_{size_name}": {
            "max_component_size": 2,
            "components_filled": filled_water_components,
            "pixels_filled": filled_water_pixels,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="ESA RGB preview TIFF")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("map-generator/assets/maps/worldcover/image.png"),
    )
    parser.add_argument("--size", type=parse_size, default=(6400, 2576))
    parser.add_argument(
        "--large-size",
        type=parse_size,
        default=(8000, 3220),
        help="optional large playfield dimensions (default: 8000x3220)",
    )
    parser.add_argument(
        "--maximum-size",
        type=parse_size,
        default=(10000, 4024),
        help="maximum local playfield dimensions (default: 10000x4024)",
    )
    parser.add_argument(
        "--crop-top",
        type=parse_crop_fraction,
        default=0.035,
        help="fraction removed from the top before resizing (default: 0.035)",
    )
    parser.add_argument(
        "--crop-bottom",
        type=parse_crop_fraction,
        default=0.16,
        help="fraction removed from the bottom before resizing (default: 0.16)",
    )
    parser.add_argument(
        "--resources",
        type=Path,
        default=Path("resources/maps/worldcover"),
        help="generated OpenFront map output directory",
    )
    parser.add_argument(
        "--info",
        type=Path,
        default=Path("map-generator/assets/maps/worldcover/info.json"),
    )
    args = parser.parse_args()
    if args.crop_top + args.crop_bottom >= 1:
        parser.error("top and bottom crop fractions must total less than 1")

    with Image.open(args.input) as source:
        rgb = source.convert("RGB")
        source_counts = Counter(rgb.getdata())
        unknown = set(source_counts) - set(WORLDCOVER_TO_OPENFRONT)
        if unknown:
            raise SystemExit(f"unrecognized WorldCover colors: {sorted(unknown)}")
        crop_top_px = round(rgb.height * args.crop_top)
        crop_bottom_px = round(rgb.height * args.crop_bottom)
        cropped = rgb.crop((0, crop_top_px, rgb.width, rgb.height - crop_bottom_px))
        resized = resize_categorical(cropped, args.size)

    converted = Image.new("RGB", resized.size)
    converted.putdata([WORLDCOVER_TO_OPENFRONT[pixel] for pixel in resized.getdata()])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    converted.save(args.output, optimize=True)
    build_game_assets(converted, resized, args.resources, args.info)

    large_resized = resize_categorical(cropped, args.large_size)
    large_converted = Image.new("RGB", large_resized.size)
    large_converted.putdata(
        [WORLDCOVER_TO_OPENFRONT[pixel] for pixel in large_resized.getdata()]
    )
    large_metadata = build_scaled_game_assets(
        large_converted, args.resources, "8k"
    )

    maximum_resized = resize_categorical(cropped, args.maximum_size)
    maximum_converted = Image.new("RGB", maximum_resized.size)
    maximum_converted.putdata(
        [WORLDCOVER_TO_OPENFRONT[pixel] for pixel in maximum_resized.getdata()]
    )
    maximum_metadata = build_scaled_game_assets(
        maximum_converted, args.resources, "10k"
    )
    manifest_path = args.resources / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.update(large_metadata)
    manifest.update(maximum_metadata)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    built = source_counts[(250, 0, 0)]
    crop = source_counts[(240, 150, 255)]
    built_density = 4_000_000_000 / built
    crop_density = 4_000_000_000 / crop
    print(f"wrote {args.output} ({args.size[0]}x{args.size[1]})")
    print(
        "source crop: "
        f"top={crop_top_px}px ({args.crop_top:.1%}), "
        f"bottom={crop_bottom_px}px ({args.crop_bottom:.1%}), "
        f"retained={cropped.width}x{cropped.height}"
    )
    print(
        "equal-population density: "
        f"built={built_density:,.0f}/pixel, crop={crop_density:,.0f}/pixel, "
        f"ratio={built_density / crop_density:.2f}:1"
    )
    for color, count in source_counts.most_common():
        print(f"{CLASS_NAMES[color]:22s} {count:>10,d}")


if __name__ == "__main__":
    main()
