"use strict";

const dom = {
  refsInput: document.getElementById("refsInput"),
  targetsInput: document.getElementById("targetsInput"),
  folderInput: document.getElementById("folderInput"),
  pickRefsBtn: document.getElementById("pickRefsBtn"),
  pickTargetsBtn: document.getElementById("pickTargetsBtn"),
  pickFolderBtn: document.getElementById("pickFolderBtn"),
  clearRefsBtn: document.getElementById("clearRefsBtn"),
  clearTargetsBtn: document.getElementById("clearTargetsBtn"),
  refsList: document.getElementById("refsList"),
  targetsList: document.getElementById("targetsList"),
  modeSelect: document.getElementById("modeSelect"),
  strengthRange: document.getElementById("strengthRange"),
  strengthValue: document.getElementById("strengthValue"),
  localRange: document.getElementById("localRange"),
  localValue: document.getElementById("localValue"),
  skinProtectInput: document.getElementById("skinProtectInput"),
  sizeSelect: document.getElementById("sizeSelect"),
  formatSelect: document.getElementById("formatSelect"),
  qualityRange: document.getElementById("qualityRange"),
  qualityValue: document.getElementById("qualityValue"),
  statusLine: document.getElementById("statusLine"),
  progressBar: document.getElementById("progressBar"),
  processBtn: document.getElementById("processBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  downloadAllBtn: document.getElementById("downloadAllBtn"),
  copyParamsBtn: document.getElementById("copyParamsBtn"),
  pasteParamsBtn: document.getElementById("pasteParamsBtn"),
  syncParamsBtn: document.getElementById("syncParamsBtn"),
  refPreview: document.getElementById("refPreview"),
  targetPreview: document.getElementById("targetPreview"),
  resultCanvas: document.getElementById("resultCanvas"),
  refThumbs: document.getElementById("refThumbs"),
  targetThumbs: document.getElementById("targetThumbs"),
  resultThumbs: document.getElementById("resultThumbs"),
  refEmpty: document.getElementById("refEmpty"),
  targetEmpty: document.getElementById("targetEmpty"),
  resultEmpty: document.getElementById("resultEmpty"),
};

const state = {
  references: [],
  targets: [],
  outputs: [],
  activeOutput: null,
  activeRefIndex: 0,
  activeTargetIndex: 0,
  activeOutputIndex: -1,
  targetParams: [],
  copiedParams: null,
  previewUrls: {
    ref: null,
    target: null,
  },
  thumbUrls: {
    refs: [],
    targets: [],
  },
  busy: false,
};

const MAX_ANALYZE_SAMPLES = 320000;
const MAX_REFERENCE_EDGE = 1800;
const CHUNK_PIXELS = 70000;
const RAW_EXTENSIONS = new Set(["arw", "orf", "rw2", "raf", "cr2", "cr3", "nef", "dng", "srw", "pef", "3fr", "rwl"]);
const DECODE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "heic", "heif"]);
const HSL_CHANNELS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const HSL_CENTERS = {
  red: 0,
  orange: 30 / 360,
  yellow: 58 / 360,
  green: 120 / 360,
  aqua: 170 / 360,
  blue: 220 / 360,
  purple: 272 / 360,
  magenta: 318 / 360,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fileExtension(file) {
  const name = file?.name || "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isRawFile(file) {
  return RAW_EXTENSIONS.has(fileExtension(file));
}

function canBrowserDecode(file) {
  if (!file) return false;
  if (isRawFile(file)) return false;
  const ext = fileExtension(file);
  return file.type.startsWith("image/") || DECODE_EXTENSIONS.has(ext);
}

function defaultHsl() {
  const hsl = {};
  for (const channel of HSL_CHANNELS) {
    hsl[channel] = { h: 0, s: 0, l: 0 };
  }
  return hsl;
}

function defaultParams() {
  return {
    mode: "normal",
    strength: 1,
    localStrength: 0.45,
    skinProtect: true,
    adjustments: {
      temperature: 0,
      tint: 0,
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      vibrance: 0,
      saturation: 0,
    },
    hsl: defaultHsl(),
  };
}

function ensureTargetParams() {
  while (state.targetParams.length < state.targets.length) {
    state.targetParams.push(defaultParams());
  }
  if (state.targetParams.length > state.targets.length) {
    state.targetParams.length = state.targets.length;
  }
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function mix(a, b, t) {
  return a * (1 - t) + b * t;
}

function luma(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function rgbToHsv(r, g, b) {
  const maxValue = Math.max(r, g, b);
  const minValue = Math.min(r, g, b);
  const delta = maxValue - minValue;
  let h = 0;
  if (delta > 0.00001) {
    if (maxValue === r) h = ((g - b) / delta) % 6;
    else if (maxValue === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = maxValue <= 0 ? 0 : delta / maxValue;
  return { h, s, v: maxValue };
}

function hsvToRgb(h, s, v) {
  const wrapped = ((h % 1) + 1) % 1;
  const i = Math.floor(wrapped * 6);
  const f = wrapped * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function modeParams(mode) {
  if (mode === "deep") return { toneWeight: 0.58, colorWeight: 0.46, satWeight: 0.34, hueWeight: 0.22, maxToneDelta: 0.15, maxColorRatio: 1.14, baseLocalWeight: 0.24 };
  if (mode === "strong") return { toneWeight: 0.50, colorWeight: 0.38, satWeight: 0.28, hueWeight: 0.18, maxToneDelta: 0.13, maxColorRatio: 1.12, baseLocalWeight: 0.20 };
  if (mode === "soft") return { toneWeight: 0.32, colorWeight: 0.22, satWeight: 0.18, hueWeight: 0.10, maxToneDelta: 0.09, maxColorRatio: 1.08, baseLocalWeight: 0.12 };
  return { toneWeight: 0.42, colorWeight: 0.30, satWeight: 0.22, hueWeight: 0.14, maxToneDelta: 0.11, maxColorRatio: 1.10, baseLocalWeight: 0.16 };
}

function fitRgbToLuma(r, g, b, targetY) {
  const y = luma(r, g, b);
  const deltas = [r - y, g - y, b - y];
  let scale = 1;
  for (const delta of deltas) {
    const value = targetY + delta;
    if (value > 1 && delta > 0) scale = Math.min(scale, (1 - targetY) / Math.max(0.000001, delta));
    if (value < 0 && delta < 0) scale = Math.min(scale, targetY / Math.max(0.000001, -delta));
  }
  scale = clamp01(scale);
  return [
    clamp01(targetY + deltas[0] * scale),
    clamp01(targetY + deltas[1] * scale),
    clamp01(targetY + deltas[2] * scale),
  ];
}

function scaleChroma(r, g, b, targetY, scale) {
  const y = luma(r, g, b);
  return fitRgbToLuma(y + (r - y) * scale, y + (g - y) * scale, y + (b - y) * scale, targetY);
}

function softSkinConfidence(r, g, b, hsv, y) {
  const hd = hsv.h * 360;
  const hueMask = smoothstep(5, 16, hd) * (1 - smoothstep(62, 82, hd));
  const satMask = smoothstep(0.035, 0.12, hsv.s) * (1 - smoothstep(0.70, 0.90, hsv.s));
  const lumaMask = smoothstep(0.10, 0.22, y) * (1 - smoothstep(0.90, 0.99, y));
  const rb = smoothstep(-0.005, 0.14, r - b);
  const gb = smoothstep(-0.06, 0.12, g - b);
  const rg = 1 - smoothstep(0.24, 0.44, Math.abs(r - g));
  return clamp(Math.pow(Math.max(0, hueMask * satMask * lumaMask * rb * gb * rg), 0.45), 0, 1);
}

function isLikelySkin(r, g, b, hsv, y) {
  const hd = hsv.h * 360;
  return y > 0.18 && y < 0.88 && hsv.s > 0.08 && hsv.s < 0.68 && hd >= 12 && hd <= 58 && r > g * 0.92 && g > b * 0.72;
}

function redAccentConfidence(hsv, y) {
  const hd = hsv.h * 360;
  const redWrap = Math.min(hd, 360 - hd);
  const trueRed = 1 - smoothstep(10, 28, redWrap);
  const coral = smoothstep(8, 18, hd) * (1 - smoothstep(38, 52, hd));
  const magenta = smoothstep(342, 350, hd) * (1 - smoothstep(358, 360, hd)) * 0.58;
  const hueMask = clamp(Math.max(trueRed, coral, magenta), 0, 1);
  const satMask = smoothstep(0.22, 0.52, hsv.s);
  const lumaMask = smoothstep(0.06, 0.16, y) * (1 - smoothstep(0.93, 0.99, y));
  return clamp(Math.pow(Math.max(0, hueMask * satMask * lumaMask), 0.58), 0, 1);
}

function warmColorConfidence(hsv, y) {
  const hd = hsv.h * 360;
  const redWrap = Math.min(hd, 360 - hd);
  const red = 1 - smoothstep(16, 38, redWrap);
  const orange = smoothstep(12, 24, hd) * (1 - smoothstep(50, 72, hd));
  const magenta = smoothstep(334, 346, hd) * (1 - smoothstep(358, 360, hd));
  const hueMask = clamp(Math.max(red, orange, magenta), 0, 1);
  const satMask = smoothstep(0.14, 0.46, hsv.s);
  const lumaMask = smoothstep(0.04, 0.16, y) * (1 - smoothstep(0.94, 0.995, y));
  return clamp(Math.pow(Math.max(0, hueMask * satMask * lumaMask), 0.62), 0, 1);
}

function blueAccentConfidence(hsv, y) {
  const hd = hsv.h * 360;
  const hueMask = smoothstep(188, 205, hd) * (1 - smoothstep(238, 258, hd));
  return clamp(Math.pow(Math.max(0, hueMask * smoothstep(0.22, 0.58, hsv.s) * smoothstep(0.10, 0.25, y) * (1 - smoothstep(0.90, 0.985, y))), 0.65), 0, 1);
}

function skyBlueConfidence(hsv, y) {
  const hd = hsv.h * 360;
  const hueMask = smoothstep(188, 202, hd) * (1 - smoothstep(232, 252, hd));
  return clamp(Math.pow(Math.max(0, hueMask * smoothstep(0.035, 0.18, hsv.s) * (1 - smoothstep(0.78, 0.98, hsv.s)) * smoothstep(0.44, 0.64, y) * (1 - smoothstep(0.96, 0.995, y))), 0.62), 0, 1);
}

function greenPlantConfidence(hsv, y) {
  const hd = hsv.h * 360;
  const hueMask = smoothstep(66, 84, hd) * (1 - smoothstep(156, 178, hd));
  return clamp(Math.pow(Math.max(0, hueMask * smoothstep(0.10, 0.34, hsv.s) * smoothstep(0.05, 0.16, y) * (1 - smoothstep(0.88, 0.975, y))), 0.60), 0, 1);
}

function shadowZoneConfidence(hsv, y) {
  return clamp((1 - smoothstep(0.16, 0.42, y)) * (0.62 + 0.38 * (1 - smoothstep(0.55, 0.88, hsv.s))), 0, 1);
}

function highlightZoneConfidence(hsv, y) {
  return clamp(smoothstep(0.72, 0.93, y) * (0.55 + 0.45 * (1 - smoothstep(0.22, 0.56, hsv.s))), 0, 1);
}

function quantileSorted(sorted, q) {
  if (!sorted.length) return 0;
  const pos = clamp01(q) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const t = pos - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function median(values, fallback) {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  return quantileSorted(values, 0.5);
}

function quantile(values, q, fallback) {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  return quantileSorted(values, q);
}

function smooth(values, passes) {
  let out = values.slice();
  for (let pass = 0; pass < passes; pass += 1) {
    const next = out.slice();
    for (let i = 0; i < out.length; i += 1) {
      const a = out[Math.max(0, i - 2)];
      const b = out[Math.max(0, i - 1)];
      const c = out[i];
      const d = out[Math.min(out.length - 1, i + 1)];
      const e = out[Math.min(out.length - 1, i + 2)];
      next[i] = (a + 2 * b + 3 * c + 2 * d + e) / 9;
    }
    out = next;
  }
  return out;
}

function smoothCircular(values, passes) {
  let out = values.slice();
  const n = out.length;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = out.slice();
    for (let i = 0; i < n; i += 1) {
      next[i] = (out[(i + n - 2) % n] + 2 * out[(i + n - 1) % n] + 3 * out[i] + 2 * out[(i + 1) % n] + out[(i + 2) % n]) / 9;
    }
    out = next;
  }
  return out;
}

function smoothRows(rows, passes) {
  let out = rows.map((row) => row.slice());
  for (let pass = 0; pass < passes; pass += 1) {
    const next = out.map((row) => row.slice());
    for (let i = 0; i < out.length; i += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        next[i][ch] = (
          out[Math.max(0, i - 2)][ch] +
          2 * out[Math.max(0, i - 1)][ch] +
          3 * out[i][ch] +
          2 * out[Math.min(out.length - 1, i + 1)][ch] +
          out[Math.min(out.length - 1, i + 2)][ch]
        ) / 9;
      }
    }
    out = next;
  }
  return out;
}

function circularMean(values, fallback) {
  if (!values.length) return fallback;
  let x = 0;
  let y = 0;
  for (const hue of values) {
    const angle = hue * Math.PI * 2;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (Math.abs(x) + Math.abs(y) < 0.000001) return fallback;
  const hue = Math.atan2(y, x) / (Math.PI * 2);
  return hue < 0 ? hue + 1 : hue;
}

function interpCurve(xp, fp, x) {
  if (!xp.length || !fp.length) return x;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
  let lo = 0;
  let hi = xp.length - 1;
  while (hi - lo > 1) {
    const mid = (hi + lo) >> 1;
    if (xp[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xp[lo]) / Math.max(0.000001, xp[hi] - xp[lo]);
  return mix(fp[lo], fp[hi], t);
}

function interpRow(rows, x) {
  if (!rows.length) return [1, 1, 1];
  const scaled = clamp01(x) * (rows.length - 1);
  const i = Math.floor(scaled);
  const j = Math.min(rows.length - 1, i + 1);
  const t = scaled - i;
  return [mix(rows[i][0], rows[j][0], t), mix(rows[i][1], rows[j][1], t), mix(rows[i][2], rows[j][2], t)];
}

function interpCircular(values, hue) {
  if (!values.length) return 1;
  const n = values.length;
  const scaled = (((hue % 1) + 1) % 1) * n;
  const i = Math.floor(scaled) % n;
  const j = (i + 1) % n;
  return mix(values[i], values[j], scaled - Math.floor(scaled));
}

function samplesFromImageData(imageData, maxSamples) {
  const data = imageData.data;
  const pixelCount = imageData.width * imageData.height;
  const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
  const samples = [];
  for (let p = 0; p < pixelCount; p += step) {
    const idx = p * 4;
    const a = data[idx + 3] / 255;
    if (a < 0.86) continue;
    const r = data[idx] / 255;
    const g = data[idx + 1] / 255;
    const b = data[idx + 2] / 255;
    const y = luma(r, g, b);
    if (y < 0.015 || y > 0.985) continue;
    const value = Math.max(r, g, b);
    const minValue = Math.min(r, g, b);
    const hsv = rgbToHsv(r, g, b);
    samples.push({ r, g, b, y, sat: value - minValue, hue: hsv.h, hsvSat: hsv.s, value });
  }
  return samples;
}

function buildStats(samples) {
  if (samples.length < 16) throw new Error("可分析像素太少，请换一张更清晰的参考图。");

  const ySorted = [];
  const satSorted = [];
  const allR = [];
  const allG = [];
  const allB = [];
  const skinHues = [];
  const skinSats = [];
  const skinRedGreen = [];
  const skinGreenBlue = [];
  const warmSats = [];
  const warmValues = [];
  const redHues = [];
  const redSats = [];
  const redValues = [];
  const blueHues = [];
  const blueSats = [];
  const blueValues = [];
  const skySats = [];
  const skyValues = [];
  const greenHues = [];
  const greenSats = [];
  const greenValues = [];
  const shadowSats = [];
  const shadowValues = [];
  const highlightSats = [];

  for (const sample of samples) {
    ySorted.push(sample.y);
    satSorted.push(sample.sat);
    allR.push(sample.r);
    allG.push(sample.g);
    allB.push(sample.b);
    const hsv = { h: sample.hue, s: sample.hsvSat, v: sample.value };
    const skin = softSkinConfidence(sample.r, sample.g, sample.b, hsv, sample.y);
    if (skin >= 0.42) {
      skinHues.push(sample.hue);
      skinSats.push(sample.hsvSat);
      skinRedGreen.push(sample.r - sample.g);
      skinGreenBlue.push(sample.g - sample.b);
    }
    if (warmColorConfidence(hsv, sample.y) >= 0.26) {
      warmSats.push(sample.hsvSat);
      warmValues.push(sample.value);
    }
    if (redAccentConfidence(hsv, sample.y) >= 0.30) {
      redHues.push(sample.hue);
      redSats.push(sample.hsvSat);
      redValues.push(sample.value);
    }
    if (blueAccentConfidence(hsv, sample.y) >= 0.30) {
      blueHues.push(sample.hue);
      blueSats.push(sample.hsvSat);
      blueValues.push(sample.value);
    }
    if (skyBlueConfidence(hsv, sample.y) >= 0.28) {
      skySats.push(sample.hsvSat);
      skyValues.push(sample.value);
    }
    if (greenPlantConfidence(hsv, sample.y) >= 0.30) {
      greenHues.push(sample.hue);
      greenSats.push(sample.hsvSat);
      greenValues.push(sample.value);
    }
    if (shadowZoneConfidence(hsv, sample.y) >= 0.58) {
      shadowSats.push(sample.hsvSat);
      shadowValues.push(sample.value);
    }
    if (highlightZoneConfidence(hsv, sample.y) >= 0.58) highlightSats.push(sample.hsvSat);
  }

  ySorted.sort((a, b) => a - b);
  satSorted.sort((a, b) => a - b);
  const quantiles = [];
  for (let i = 0; i <= 256; i += 1) quantiles.push(quantileSorted(ySorted, i / 256));
  quantiles[0] = 0;
  quantiles[256] = 1;
  const smoothQuantiles = smooth(quantiles, 4);
  smoothQuantiles[0] = 0;
  smoothQuantiles[256] = 1;
  for (let i = 1; i < smoothQuantiles.length; i += 1) smoothQuantiles[i] = Math.max(smoothQuantiles[i - 1], smoothQuantiles[i]);

  const fallbackRgb = [median(allR, 0.5), median(allG, 0.5), median(allB, 0.5)];
  const fallbackY = Math.max(0.0001, luma(fallbackRgb[0], fallbackRgb[1], fallbackRgb[2]));
  let fallbackRatio = fallbackRgb.map((value) => value / fallbackY);
  const ratioY = Math.max(0.0001, luma(fallbackRatio[0], fallbackRatio[1], fallbackRatio[2]));
  fallbackRatio = fallbackRatio.map((value) => value / ratioY);

  const balanceRows = [];
  for (let bin = 0; bin < 17; bin += 1) {
    const lo = bin / 17;
    const hi = (bin + 1) / 17;
    const rs = [];
    const gs = [];
    const bs = [];
    for (const sample of samples) {
      if (sample.y >= lo && sample.y <= hi) {
        rs.push(sample.r);
        gs.push(sample.g);
        bs.push(sample.b);
      }
    }
    let ratio = fallbackRatio.slice();
    if (rs.length >= 40) {
      const rgb = [median(rs, fallbackRgb[0]), median(gs, fallbackRgb[1]), median(bs, fallbackRgb[2])];
      const yy = Math.max(0.0001, luma(rgb[0], rgb[1], rgb[2]));
      ratio = [rgb[0] / yy, rgb[1] / yy, rgb[2] / yy];
      const rowY = Math.max(0.0001, luma(ratio[0], ratio[1], ratio[2]));
      ratio = ratio.map((value) => clamp(value / rowY, 0.65, 1.55));
    }
    balanceRows.push(ratio);
  }

  const fallbackSat = quantileSorted(satSorted, 0.6);
  const fallbackValue = Math.max(fallbackRgb[0], fallbackRgb[1], fallbackRgb[2]);
  const hueSatRows = [];
  const hueValueRows = [];
  for (let bin = 0; bin < 12; bin += 1) {
    const sats = [];
    const vals = [];
    for (const sample of samples) {
      if (sample.hsvSat < 0.045) continue;
      if (Math.floor(sample.hue * 12) % 12 === bin) {
        sats.push(sample.sat);
        vals.push(sample.value);
      }
    }
    hueSatRows.push(median(sats, fallbackSat));
    hueValueRows.push(median(vals, fallbackValue));
  }

  const p25 = quantileSorted(ySorted, 0.25);
  const p75 = quantileSorted(ySorted, 0.75);
  const stats = {
    quantiles: smoothQuantiles,
    balanceRows: smoothRows(balanceRows, 4),
    hueSatRows: smoothCircular(hueSatRows, 3),
    hueValueRows: smoothCircular(hueValueRows, 3),
    satP60: fallbackSat,
    lumaMedian: quantileSorted(ySorted, 0.5),
    contrast: Math.max(0.05, p75 - p25),
    skinHue: skinHues.length >= 80 ? median(skinHues, 26 / 360) : 26 / 360,
    skinSat: skinSats.length >= 80 ? clamp(median(skinSats, 0.22), 0.06, 0.44) : 0.22,
    skinRedGreen: skinRedGreen.length >= 80 ? clamp(median(skinRedGreen, 0.06), -0.01, 0.18) : 0.06,
    skinGreenBlue: skinGreenBlue.length >= 80 ? clamp(median(skinGreenBlue, 0.065), 0.015, 0.18) : 0.065,
    skinSampleCount: skinHues.length,
    warmSampleCount: warmSats.length,
    redHue: redHues.length >= 40 ? circularMean(redHues, 0) : 0,
    redSampleCount: redSats.length,
    blueHue: blueHues.length >= 40 ? circularMean(blueHues, 212 / 360) : 212 / 360,
    blueSampleCount: blueSats.length,
    skySampleCount: skySats.length,
    greenHue: greenHues.length >= 40 ? circularMean(greenHues, 112 / 360) : 112 / 360,
    greenSampleCount: greenSats.length,
    shadowSampleCount: shadowSats.length,
    highlightSampleCount: highlightSats.length,
    sampleCount: samples.length,
  };

  if (warmSats.length >= 80) {
    stats.warmSatP75 = clamp(quantile(warmSats, 0.75, 0.36), 0.10, 0.92);
    stats.warmSatP90 = clamp(quantile(warmSats, 0.90, 0.52), 0.16, 0.98);
    stats.warmValueP90 = clamp(quantile(warmValues, 0.90, 0.72), 0.12, 0.98);
  } else {
    stats.warmSatP75 = clamp(stats.satP60 * 1.55 + 0.12, 0.18, 0.62);
    stats.warmSatP90 = clamp(stats.satP60 * 2.10 + 0.18, 0.28, 0.78);
    stats.warmValueP90 = clamp(stats.lumaMedian + stats.contrast * 1.15 + 0.16, 0.32, 0.92);
  }

  stats.redSatP70 = redSats.length >= 40 ? clamp(quantile(redSats, 0.70, stats.warmSatP75), 0.18, 0.95) : clamp(stats.warmSatP75 * 1.08, 0.26, 0.82);
  stats.redSatP88 = redSats.length >= 40 ? clamp(quantile(redSats, 0.88, stats.warmSatP90), 0.24, 0.98) : clamp(stats.warmSatP90 * 1.02, 0.34, 0.90);
  stats.redValueP65 = redValues.length >= 40 ? clamp(quantile(redValues, 0.65, stats.warmValueP90), 0.12, 0.98) : clamp(stats.warmValueP90 * 0.92, 0.24, 0.86);
  stats.blueSatP75 = blueSats.length >= 40 ? clamp(quantile(blueSats, 0.75, fallbackSat), 0.10, 0.92) : clamp(fallbackSat * 1.20 + 0.08, 0.18, 0.72);
  stats.blueValueP70 = blueValues.length >= 40 ? clamp(quantile(blueValues, 0.70, 0.62), 0.16, 0.98) : clamp(quantileSorted(ySorted, 0.70) + 0.08, 0.34, 0.90);
  stats.skySatP70 = skySats.length >= 60 ? clamp(quantile(skySats, 0.70, 0.22), 0.04, 0.58) : 0.22;
  stats.skyValueP70 = skyValues.length >= 60 ? clamp(quantile(skyValues, 0.70, 0.78), 0.42, 0.98) : 0.78;
  stats.greenSatP75 = greenSats.length >= 40 ? clamp(quantile(greenSats, 0.75, fallbackSat), 0.12, 0.88) : clamp(fallbackSat * 1.25 + 0.06, 0.20, 0.72);
  stats.greenValueP70 = greenValues.length >= 40 ? clamp(quantile(greenValues, 0.70, 0.52), 0.12, 0.94) : clamp(quantileSorted(ySorted, 0.60) + 0.04, 0.24, 0.78);
  stats.shadowSatP70 = shadowSats.length >= 80 ? clamp(quantile(shadowSats, 0.70, fallbackSat), 0.015, 0.48) : clamp(fallbackSat * 0.70 + 0.035, 0.04, 0.32);
  stats.shadowValueP50 = shadowValues.length >= 80 ? clamp(quantile(shadowValues, 0.50, 0.20), 0.02, 0.55) : clamp(quantileSorted(ySorted, 0.18), 0.04, 0.34);
  stats.highlightSatP70 = highlightSats.length >= 80 ? clamp(quantile(highlightSats, 0.70, 0.10), 0.005, 0.38) : 0.10;
  return stats;
}

function analyzeImageData(imageData) {
  return buildStats(samplesFromImageData(imageData, MAX_ANALYZE_SAMPLES));
}

function createToneMapper(refStats, targetStats, settings, params) {
  const toneCurve = [];
  const strength = settings.strength;
  const medianShift = clamp(refStats.lumaMedian - targetStats.lumaMedian, -0.10, 0.10) * strength * params.toneWeight * 0.42;
  const contrastScale = clamp(Math.pow(refStats.contrast / Math.max(0.05, targetStats.contrast), 0.20), 0.88, 1.12);
  for (let i = 0; i <= 256; i += 1) {
    const srcY = targetStats.quantiles[i];
    const q = i / 256;
    const refY = refStats.quantiles[i];
    const sinTerm = Math.max(0, Math.sin(Math.PI * srcY));
    const directMatch = srcY + (refY - srcY) * params.toneWeight * 0.16;
    let filmY = 0.5 + (srcY - 0.5) * (1 + (contrastScale - 1) * params.toneWeight);
    filmY += medianShift;
    filmY += (1 - smoothstep(0.06, 0.34, srcY)) * 0.014 * strength * params.toneWeight;
    filmY -= smoothstep(0.72, 0.98, srcY) * 0.024 * strength * params.toneWeight;
    const qGuard = 0.55 + 0.45 * sinTerm;
    const styleY = filmY * 0.78 + directMatch * 0.22;
    const deltaLimit = params.maxToneDelta * qGuard * (0.55 + 0.45 * (1 - Math.abs(q - 0.5) * 2));
    const protectedY = clamp(styleY, srcY - deltaLimit, srcY + deltaLimit);
    toneCurve.push(clamp01(srcY + (protectedY - srcY) * strength));
  }
  toneCurve[0] = 0;
  toneCurve[256] = 1;
  for (let i = 1; i < toneCurve.length; i += 1) toneCurve[i] = Math.max(toneCurve[i - 1], toneCurve[i]);
  return toneCurve;
}

function buildLocalMap(imageData, gridSize = 28) {
  const { width, height, data } = imageData;
  const gridW = Math.min(gridSize, width);
  const gridH = Math.min(gridSize, height);
  const values = new Float32Array(gridW * gridH);
  const counts = new Uint32Array(gridW * gridH);
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(gridH - 1, Math.floor((y * gridH) / height));
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(gridW - 1, Math.floor((x * gridW) / width));
      const idx = gy * gridW + gx;
      const p = (y * width + x) * 4;
      values[idx] += luma(data[p] / 255, data[p + 1] / 255, data[p + 2] / 255);
      counts[idx] += 1;
    }
  }
  for (let i = 0; i < values.length; i += 1) values[i] = counts[i] ? values[i] / counts[i] : 0.5;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = new Float32Array(values);
    for (let gy = 0; gy < gridH; gy += 1) {
      for (let gx = 0; gx < gridW; gx += 1) {
        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const x2 = clamp(gx + ox, 0, gridW - 1);
            const y2 = clamp(gy + oy, 0, gridH - 1);
            sum += values[y2 * gridW + x2];
            count += 1;
          }
        }
        next[gy * gridW + gx] = sum / count;
      }
    }
    values.set(next);
  }
  return { values, gridW, gridH, width, height };
}

function sampleLocalMap(map, x, y) {
  if (!map || !map.values.length) return 0.5;
  const fx = clamp((x / Math.max(1, map.width - 1)) * (map.gridW - 1), 0, map.gridW - 1);
  const fy = clamp((y / Math.max(1, map.height - 1)) * (map.gridH - 1), 0, map.gridH - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(map.gridW - 1, x0 + 1);
  const y1 = Math.min(map.gridH - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = map.values[y0 * map.gridW + x0];
  const b = map.values[y0 * map.gridW + x1];
  const c = map.values[y1 * map.gridW + x0];
  const d = map.values[y1 * map.gridW + x1];
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

function matchPixel(r, g, b, a, refStats, targetStats, toneCurve, settings, params, localY, localWeight) {
  const y = luma(r, g, b);
  const hsv = rgbToHsv(r, g, b);
  const mappedY = interpCurve(targetStats.quantiles, toneCurve, y);
  const strength = settings.strength;
  const skinConfidence = settings.skinProtect ? softSkinConfidence(r, g, b, hsv, y) : 0;
  const skinProtect = settings.skinProtect && isLikelySkin(r, g, b, hsv, y) ? 0.45 : 1;
  const redConfidence = redAccentConfidence(hsv, y) * (1 - skinConfidence * 0.88);
  const highlightMask = clamp((y - 0.58) / 0.42, 0, 1);
  const shadowMask = clamp((0.36 - y) / 0.36, 0, 1);
  let desiredY = mappedY;

  if (localWeight > 0) {
    const localDelta = y - localY;
    const contrastRatio = clamp(Math.pow(refStats.contrast / Math.max(0.05, targetStats.contrast), 0.35), 0.78, 1.28);
    desiredY = clamp01(mappedY + localDelta * (contrastRatio - 1) * localWeight * 0.28);
  }

  if (desiredY > y && redConfidence > 0.001) {
    const sourceBright = smoothstep(0.42, 0.88, y);
    const allowedLift = 0.004 + 0.014 * (1 - sourceBright);
    desiredY = y + Math.min(desiredY - y, allowedLift);
  }

  let [tr, tg, tb] = fitRgbToLuma(r, g, b, desiredY);
  const tonedY = desiredY;

  const globalSatFactor = clamp(Math.pow(Math.max(0.02, refStats.satP60) / Math.max(0.02, targetStats.satP60), 0.22), 0.86, 1.12);
  const refHueSat = Math.max(0.02, interpCircular(refStats.hueSatRows, hsv.h));
  const targetHueSat = Math.max(0.02, interpCircular(targetStats.hueSatRows, hsv.h));
  const hueSatFactor = clamp(Math.pow(refHueSat / targetHueSat, 0.16), 0.90, 1.10);
  const materialGuard = 1 - clamp(redConfidence * 0.68 + skinConfidence * 0.46 + highlightMask * 0.22, 0, 0.76);
  const satTarget = globalSatFactor * (1 + (hueSatFactor - 1) * params.hueWeight);
  let satFactor = 1 + (satTarget - 1) * strength * params.satWeight * skinProtect * materialGuard;
  if (highlightMask > 0.001) satFactor *= 1 - highlightMask * strength * 0.045;
  [tr, tg, tb] = scaleChroma(tr, tg, tb, tonedY, satFactor);

  const srcRatio = interpRow(targetStats.balanceRows, y);
  const refRatio = interpRow(refStats.balanceRows, y);
  const zoneWeight = 1 - clamp(highlightMask * 0.34 + shadowMask * 0.14 + redConfidence * 0.42 + skinConfidence * 0.48, 0, 0.82);
  const effectiveColorWeight = params.colorWeight * strength * skinProtect * zoneWeight;
  const correction = [
    clamp(refRatio[0] / Math.max(0.0001, srcRatio[0]), 1 / params.maxColorRatio, params.maxColorRatio),
    clamp(refRatio[1] / Math.max(0.0001, srcRatio[1]), 1 / params.maxColorRatio, params.maxColorRatio),
    clamp(refRatio[2] / Math.max(0.0001, srcRatio[2]), 1 / params.maxColorRatio, params.maxColorRatio),
  ];
  tr *= 1 + (correction[0] - 1) * effectiveColorWeight;
  tg *= 1 + (correction[1] - 1) * effectiveColorWeight;
  tb *= 1 + (correction[2] - 1) * effectiveColorWeight;
  [tr, tg, tb] = fitRgbToLuma(tr, tg, tb, tonedY);

  if (redConfidence > 0.001) {
    const outHsv = rgbToHsv(tr, tg, tb);
    const redSatCeiling = clamp(Math.min(refStats.redSatP70 + 0.035, hsv.s + 0.055), 0.30, 0.72);
    const redSatFloor = clamp(hsv.s * 0.84, 0.12, 0.66);
    const redTargetSat = clamp(refStats.redSatP70, redSatFloor, redSatCeiling);
    const controlledSat = mix(outHsv.s, redTargetSat, redConfidence * strength * 0.58);
    const redValueTarget = clamp(refStats.redValueP65, hsv.v - 0.045, hsv.v + 0.025);
    const controlledValue = mix(outHsv.v, redValueTarget, redConfidence * strength * 0.28);
    [tr, tg, tb] = hsvToRgb(mix(outHsv.h, refStats.redHue, redConfidence * strength * 0.08), controlledSat, controlledValue);
    const maxRedY = y + (0.004 + 0.010 * (1 - smoothstep(0.36, 0.82, y)));
    [tr, tg, tb] = fitRgbToLuma(tr, tg, tb, Math.min(tonedY, maxRedY));
  }

  if (skinConfidence > 0.001) {
    const skinBlend = skinConfidence * strength * 0.16;
    tr = mix(tr, r, skinBlend);
    tg = mix(tg, g, skinBlend);
    tb = mix(tb, b, skinBlend);
    [tr, tg, tb] = fitRgbToLuma(tr, tg, tb, tonedY);
  }

  return [clamp01(tr), clamp01(tg), clamp01(tb), a];
}

function hueDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

function hslChannelWeight(channel, hue, sat) {
  const center = HSL_CENTERS[channel];
  const distance = hueDistance(hue, center);
  const width = channel === "red" ? 28 / 360 : 34 / 360;
  const mask = 1 - smoothstep(width * 0.55, width, distance);
  return clamp(mask * smoothstep(0.025, 0.18, sat), 0, 1);
}

function applyHslAdjustments(r, g, b, hslAdjustments) {
  if (!hslAdjustments) return [r, g, b];
  const hsv = rgbToHsv(r, g, b);
  let hueShift = 0;
  let satScale = 1;
  let lumaShift = 0;
  for (const channel of HSL_CHANNELS) {
    const adjust = hslAdjustments[channel];
    if (!adjust) continue;
    const weight = hslChannelWeight(channel, hsv.h, hsv.s);
    if (weight <= 0.0001) continue;
    hueShift += (adjust.h / 100) * (30 / 360) * weight;
    satScale += (adjust.s / 100) * 0.62 * weight;
    lumaShift += (adjust.l / 100) * 0.18 * weight;
  }
  if (Math.abs(hueShift) < 0.0001 && Math.abs(satScale - 1) < 0.0001 && Math.abs(lumaShift) < 0.0001) {
    return [r, g, b];
  }
  const next = hsvToRgb(hsv.h + hueShift, clamp01(hsv.s * satScale), hsv.v);
  const targetY = clamp01(luma(next[0], next[1], next[2]) + lumaShift);
  return fitRgbToLuma(next[0], next[1], next[2], targetY);
}

function applyManualAdjustments(r, g, b, settings) {
  const adjustments = settings.adjustments || {};
  let tr = r;
  let tg = g;
  let tb = b;
  let y = luma(tr, tg, tb);

  const exposure = adjustments.exposure || 0;
  if (Math.abs(exposure) > 0.0001) {
    const factor = Math.pow(2, exposure);
    tr = clamp01(tr * factor);
    tg = clamp01(tg * factor);
    tb = clamp01(tb * factor);
    y = luma(tr, tg, tb);
  }

  const contrast = (adjustments.contrast || 0) / 100;
  if (Math.abs(contrast) > 0.0001) {
    const scale = 1 + contrast * 0.72;
    const nextY = clamp01(0.5 + (y - 0.5) * scale);
    [tr, tg, tb] = fitRgbToLuma(tr, tg, tb, nextY);
    y = nextY;
  }

  let yShift = 0;
  yShift += ((adjustments.highlights || 0) / 100) * 0.16 * smoothstep(0.50, 0.92, y);
  yShift += ((adjustments.shadows || 0) / 100) * 0.16 * (1 - smoothstep(0.12, 0.52, y));
  yShift += ((adjustments.whites || 0) / 100) * 0.12 * smoothstep(0.72, 0.98, y);
  yShift += ((adjustments.blacks || 0) / 100) * 0.12 * (1 - smoothstep(0.04, 0.30, y));
  if (Math.abs(yShift) > 0.0001) {
    y = clamp01(y + yShift);
    [tr, tg, tb] = fitRgbToLuma(tr, tg, tb, y);
  }

  const temp = (adjustments.temperature || 0) / 100;
  const tint = (adjustments.tint || 0) / 100;
  if (Math.abs(temp) > 0.0001 || Math.abs(tint) > 0.0001) {
    const targetY = luma(tr, tg, tb);
    tr = clamp01(tr * (1 + temp * 0.07 + tint * 0.025));
    tg = clamp01(tg * (1 - tint * 0.055));
    tb = clamp01(tb * (1 - temp * 0.08 + tint * 0.025));
    [tr, tg, tb] = fitRgbToLuma(tr, tg, tb, targetY);
  }

  let hsv = rgbToHsv(tr, tg, tb);
  const skin = settings.skinProtect ? softSkinConfidence(tr, tg, tb, hsv, luma(tr, tg, tb)) : 0;
  const vibrance = (adjustments.vibrance || 0) / 100;
  const saturation = (adjustments.saturation || 0) / 100;
  if (Math.abs(vibrance) > 0.0001 || Math.abs(saturation) > 0.0001) {
    const satBoost = saturation * 0.80 + vibrance * 0.72 * (1 - hsv.s) * (1 - skin * 0.55);
    hsv.s = clamp01(hsv.s * (1 + satBoost));
    [tr, tg, tb] = hsvToRgb(hsv.h, hsv.s, hsv.v);
  }

  [tr, tg, tb] = applyHslAdjustments(tr, tg, tb, settings.hsl);
  return [clamp01(tr), clamp01(tg), clamp01(tb)];
}

async function loadImageToImageData(file, maxEdge) {
  if (!canBrowserDecode(file)) {
    const ext = fileExtension(file).toUpperCase() || "RAW";
    throw new Error(`${file.name} 是 ${ext} 文件，网页无法直接读取 RAW。请先转成 JPG/PNG/WebP，或接入本地 RAW 解码服务。`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
      image.src = url;
    });
    const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, width, height);
    return { canvas, imageData: ctx.getImageData(0, 0, width, height), width, height, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function setStatus(text, progress = null) {
  dom.statusLine.textContent = text;
  if (progress !== null) dom.progressBar.style.width = `${clamp(progress, 0, 100)}%`;
}

function setBusy(busy) {
  state.busy = busy;
  dom.processBtn.disabled = busy;
  dom.pickRefsBtn.disabled = busy;
  dom.pickTargetsBtn.disabled = busy;
  dom.pickFolderBtn.disabled = busy;
}

function updateAdjustmentLabels() {
  for (const input of document.querySelectorAll(".adjust-slider")) {
    const param = input.dataset.param;
    const valueEl = document.querySelector(`[data-value-for="${param}"]`);
    if (!valueEl) continue;
    if (param === "exposure") valueEl.textContent = (Number(input.value) / 100).toFixed(2);
    else valueEl.textContent = String(Number(input.value));
  }
}

function readParamsFromControls() {
  const params = defaultParams();
  params.mode = dom.modeSelect.value;
  params.strength = Number(dom.strengthRange.value) / 100;
  params.localStrength = Number(dom.localRange.value) / 100;
  params.skinProtect = dom.skinProtectInput.checked;

  for (const input of document.querySelectorAll(".adjust-slider")) {
    const value = Number(input.value);
    params.adjustments[input.dataset.param] = input.dataset.param === "exposure" ? value / 100 : value;
  }

  for (const input of document.querySelectorAll(".hsl-slider")) {
    const channel = input.dataset.channel;
    const axis = input.dataset.axis;
    params.hsl[channel][axis] = Number(input.value);
  }
  return params;
}

function applyParamsToControls(params) {
  const next = params || defaultParams();
  dom.modeSelect.value = next.mode;
  dom.strengthRange.value = Math.round(next.strength * 100);
  dom.localRange.value = Math.round(next.localStrength * 100);
  dom.skinProtectInput.checked = Boolean(next.skinProtect);
  dom.strengthValue.textContent = `${dom.strengthRange.value}%`;
  dom.localValue.textContent = `${dom.localRange.value}%`;

  for (const input of document.querySelectorAll(".adjust-slider")) {
    const param = input.dataset.param;
    const value = next.adjustments[param] || 0;
    input.value = param === "exposure" ? Math.round(value * 100) : value;
  }

  for (const input of document.querySelectorAll(".hsl-slider")) {
    const channel = input.dataset.channel;
    const axis = input.dataset.axis;
    input.value = next.hsl?.[channel]?.[axis] || 0;
  }
  updateAdjustmentLabels();
}

function saveCurrentParams() {
  ensureTargetParams();
  if (state.targets.length && state.activeTargetIndex >= 0) {
    state.targetParams[state.activeTargetIndex] = readParamsFromControls();
  }
}

function summarizeFiles(files) {
  if (!files.length) return "未选择";
  const names = files.slice(0, 7).map((file) => file.name).join("、");
  const unsupported = files.filter((file) => !canBrowserDecode(file)).length;
  const suffix = unsupported ? `，其中 ${unsupported} 个 RAW/不可直接读取` : "";
  return files.length > 7 ? `${names} ... 共 ${files.length} 张${suffix}` : `${names}，共 ${files.length} 张${suffix}`;
}

function setPreview(imgEl, file, frameSelector, urlKind) {
  const frame = imgEl.closest(frameSelector);
  if (!file) {
    if (state.previewUrls[urlKind]) URL.revokeObjectURL(state.previewUrls[urlKind]);
    state.previewUrls[urlKind] = null;
    imgEl.removeAttribute("src");
    frame.classList.remove("has-media");
    const empty = urlKind === "ref" ? dom.refEmpty : dom.targetEmpty;
    empty.textContent = urlKind === "ref" ? "选择参考图后显示" : "选择素材后显示";
    return;
  }
  if (!canBrowserDecode(file)) {
    if (state.previewUrls[urlKind]) URL.revokeObjectURL(state.previewUrls[urlKind]);
    state.previewUrls[urlKind] = null;
    imgEl.removeAttribute("src");
    frame.classList.remove("has-media");
    const empty = urlKind === "ref" ? dom.refEmpty : dom.targetEmpty;
    empty.innerHTML = `<span class="unsupported-note">${fileExtension(file).toUpperCase()} 需要本地 RAW 解码服务，网页不能直接预览。</span>`;
    return;
  }
  const empty = urlKind === "ref" ? dom.refEmpty : dom.targetEmpty;
  empty.textContent = urlKind === "ref" ? "选择参考图后显示" : "选择素材后显示";
  if (state.previewUrls[urlKind]) URL.revokeObjectURL(state.previewUrls[urlKind]);
  state.previewUrls[urlKind] = URL.createObjectURL(file);
  imgEl.src = state.previewUrls[urlKind];
  frame.classList.add("has-media");
}

function revokeThumbUrls(kind) {
  for (const url of state.thumbUrls[kind]) URL.revokeObjectURL(url);
  state.thumbUrls[kind] = [];
}

function updateActiveThumbs(stripEl, activeIndex) {
  for (const button of stripEl.querySelectorAll(".thumb-button")) {
    button.classList.toggle("is-active", Number(button.dataset.index) === activeIndex);
  }
}

function renderFileThumbs(files, stripEl, kind, activeIndex, onSelect) {
  revokeThumbUrls(kind);
  stripEl.innerHTML = "";
  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    state.thumbUrls[kind].push(url);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-button";
    button.dataset.index = String(index);
    button.title = file.name;
    if (index === activeIndex) button.classList.add("is-active");
    if (canBrowserDecode(file)) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = file.name;
      button.appendChild(img);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "thumb-placeholder";
      placeholder.textContent = fileExtension(file) || "RAW";
      button.appendChild(placeholder);
    }
    const badge = document.createElement("span");
    badge.className = "thumb-index";
    badge.textContent = String(index + 1);
    button.appendChild(badge);
    button.addEventListener("click", () => onSelect(index));
    stripEl.appendChild(button);
  });
}

function renderOutputThumbs() {
  dom.resultThumbs.innerHTML = "";
  state.outputs.forEach((output, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-button";
    button.dataset.index = String(index);
    button.title = output.name;
    if (index === state.activeOutputIndex) button.classList.add("is-active");
    const img = document.createElement("img");
    img.src = output.url;
    img.alt = output.name;
    const badge = document.createElement("span");
    badge.className = "thumb-index";
    badge.textContent = String(index + 1);
    button.append(img, badge);
    button.addEventListener("click", () => selectOutput(index));
    dom.resultThumbs.appendChild(button);
  });
}

function selectReference(index) {
  state.activeRefIndex = clamp(index, 0, Math.max(0, state.references.length - 1));
  setPreview(dom.refPreview, state.references[state.activeRefIndex], ".preview-frame", "ref");
  updateActiveThumbs(dom.refThumbs, state.activeRefIndex);
}

function selectTarget(index) {
  if (state.targets.length && index !== state.activeTargetIndex) saveCurrentParams();
  ensureTargetParams();
  state.activeTargetIndex = clamp(index, 0, Math.max(0, state.targets.length - 1));
  setPreview(dom.targetPreview, state.targets[state.activeTargetIndex], ".preview-frame", "target");
  updateActiveThumbs(dom.targetThumbs, state.activeTargetIndex);
  applyParamsToControls(state.targetParams[state.activeTargetIndex] || defaultParams());
}

function refreshFileLists() {
  dom.refsList.textContent = summarizeFiles(state.references);
  dom.targetsList.textContent = summarizeFiles(state.targets);
  ensureTargetParams();
  state.activeRefIndex = Math.min(state.activeRefIndex, Math.max(0, state.references.length - 1));
  state.activeTargetIndex = Math.min(state.activeTargetIndex, Math.max(0, state.targets.length - 1));
  renderFileThumbs(state.references, dom.refThumbs, "refs", state.activeRefIndex, selectReference);
  renderFileThumbs(state.targets, dom.targetThumbs, "targets", state.activeTargetIndex, selectTarget);
  selectReference(state.activeRefIndex);
  selectTarget(state.activeTargetIndex);
}

function clearOutputs() {
  for (const output of state.outputs) URL.revokeObjectURL(output.url);
  state.outputs = [];
  state.activeOutput = null;
  state.activeOutputIndex = -1;
  dom.resultThumbs.innerHTML = "";
  dom.downloadBtn.disabled = true;
  dom.downloadAllBtn.disabled = true;
  dom.resultCanvas.closest(".preview-frame").classList.remove("has-media");
  const ctx = dom.resultCanvas.getContext("2d");
  ctx.clearRect(0, 0, dom.resultCanvas.width, dom.resultCanvas.height);
}

function outputName(fileName, format) {
  const clean = fileName.replace(/\.[^.]+$/, "");
  const ext = format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";
  return `${clean}__tone-match.${ext}`;
}

function canvasToBlob(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器无法导出该格式。"));
    }, format, quality);
  });
}

