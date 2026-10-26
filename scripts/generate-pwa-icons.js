import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outputDirectory = resolve(fileURLToPath(new URL('../public/icons/', import.meta.url)));
const crcTable = new Uint32Array(256);

for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function coverage(distance, width, softness) {
  return Math.max(0, Math.min(1, (width / 2 + softness / 2 - distance) / softness));
}

function distanceToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const along = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - x1 - along * dx, y - y1 - along * dy);
}

function paint(buffer, offset, color, opacity) {
  if (opacity <= 0) return;
  const alpha = opacity + buffer[offset + 3] / 255 * (1 - opacity);
  for (let channel = 0; channel < 3; channel += 1) {
    buffer[offset + channel] = Math.round((color[channel] * opacity + buffer[offset + channel] * buffer[offset + 3] / 255 * (1 - opacity)) / alpha);
  }
  buffer[offset + 3] = Math.round(alpha * 255);
}

function createIcon(size) {
  const rowLength = 1 + size * 4;
  const pixels = Buffer.alloc(rowLength * size);
  const antialias = 1.1 / size;
  const lines = [
    [-0.12, -0.115, 0.12, -0.115],
    [0.075, -0.115, 0.075, 0.065],
    [0.075, 0.065, 0.045, 0.12],
    [0.045, 0.12, -0.06, 0.12],
    [-0.06, 0.12, -0.12, 0.075],
  ];

  for (let py = 0; py < size; py += 1) {
    const rowOffset = py * rowLength;
    pixels[rowOffset] = 0;
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) / size - 0.5;
      const y = (py + 0.5) / size - 0.5;
      const distance = Math.hypot(x, y);
      const offset = rowOffset + 1 + px * 4;
      paint(pixels, offset, [5, 10, 23], 1);

      const glow = Math.max(0, 1 - distance / 0.48) ** 2 * 0.22;
      paint(pixels, offset, [20, 100, 213], glow);
      paint(pixels, offset, [65, 152, 255], coverage(Math.abs(distance - 0.34), 0.004, antialias) * 0.36);
      paint(pixels, offset, [100, 214, 255], coverage(Math.abs(distance - 0.27), 0.009, antialias) * 0.82);
      if (distance <= 0.2) paint(pixels, offset, [12, 32, 64], 1);
      paint(pixels, offset, [137, 220, 255], coverage(Math.abs(distance - 0.2), 0.004, antialias) * 0.9);

      for (const [x1, y1, x2, y2] of lines) {
        const lineCoverage = coverage(distanceToSegment(x, y, x1, y1, x2, y2), 0.042, antialias);
        paint(pixels, offset, [220, 247, 255], lineCoverage);
      }
      const underline = coverage(distanceToSegment(x, y, -0.085, 0.173, 0.085, 0.173), 0.006, antialias);
      paint(pixels, offset, [82, 186, 255], underline);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outputDirectory, { recursive: true });
for (const size of [192, 512]) {
  const outputPath = resolve(outputDirectory, `jarvis-${size}.png`);
  await writeFile(outputPath, createIcon(size));
  console.log(`Generated ${outputPath}`);
}