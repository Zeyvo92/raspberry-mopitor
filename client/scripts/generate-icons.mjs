/**
 * Renders the favicon artwork into the PNG sizes a web app manifest needs.
 * Run with `node scripts/generate-icons.mjs` after changing public/favicon.svg
 * — the shapes below mirror it, there is no SVG rasteriser in the toolchain.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

/** the favicon's own geometry, in its 32x32 viewBox */
const BACKGROUND = "#18181b";
const STROKE = "#0eaa78";
const RADIUS = 7;
const STROKE_WIDTH = 2.6;
const LINE = [
  [4, 19],
  [9, 19],
  [12, 11],
  [16, 23],
  [19, 14],
  [21.5, 19],
  [28, 19],
];

/** 4x4 supersampling: enough to make round caps and the corner radius clean */
const SAMPLES = 4;

const hex = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** signed-distance test for the rounded square, in viewBox units */
function insideBackground(x, y) {
  const dx = Math.abs(x - 16) - (16 - RADIUS);
  const dy = Math.abs(y - 16) - (16 - RADIUS);
  if (dx <= 0 || dy <= 0) return Math.max(dx, dy) <= 0;
  return Math.hypot(dx, dy) <= RADIUS;
}

function onLine(x, y) {
  for (let i = 0; i < LINE.length - 1; i++) {
    if (distanceToSegment(x, y, LINE[i], LINE[i + 1]) <= STROKE_WIDTH / 2) return true;
  }
  return false;
}

function render(size) {
  const [br, bg, bb] = hex(BACKGROUND);
  const [sr, sg, sb] = hex(STROKE);
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let background = 0;
      let stroke = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 32;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 32;
          if (!insideBackground(x, y)) continue;
          background++;
          if (onLine(x, y)) stroke++;
        }
      }

      const total = SAMPLES * SAMPLES;
      const alpha = background / total;
      const strokeShare = background === 0 ? 0 : stroke / background;
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(br + (sr - br) * strokeShare);
      pixels[offset + 1] = Math.round(bg + (sg - bg) * strokeShare);
      pixels[offset + 2] = Math.round(bb + (sb - bb) * strokeShare);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  // scanlines, each prefixed with filter type 0 (none)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
