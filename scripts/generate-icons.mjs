// Generates build/icon.png (512x512) and a multi-resolution build/icon.ico for electron-builder.
// Pure Node: PNG is deflate-compressed RGBA drawn with supersampling; the ICO wraps PNG frames.
// Run: npm run icons
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "build");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// --- geometry ---------------------------------------------------------------------------------

function roundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function onRing(u, v, cx, cy, r, w) {
  return Math.abs(Math.hypot(u - cx, v - cy) - r) <= w / 2;
}

// Butt caps: only points that project inside the segment count.
function onSegment(u, v, x0, y0, x1, y1, w) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy);
  if (t < 0 || t > 1) return false;
  return Math.hypot(u - (x0 + t * dx), v - (y0 + t * dy)) <= w / 2;
}

// First-order distance to a rotated ellipse (|f| / |grad f|); exact enough for a thin stroke.
function onEllipse(u, v, cx, cy, a, b, degrees, w) {
  const angle = (degrees * Math.PI) / 180;
  const dx = u - cx;
  const dy = v - cy;
  const lu = Math.cos(angle) * dx + Math.sin(angle) * dy;
  const lv = -Math.sin(angle) * dx + Math.cos(angle) * dy;
  const f = (lu / a) ** 2 + (lv / b) ** 2 - 1;
  const grad = Math.hypot((2 * lu) / (a * a), (2 * lv) / (b * b));
  return Math.abs(f) / grad <= w / 2;
}

// --- drawing ----------------------------------------------------------------------------------

// "Armillary A": a celestial sphere whose meridians form an A and whose tilted ecliptic band is
// the crossbar. Brass and verdigris on deep green. Geometry is in the 100-unit space of
// build/icon.svg; keep the two in sync.
const TILE = { r: 0x1e, g: 0x3a, b: 0x33, a: 1 };
const BRASS = { r: 0xc9, g: 0xa1, b: 0x5a, a: 1 };
const VERDIGRIS = { r: 0x7c, g: 0xc2, b: 0xab, a: 1 };

// Taskbar sizes get a larger mark and heavier strokes, or the hairlines vanish.
function opticalSize(N) {
  if (N <= 16) return { scale: 0.86, weight: 2 };
  if (N <= 24) return { scale: 0.84, weight: 1.7 };
  if (N <= 32) return { scale: 0.82, weight: 1.4 };
  if (N <= 48) return { scale: 0.78, weight: 1.15 };
  return { scale: 0.73, weight: 1 };
}

function sample(x, y, N) {
  if (!roundedRect(x, y, 0, 0, N, N, 0.22 * N)) return { r: 0, g: 0, b: 0, a: 0 };
  const { scale, weight } = opticalSize(N);
  const u = ((x / N - (1 - scale) / 2) / scale) * 100;
  const v = ((y / N - (1 - scale) / 2) / scale) * 100;
  if (onEllipse(u, v, 50, 58, 40, 10, -14, 3.5 * weight)) return VERDIGRIS;
  if (onRing(u, v, 50, 50, 40, 5 * weight)) return BRASS;
  if (onSegment(u, v, 50, 10, 30, 84.6, 5 * weight)) return BRASS;
  if (onSegment(u, v, 50, 10, 70, 84.6, 5 * weight)) return BRASS;
  return TILE;
}

function render(size) {
  const N = size;
  const S = N <= 32 ? 6 : 4; // more supersampling where it matters most
  const pixels = Buffer.alloc(N * N * 4);

  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const c = sample(x + (sx + 0.5) / S, y + (sy + 0.5) / S, N);
          ar += c.r * c.a;
          ag += c.g * c.a;
          ab += c.b * c.a;
          aa += c.a;
        }
      }
      const index = (y * N + x) * 4;
      const alpha = aa / (S * S);
      pixels[index] = aa > 0 ? Math.round(ar / aa) : 0;
      pixels[index + 1] = aa > 0 ? Math.round(ag / aa) : 0;
      pixels[index + 2] = aa > 0 ? Math.round(ab / aa) : 0;
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(N, N, pixels);
}

function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = Buffer.alloc(16 * frames.length);
  let offset = 6 + 16 * frames.length;
  frames.forEach((frame, i) => {
    const at = i * 16;
    entries[at] = frame.size >= 256 ? 0 : frame.size;
    entries[at + 1] = frame.size >= 256 ? 0 : frame.size;
    entries[at + 2] = 0;
    entries[at + 3] = 0;
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(frame.png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += frame.png.length;
  });
  return Buffer.concat([header, entries, ...frames.map((frame) => frame.png)]);
}

mkdirSync(OUT_DIR, { recursive: true });
const png512 = render(512);
writeFileSync(join(OUT_DIR, "icon.png"), png512);
const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: render(size) })));
writeFileSync(join(OUT_DIR, "icon.ico"), ico);
console.log(
  `Wrote build/icon.png (${png512.length} bytes) and build/icon.ico (${ico.length} bytes, ${ICO_SIZES.length} sizes)`
);