function downloadUrl(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function selectOutput(index) {
  const output = state.outputs[index];
  if (!output) return;
  state.activeOutput = output;
  state.activeOutputIndex = index;
  const ctx = dom.resultCanvas.getContext("2d");
  dom.resultCanvas.width = output.canvas.width;
  dom.resultCanvas.height = output.canvas.height;
  ctx.drawImage(output.canvas, 0, 0);
  dom.resultCanvas.closest(".preview-frame").classList.add("has-media");
  dom.downloadBtn.disabled = false;
  updateActiveThumbs(dom.resultThumbs, index);
}

function addOutput(output) {
  const index = state.outputs.push(output) - 1;
  renderOutputThumbs();
  selectOutput(index);
  dom.downloadAllBtn.disabled = false;
}

async function analyzeReferences(files) {
  const allSamples = [];
  for (let i = 0; i < files.length; i += 1) {
    setStatus(`正在分析参考图 ${i + 1}/${files.length}：${files[i].name}`, (i / files.length) * 18);
    const loaded = await loadImageToImageData(files[i], MAX_REFERENCE_EDGE);
    allSamples.push(...samplesFromImageData(loaded.imageData, MAX_ANALYZE_SAMPLES / Math.max(1, files.length)));
    await nextFrame();
  }
  return buildStats(allSamples);
}

async function processTarget(file, refStats, index, total, imageParams) {
  const maxEdge = Number(dom.sizeSelect.value);
  const format = dom.formatSelect.value;
  const quality = Number(dom.qualityRange.value) / 100;
  const settings = imageParams || readParamsFromControls();
  const params = modeParams(settings.mode);

  setStatus(`正在读取素材 ${index + 1}/${total}：${file.name}`, 20 + (index / total) * 60);
  const loaded = await loadImageToImageData(file, maxEdge);
  const targetStats = analyzeImageData(loaded.imageData);
  const toneCurve = createToneMapper(refStats, targetStats, settings, params);
  const localWeight = params.baseLocalWeight * settings.localStrength;
  const localMap = localWeight > 0.001 ? buildLocalMap(loaded.imageData) : null;
  const canvas = document.createElement("canvas");
  canvas.width = loaded.width;
  canvas.height = loaded.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("当前浏览器无法创建图片处理画布。");
  }
  const out = ctx.createImageData(loaded.width, loaded.height);
  out.data.set(loaded.imageData.data);

  const pixelCount = loaded.width * loaded.height;
  for (let p = 0; p < pixelCount; p += 1) {
    const i = p * 4;
    const x = p % loaded.width;
    const y = Math.floor(p / loaded.width);
    const r = loaded.imageData.data[i] / 255;
    const g = loaded.imageData.data[i + 1] / 255;
    const b = loaded.imageData.data[i + 2] / 255;
    const a = loaded.imageData.data[i + 3] / 255;
    const localY = localMap ? sampleLocalMap(localMap, x, y) : 0.5;
    const px = matchPixel(r, g, b, a, refStats, targetStats, toneCurve, settings, params, localY, localWeight);
    const adjusted = applyManualAdjustments(px[0], px[1], px[2], settings);
    out.data[i] = Math.round(adjusted[0] * 255);
    out.data[i + 1] = Math.round(adjusted[1] * 255);
    out.data[i + 2] = Math.round(adjusted[2] * 255);
    out.data[i + 3] = Math.round(px[3] * 255);
    if (p % CHUNK_PIXELS === 0) {
      const localProgress = p / pixelCount;
      setStatus(`正在仿色 ${index + 1}/${total}：${file.name}`, 28 + ((index + localProgress) / total) * 58);
      await nextFrame();
    }
  }

  ctx.putImageData(out, 0, 0);
  const blob = await canvasToBlob(canvas, format, quality);
  const name = outputName(file.name, format);
  const url = URL.createObjectURL(blob);
  return { canvas, blob, url, name };
}

