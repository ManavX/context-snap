/**
 * Generates minimal valid PNG icons for the Chrome extension.
 * No dependencies required — writes raw PNG binary.
 *
 * For production, replace these with properly designed icons.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, colorFn) {
  // Create raw RGBA pixel data
  const rawData = Buffer.alloc(height * (1 + width * 4)); // filter byte + RGBA per pixel

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // No filter

    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = colorFn(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(rawData);

  // Build PNG file
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT chunk
  const idat = makeChunk('IDAT', compressed);

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Icon drawing function — purple gradient with a white layers icon
function drawIcon(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;

  // Check if pixel is within rounded rect
  const margin = 0.05;
  const radius = 0.18;

  // Simple rounded rect check
  const inRect = isInRoundedRect(nx, ny, margin, margin, 1 - margin * 2, 1 - margin * 2, radius);

  if (!inRect) return [0, 0, 0, 0];

  // Gradient: purple top-left to deeper purple bottom-right
  const r = Math.round(108 - nx * 30);
  const g = Math.round(92 - nx * 20);
  const b = Math.round(231 - nx * 40);

  // Draw white "stacked layers" icon in the center
  const cx = 0.5, cy = 0.5;
  const bw = 0.35, bh = 0.25;

  // Front layer border
  if (isOnRectBorder(nx, ny, cx - bw/2, cy - bh/2, bw, bh, 0.04)) {
    return [255, 255, 255, 255];
  }

  // Middle layer border (offset up-right)
  if (isOnRectBorder(nx, ny, cx - bw/2 + 0.04, cy - bh/2 - 0.04, bw, bh, 0.03)) {
    return [255, 255, 255, 160];
  }

  // Back layer border (offset more)
  if (isOnRectBorder(nx, ny, cx - bw/2 + 0.08, cy - bh/2 - 0.08, bw, bh, 0.03)) {
    return [255, 255, 255, 90];
  }

  // Small yellow dot (bookmark indicator)
  const dotCx = cx + bw/2 - 0.02;
  const dotCy = cy - bh/2 + 0.02;
  const dotR = 0.04;
  const dist = Math.sqrt((nx - dotCx) ** 2 + (ny - dotCy) ** 2);
  if (dist < dotR) {
    return [253, 203, 110, 255];
  }

  return [r, g, b, 255];
}

function isInRoundedRect(px, py, rx, ry, rw, rh, radius) {
  if (px < rx || px > rx + rw || py < ry || py > ry + rh) return false;

  // Check corners
  const corners = [
    [rx + radius, ry + radius],
    [rx + rw - radius, ry + radius],
    [rx + radius, ry + rh - radius],
    [rx + rw - radius, ry + rh - radius],
  ];

  for (const [cx, cy] of corners) {
    const isInCornerZone =
      (px < rx + radius || px > rx + rw - radius) &&
      (py < ry + radius || py > ry + rh - radius);

    if (isInCornerZone) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist > radius) return false;
    }
  }

  return true;
}

function isOnRectBorder(px, py, rx, ry, rw, rh, thickness) {
  const inOuter = px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
  const inInner = px >= rx + thickness && px <= rx + rw - thickness &&
                  py >= ry + thickness && py <= ry + rh - thickness;
  return inOuter && !inInner;
}

// Generate icons
const iconsDir = path.join(__dirname, '..', 'assets', 'icons');

for (const size of [16, 48, 128]) {
  const png = createPNG(size, size, drawIcon);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
}

console.log('Done!');
