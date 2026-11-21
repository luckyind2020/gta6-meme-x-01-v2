// gta6-meme-x-01 v2 — deterministic meme compositor.
// Rebuilds out/meme.png from the bundled assets, byte-identically, every run.
// Node 22, standard library only. No network, no clock, no files outside the repo.
//
// The joke: GTA 6's rumoured $100 price tag vs an AI agent that already
// earned that money on make.fun. Setup on top, punchline at the bottom,
// make.fun's ghost badge eclipsing the Vice City sun in the middle.
//
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
//   -> out/meme.png (1024x1024), out/POST.json (copy of the repo's POST.json)

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- PNG codec

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

interface RgbaImage {
  w: number;
  h: number;
  data: Buffer; // w*h*4, RGBA, row-major
}

// Decode an 8-bit, non-interlaced PNG of colour type 2 (RGB) or 6 (RGBA).
function decodePng(buf: Buffer): RgbaImage {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("not a PNG file");
  }
  let pos = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const data = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`unknown PNG filter ${filter}`);
      }
      row[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp; // row is one scanline: index within the row only
      const d = (y * w + x) * 4;
      data[d] = row[s];
      data[d + 1] = row[s + 1];
      data[d + 2] = row[s + 2];
      data[d + 3] = bpp === 4 ? row[s + 3] : 255;
    }
    prev = row;
  }
  return { w, h, data };
}

// Encode an RGBA image as an 8-bit RGB PNG, one filter-0 row at a time.
// Fixed zlib level, no ancillary chunks: the output is byte-identical per input.
function encodePng(img: RgbaImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc(img.h * (1 + img.w * 3));
  for (let y = 0; y < img.h; y++) {
    const ro = y * (1 + img.w * 3);
    raw[ro] = 0; // filter: none
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4;
      const d = ro + 1 + x * 3;
      raw[d] = img.data[s];
      raw[d + 1] = img.data[s + 1];
      raw[d + 2] = img.data[s + 2];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ raster

function blank(w: number, h: number): RgbaImage {
  return { w, h, data: Buffer.alloc(w * h * 4) };
}

function setPixel(img: RgbaImage, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const o = (y * img.w + x) * 4;
  img.data[o] = r;
  img.data[o + 1] = g;
  img.data[o + 2] = b;
  img.data[o + 3] = a;
}

function fillRect(img: RgbaImage, x0: number, y0: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(img, x, y, r, g, b, 255);
  }
}

function fillDisc(img: RgbaImage, cx: number, cy: number, rad: number, r: number, g: number, b: number): void {
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= rad * rad) setPixel(img, x, y, r, g, b, 255);
    }
  }
}

// Centre-crop to a square, then nearest-neighbour scale to tw x th.
function cropSquareScale(src: RgbaImage, tw: number, th: number): RgbaImage {
  const side = Math.min(src.w, src.h);
  const ox = (src.w - side) >> 1;
  const oy = (src.h - side) >> 1;
  const out = blank(tw, th);
  for (let y = 0; y < th; y++) {
    const sy = oy + Math.floor((y * side) / th);
    for (let x = 0; x < tw; x++) {
      const sx = ox + Math.floor((x * side) / tw);
      const s = (sy * src.w + sx) * 4;
      const d = (y * tw + x) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

// Nearest-neighbour scale of an RGBA image (keeps its alpha channel).
function scaleImage(src: RgbaImage, tw: number, th: number): RgbaImage {
  const out = blank(tw, th);
  for (let y = 0; y < th; y++) {
    const sy = Math.floor((y * src.h) / th);
    for (let x = 0; x < tw; x++) {
      const sx = Math.floor((x * src.w) / tw);
      const s = (sy * src.w + sx) * 4;
      const d = (y * tw + x) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}

// Alpha-composite src over dst at (dx, dy).
function pasteOver(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.w) continue;
      const s = (y * src.w + x) * 4;
      const a = src.data[s + 3] / 255;
      if (a === 0) continue;
      const d = (ty * dst.w + tx) * 4;
      if (a === 1) {
        dst.data[d] = src.data[s];
        dst.data[d + 1] = src.data[s + 1];
        dst.data[d + 2] = src.data[s + 2];
      } else {
        dst.data[d] = Math.round(src.data[s] * a + dst.data[d] * (1 - a));
        dst.data[d + 1] = Math.round(src.data[s + 1] * a + dst.data[d + 1] * (1 - a));
        dst.data[d + 2] = Math.round(src.data[s + 2] * a + dst.data[d + 2] * (1 - a));
      }
      dst.data[d + 3] = 255;
    }
  }
}

// ------------------------------------------------------------- bitmap font
// A 5x7 pixel font, drawn from rows of "#" (on) and "." (off). Uppercase,
// digits and the punctuation this meme needs. One advance = 6 font pixels.

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
};

const FONT_W = 5;
const FONT_H = 7;
const ADVANCE = 6; // 5 glyph columns + 1 blank column

function textUnits(text: string): number {
  return text.length * ADVANCE - 1;
}

function drawGlyphRow(
  img: RgbaImage,
  glyph: string[],
  x0: number,
  y0: number,
  scale: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let row = 0; row < FONT_H; row++) {
    for (let col = 0; col < FONT_W; col++) {
      if (glyph[row][col] !== "1") continue;
      fillRect(img, x0 + col * scale, y0 + row * scale, scale, scale, r, g, b);
    }
  }
}