async function processAll() {
  if (state.busy) return;
  if (!state.references.length) {
    setStatus("请先选择参考图。", 0);
    return;
  }
  if (!state.targets.length) {
    setStatus("请先选择素材图。", 0);
    return;
  }
  const unsupportedRefs = state.references.filter((file) => !canBrowserDecode(file));
  const unsupportedTargets = state.targets.filter((file) => !canBrowserDecode(file));
  if (unsupportedRefs.length || unsupportedTargets.length) {
    const sample = unsupportedRefs[0] || unsupportedTargets[0];
    setStatus(`处理失败：${sample.name} 是 RAW/浏览器不可解码文件。网页端请先转 JPG/PNG/WebP。`, 0);
    return;
  }

  clearOutputs();
  saveCurrentParams();
  ensureTargetParams();
  setBusy(true);
  try {
    const refStats = await analyzeReferences(state.references);
    for (let i = 0; i < state.targets.length; i += 1) {
      const output = await processTarget(state.targets[i], refStats, i, state.targets.length, state.targetParams[i] || readParamsFromControls());
      addOutput(output);
    }
    setStatus(`处理完成：${state.targets.length} 张。`, 100);
  } catch (error) {
    console.error(error);
    setStatus(`处理失败：${error.message}`, 0);
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  dom.pickRefsBtn.addEventListener("click", () => dom.refsInput.click());
  dom.pickTargetsBtn.addEventListener("click", () => dom.targetsInput.click());
  dom.pickFolderBtn.addEventListener("click", () => dom.folderInput.click());
  dom.refsInput.addEventListener("change", () => {
    state.references = Array.from(dom.refsInput.files || []);
    state.activeRefIndex = 0;
    clearOutputs();
    refreshFileLists();
  });
  dom.targetsInput.addEventListener("change", () => {
    state.targets = Array.from(dom.targetsInput.files || []).filter((file) => canBrowserDecode(file) || isRawFile(file));
    state.activeTargetIndex = 0;
    state.targetParams = state.targets.map(() => readParamsFromControls());
    clearOutputs();
    refreshFileLists();
  });
  dom.folderInput.addEventListener("change", () => {
    state.targets = Array.from(dom.folderInput.files || []).filter((file) => canBrowserDecode(file) || isRawFile(file));
    state.activeTargetIndex = 0;
    state.targetParams = state.targets.map(() => readParamsFromControls());
    clearOutputs();
    refreshFileLists();
  });
  dom.clearRefsBtn.addEventListener("click", () => {
    state.references = [];
    state.activeRefIndex = 0;
    dom.refsInput.value = "";
    clearOutputs();
    refreshFileLists();
  });
  dom.clearTargetsBtn.addEventListener("click", () => {
    state.targets = [];
    state.activeTargetIndex = 0;
    state.targetParams = [];
    dom.targetsInput.value = "";
    dom.folderInput.value = "";
    clearOutputs();
    refreshFileLists();
  });
  dom.copyParamsBtn.addEventListener("click", () => {
    saveCurrentParams();
    state.copiedParams = deepClone(readParamsFromControls());
    setStatus("已复制当前素材图参数。", null);
  });
  dom.pasteParamsBtn.addEventListener("click", () => {
    if (!state.copiedParams) {
      setStatus("还没有复制参数。", null);
      return;
    }
    applyParamsToControls(deepClone(state.copiedParams));
    saveCurrentParams();
    setStatus("已粘贴到当前素材图。", null);
  });
  dom.syncParamsBtn.addEventListener("click", () => {
    const params = deepClone(readParamsFromControls());
    ensureTargetParams();
    state.targetParams = state.targets.map(() => deepClone(params));
    setStatus(`已同步参数到 ${state.targets.length} 张素材图。`, null);
  });
  dom.strengthRange.addEventListener("input", () => {
    dom.strengthValue.textContent = `${dom.strengthRange.value}%`;
    saveCurrentParams();
  });
  dom.localRange.addEventListener("input", () => {
    dom.localValue.textContent = `${dom.localRange.value}%`;
    saveCurrentParams();
  });
  dom.qualityRange.addEventListener("input", () => {
    dom.qualityValue.textContent = `${dom.qualityRange.value}%`;
  });
  for (const control of [dom.modeSelect, dom.skinProtectInput]) {
    control.addEventListener("change", saveCurrentParams);
  }
  for (const input of document.querySelectorAll(".adjust-slider")) {
    input.addEventListener("input", () => {
      updateAdjustmentLabels();
      saveCurrentParams();
    });
  }
  for (const input of document.querySelectorAll(".hsl-slider")) {
    input.addEventListener("input", saveCurrentParams);
  }
  dom.processBtn.addEventListener("click", processAll);
  dom.downloadBtn.addEventListener("click", () => {
    if (state.activeOutput) downloadUrl(state.activeOutput.url, state.activeOutput.name);
  });
  dom.downloadAllBtn.addEventListener("click", () => {
    for (const output of state.outputs) downloadUrl(output.url, output.name);
  });
}

bindEvents();
refreshFileLists();
