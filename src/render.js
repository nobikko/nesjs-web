let fs = null;
if (typeof require !== 'undefined') {
  try {
    fs = require('node:fs');
  } catch (_err) {
    fs = null;
  }
}

const NES_PALETTE = [
  [0x80,0x80,0x80], [0x00,0x3D,0xA6], [0x00,0x12,0xB0], [0x44,0x00,0x96],
  [0xA1,0x00,0x5E], [0xC7,0x00,0x28], [0xBA,0x06,0x00], [0x8C,0x17,0x00],
  [0x5C,0x2F,0x00], [0x10,0x45,0x00], [0x05,0x4A,0x00], [0x00,0x47,0x2E],
  [0x00,0x41,0x66], [0x00,0x00,0x00], [0x05,0x05,0x05], [0x05,0x05,0x05],
  [0xC7,0xC7,0xC7], [0x00,0x77,0xFF], [0x21,0x55,0xFF], [0x82,0x37,0xFA],
  [0xEB,0x2F,0xB5], [0xFF,0x29,0x50], [0xFF,0x22,0x00], [0xD6,0x32,0x00],
  [0xC4,0x62,0x00], [0x35,0x80,0x00], [0x05,0x8F,0x00], [0x00,0x8A,0x55],
  [0x00,0x99,0xCC], [0x21,0x21,0x21], [0x09,0x09,0x09], [0x09,0x09,0x09],
  [0xFF,0xFF,0xFF], [0x0F,0xD7,0xFF], [0x69,0xA2,0xFF], [0xD4,0x80,0xFF],
  [0xFF,0x45,0xF3], [0xFF,0x61,0x8B], [0xFF,0x88,0x33], [0xFF,0x9C,0x12],
  [0xFA,0xBC,0x20], [0x9F,0xE3,0x0E], [0x2B,0xF0,0x35], [0x0C,0xF0,0xA4],
  [0x05,0xFB,0xFF], [0x5E,0x5E,0x5E], [0x0D,0x0D,0x0D], [0x0D,0x0D,0x0D],
  [0xFF,0xFF,0xFF], [0xA6,0xFC,0xFF], [0xB3,0xEC,0xFF], [0xDA,0xAB,0xEB],
  [0xFF,0xA8,0xF9], [0xFF,0xAB,0xB3], [0xFF,0xD2,0xB0], [0xFF,0xEF,0xA6],
  [0xFF,0xF7,0x9C], [0xD7,0xE8,0x95], [0xA6,0xED,0xAF], [0xA2,0xF2,0xDA],
  [0x99,0xFF,0xFC], [0xDD,0xDD,0xDD], [0x11,0x11,0x11], [0x11,0x11,0x11],
];