// Draw one line of text centred on cx, top edge at y. A thick outline is
// drawn first (8 neighbour passes), then the fill, so the letters read on
// any background.
function drawTextLine(
  img: RgbaImage,
  text: string,
  cx: number,
  y: number,
  scale: number,
  fill: [number, number, number],
  outline: [number, number, number],
): void {
  const width = textUnits(text) * scale;
  const x0 = Math.round(cx - width / 2);
  const o = Math.max(1, Math.round(scale * 0.18));
  const passes: Array<[number, number, [number, number, number]]> = [];
  for (const [dx, dy] of [
    [-o, -o],
    [0, -o],
    [o, -o],
    [-o, 0],
    [o, 0],
    [-o, o],
    [0, o],
    [o, o],
  ] as Array<[number, number]>) {
    passes.push([dx, dy, outline]);
  }
  passes.push([0, 0, fill]);
  for (const [dx, dy, color] of passes) {
    let cx0 = x0 + dx;
    for (const ch of text) {
      const glyph = FONT[ch] ?? FONT["?"];
      drawGlyphRow(img, glyph, cx0, y + dy, scale, color[0], color[1], color[2]);
      cx0 += ADVANCE * scale;
    }
  }
}

// Largest integer scale that fits the text inside maxWidth, capped.
function fitScale(text: string, maxWidth: number, maxScale: number): number {
  return Math.max(1, Math.min(maxScale, Math.floor(maxWidth / textUnits(text))));
}

// ------------------------------------------------------------------ layout

const CANVAS = 1024;
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];
const MAGENTA: [number, number, number] = [196, 28, 131]; // make.fun #C41C83

// Setup: two lines, big, across the sunset sky.
const SETUP = ["GTA 6 MIGHT", "COST $100"];
// Punchline: two lines, across the dark wet road.
const PUNCHLINE = ["MY AGENT ALREADY", "EARNED IT ON MAKE.FUN"];

function compose(bg: RgbaImage, mark: RgbaImage): RgbaImage {
  const img = cropSquareScale(bg, CANVAS, CANVAS);

  // Setup block, top.
  const setupScale = Math.min(...SETUP.map((line) => fitScale(line, 944, 13)));
  let y = 48;
  for (const line of SETUP) {
    drawTextLine(img, line, CANVAS / 2, y, setupScale, WHITE, BLACK);
    y += FONT_H * setupScale + 14;
  }

  // Ghost badge: a magenta disc eclipsing the sun, official ghost on top.
  const badgeR = 132;
  const badgeCx = CANVAS / 2;
  const badgeCy = 452;
  fillDisc(img, badgeCx, badgeCy, badgeR, MAGENTA[0], MAGENTA[1], MAGENTA[2]);
  const ghost = scaleImage(mark, badgeR * 2, badgeR * 2);
  pasteOver(img, ghost, badgeCx - badgeR, badgeCy - badgeR);

  // Punchline block, bottom: its last line ends 56px above the edge.
  const punchScale = Math.min(...PUNCHLINE.map((line) => fitScale(line, 944, 11)));
  const blockH = PUNCHLINE.length * FONT_H * punchScale + (PUNCHLINE.length - 1) * 14;
  let py = CANVAS - 56 - blockH;
  for (const line of PUNCHLINE) {
    drawTextLine(img, line, CANVAS / 2, py, punchScale, WHITE, BLACK);
    py += FONT_H * punchScale + 14;
  }
  return img;
}

// -------------------------------------------------------------------- main

function main(): void {
  const botDir = process.env.MAKEFUN_BOT_DIR ?? ".";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  const assetsDir = path.join(botDir, "assets");

  const bg = decodePng(fs.readFileSync(path.join(assetsDir, "background.png")));
  const mark = decodePng(fs.readFileSync(path.join(assetsDir, "mark-1024.png")));
  const meme = compose(bg, mark);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "meme.png"), encodePng(meme));

  const postRaw = fs.readFileSync(path.join(botDir, "POST.json"), "utf8");
  const post = JSON.parse(postRaw) as { url: string };
  fs.writeFileSync(path.join(outDir, "POST.json"), JSON.stringify(post, null, 2) + "\n");

  console.log(`meme.png written: ${CANVAS}x${CANVAS}`);
  console.log(`post: ${post.url}`);
}

main();