const NES_PALETTE_RGB = new Uint8Array(NES_PALETTE.length * 3);
const NES_PALETTE_RGBA = new Uint8Array(NES_PALETTE.length * 4);
const NES_PALETTE_RGBA_U32 = new Uint32Array(NES_PALETTE.length);
const RENDER_IS_LITTLE_ENDIAN = (() => {
  const bytes = new Uint8Array(4);
  const u32 = new Uint32Array(bytes.buffer);
  u32[0] = 0x01020304;
  return bytes[0] === 0x04;
})();
let renderCachedImageDataBuffer = null;
let renderCachedImageDataOffset = -1;
let renderCachedPixelCount = -1;
let renderCachedImageDataU32 = null;
for (let i = 0; i < NES_PALETTE.length; i += 1) {
  const base3 = i * 3;
  const base4 = i * 4;
  const rgb = NES_PALETTE[i];
  const r = rgb[0] & 0xff;
  const g = rgb[1] & 0xff;
  const b = rgb[2] & 0xff;
  NES_PALETTE_RGB[base3] = r;
  NES_PALETTE_RGB[base3 + 1] = g;
  NES_PALETTE_RGB[base3 + 2] = b;
  NES_PALETTE_RGBA[base4] = r;
  NES_PALETTE_RGBA[base4 + 1] = g;
  NES_PALETTE_RGBA[base4 + 2] = b;
  NES_PALETTE_RGBA[base4 + 3] = 255;
  if (RENDER_IS_LITTLE_ENDIAN) {
    NES_PALETTE_RGBA_U32[i] = (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
  } else {
    NES_PALETTE_RGBA_U32[i] = ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
  }
}

function getCachedImageDataU32(dst, pixelCount) {
  if (!RENDER_IS_LITTLE_ENDIAN) return null;
  if ((dst.byteOffset & 3) !== 0) return null;
  if ((dst.byteLength >>> 2) < pixelCount) return null;
  if (
    renderCachedImageDataBuffer === dst.buffer &&
    renderCachedImageDataOffset === dst.byteOffset &&
    renderCachedPixelCount === pixelCount &&
    renderCachedImageDataU32
  ) {
    return renderCachedImageDataU32;
  }
  renderCachedImageDataBuffer = dst.buffer;
  renderCachedImageDataOffset = dst.byteOffset;
  renderCachedPixelCount = pixelCount;
  renderCachedImageDataU32 = new Uint32Array(dst.buffer, dst.byteOffset, pixelCount);
  return renderCachedImageDataU32;
}

function setPixel(frame, x, y, colorIndex) {
  const [r, g, b] = NES_PALETTE[colorIndex % NES_PALETTE.length];
  const o = (y * frame.width + x) * 3;
  frame.rgb[o] = r;
  frame.rgb[o + 1] = g;
  frame.rgb[o + 2] = b;
}

function renderFrameRgb(nes, outFrame = null) {
  const ppu = nes.ppuState;
  const width = 256;
  const height = 240;
  const pixelCount = width * height;
  let frame = outFrame;
  if (
    !frame ||
    frame.width !== width ||
    frame.height !== height ||
    !(frame.rgb instanceof Uint8Array) ||
    frame.rgb.length !== (pixelCount * 3)
  ) {
    frame = {
      width,
      height,
      rgb: new Uint8Array(pixelCount * 3),
    };
  }
  const dst = frame.rgb;
  if (ppu.frameColor && ppu.frameColor.length === pixelCount) {
    const src = ppu.frameColor;
    let di = 0;
    for (let i = 0; i < pixelCount; i += 1) {
      const pi = (src[i] & 0x3f) * 3;
      dst[di] = NES_PALETTE_RGB[pi];
      dst[di + 1] = NES_PALETTE_RGB[pi + 1];
      dst[di + 2] = NES_PALETTE_RGB[pi + 2];
      di += 3;
    }
    return frame;
  }

  // Fallback before first rendered frame is available.
  const backdrop = (nes.palette && nes.palette.length > 0) ? (nes.palette[0] & 0x3f) : 0x0f;
  const pb = (backdrop % NES_PALETTE.length) * 3;
  const br = NES_PALETTE_RGB[pb];
  const bg = NES_PALETTE_RGB[pb + 1];
  const bb = NES_PALETTE_RGB[pb + 2];
  for (let i = 0, di = 0; i < pixelCount; i += 1) {
    dst[di] = br;
    dst[di + 1] = bg;
    dst[di + 2] = bb;
    di += 3;
  }

  return frame;
}

function blitRgbToImageData(frame, imageData) {
  const src = frame.rgb;
  const dst = imageData.data;
  let si = 0;
  let di = 0;
  const pixelCount = frame.width * frame.height;
  for (let i = 0; i < pixelCount; i += 1) {
    dst[di] = src[si];
    dst[di + 1] = src[si + 1];
    dst[di + 2] = src[si + 2];
    dst[di + 3] = 255;
    si += 3;
    di += 4;
  }
}

function blitFrameColorToImageData(frameColor, imageData, backdropColorIndex = 0x0f) {
  if (!imageData || !imageData.data) return;
  const dst = imageData.data;
  const width = imageData.width | 0;
  const height = imageData.height | 0;
  const pixelCount = ((width > 0 && height > 0) ? (width * height) : (256 * 240)) | 0;
  const dstU32 = getCachedImageDataU32(dst, pixelCount);
  if (frameColor && frameColor.length === pixelCount) {
    if (dstU32) {
      for (let i = 0; i < pixelCount; i += 1) {
        dstU32[i] = NES_PALETTE_RGBA_U32[frameColor[i] & 0x3f];
      }
      return;
    }
    let di = 0;
    for (let i = 0; i < pixelCount; i += 1) {
      const pi = (frameColor[i] & 0x3f) << 2;
      dst[di] = NES_PALETTE_RGBA[pi];
      dst[di + 1] = NES_PALETTE_RGBA[pi + 1];
      dst[di + 2] = NES_PALETTE_RGBA[pi + 2];
      dst[di + 3] = 255;
      di += 4;
    }
    return;
  }

  const pb = (backdropColorIndex & 0x3f) << 2;
  if (dstU32) {
    const packed = NES_PALETTE_RGBA_U32[pb >>> 2];
    for (let i = 0; i < pixelCount; i += 1) {
      dstU32[i] = packed;
    }
    return;
  }
  const br = NES_PALETTE_RGBA[pb];
  const bg = NES_PALETTE_RGBA[pb + 1];
  const bb = NES_PALETTE_RGBA[pb + 2];
  for (let i = 0, di = 0; i < pixelCount; i += 1) {
    dst[di] = br;
    dst[di + 1] = bg;
    dst[di + 2] = bb;
    dst[di + 3] = 255;
    di += 4;
  }
}

function writePPM(filePath, frame) {
  if (!fs) throw new Error('writePPM is only available in Node.js');
  const header = Buffer.from(`P6\n${frame.width} ${frame.height}\n255\n`, 'ascii');
  const body = Buffer.from(frame.rgb.buffer, frame.rgb.byteOffset, frame.rgb.byteLength);
  fs.writeFileSync(filePath, Buffer.concat([header, body]));
}

function writeBMP(filePath, frame) {
  if (!fs) throw new Error('writeBMP is only available in Node.js');
  const rowStride = Math.ceil((frame.width * 3) / 4) * 4;
  const pixelArraySize = rowStride * frame.height;
  const fileSize = 54 + pixelArraySize;
  const out = Buffer.alloc(fileSize);

  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(fileSize, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(frame.width, 18);
  out.writeInt32LE(frame.height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(0, 30);
  out.writeUInt32LE(pixelArraySize, 34);

  let dst = 54;
  for (let y = frame.height - 1; y >= 0; y -= 1) {
    const rowStart = y * frame.width * 3;
    for (let x = 0; x < frame.width; x += 1) {
      const src = rowStart + x * 3;
      out[dst++] = frame.rgb[src + 2];
      out[dst++] = frame.rgb[src + 1];
      out[dst++] = frame.rgb[src];
    }
    while ((dst - 54) % rowStride !== 0) out[dst++] = 0;
  }

  fs.writeFileSync(filePath, out);
}

const renderExports = {
  NES_PALETTE_RGB,
  NES_PALETTE_RGBA,
  renderFrameRgb,
  blitRgbToImageData,
  blitFrameColorToImageData,
  writePPM,
  writeBMP,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = renderExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreRender = renderExports;
}
