import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightCoreDir = path.dirname(require.resolve('playwright-core/package.json'));
const { jpegjs } = require(path.join(playwrightCoreDir, 'lib/utilsBundle.js'));
const { yazl } = require(path.join(playwrightCoreDir, 'lib/zipBundle.js'));
const { ZipFile } = require(path.join(playwrightCoreDir, 'lib/server/utils/zipFile.js'));

const ACTION_MARGIN_MS = Number(process.env.TRACE_COMPACT_ACTION_MARGIN_MS ?? 1000);
const HASH_WIDTH = 80;
const HASH_HEIGHT = 45;
const TILE_WIDTH = 16;
const TILE_HEIGHT = 9;
const SIMILARITY_CHANGED_TILE_RATIO = Number(process.env.TRACE_COMPACT_CHANGED_TILE_RATIO ?? 0.12);
const SIMILARITY_TILE_SSIM_THRESHOLD = Number(process.env.TRACE_COMPACT_TILE_SSIM_THRESHOLD ?? 0.95);
const SIMILARITY_TILE_DELTA_THRESHOLD = Number(process.env.TRACE_COMPACT_TILE_DELTA_THRESHOLD ?? 8);

type TraceEvent = {
  type?: string;
  callId?: string;
  startTime?: number;
  endTime?: number;
  sha1?: string;
  timestamp?: number;
  pageId?: string;
};

type ScreencastFrame = {
  entryName: string;
  index: number;
  event: TraceEvent & { sha1: string; timestamp: number };
};

async function main() {
  const args = process.argv.slice(2);
  const targets = args.length ? args : ['test-results', 'playwright-report'];
  const traceFiles = [];
  for (const target of targets) {
    if (fs.existsSync(target)) traceFiles.push(...findTraceFiles(target));
  }

  let totalOriginalBytes = 0;
  let totalCompactedBytes = 0;
  let totalFrames = 0;
  let totalDroppedFrames = 0;

  for (const traceFile of traceFiles) {
    const result = await compactTrace(traceFile);
    if (!result) continue;
    totalOriginalBytes += result.originalBytes;
    totalCompactedBytes += result.compactedBytes;
    totalFrames += result.frames;
    totalDroppedFrames += result.droppedFrames;
    const savedPercent = percent(result.originalBytes - result.compactedBytes, result.originalBytes);
    console.log(
      `[trace-compact] ${traceFile}: ${result.originalBytes} -> ${result.compactedBytes} bytes, ` +
        `${result.droppedFrames}/${result.frames} screencast frames removed, saved ${savedPercent}%`,
    );
  }

  if (traceFiles.length) {
    console.log(
      `[trace-compact] total: ${totalOriginalBytes} -> ${totalCompactedBytes} bytes, ` +
        `${totalDroppedFrames}/${totalFrames} screencast frames removed, saved ${percent(totalOriginalBytes - totalCompactedBytes, totalOriginalBytes)}%`,
    );
  } else {
    console.log('[trace-compact] no trace.zip files found');
  }
}

function findTraceFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return path.extname(target) === '.zip' ? [target] : [];

  const results = [];
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && path.extname(entry.name) === '.zip') results.push(fullPath);
    }
  }
  return results;
}

async function compactTrace(traceFile) {
  const originalBytes = fs.statSync(traceFile).size;
  const entries = await readZipEntries(traceFile);
  const traceEntryNames = [...entries.keys()].filter((name) => name.endsWith('.trace'));
  if (!traceEntryNames.length) return;

  const traceLines = new Map<string, string[]>();
  const actionIntervals: [number, number][] = [];
  const actionStarts = new Map<string, number>();
  const frames: ScreencastFrame[] = [];

  for (const entryName of traceEntryNames) {
    const lines = entries.get(entryName).toString('utf8').split(/\n/).filter(Boolean);
    traceLines.set(entryName, lines);

    for (let index = 0; index < lines.length; index++) {
      let event: TraceEvent;
      try {
        event = JSON.parse(lines[index]) as TraceEvent;
      } catch {
        continue;
      }

      if (event.type === 'before' && event.callId && typeof event.startTime === 'number')
        actionStarts.set(event.callId, event.startTime);
      else if (event.type === 'after' && event.callId && typeof event.endTime === 'number') {
        const startTime = actionStarts.get(event.callId);
        if (typeof startTime === 'number') {
          actionIntervals.push([startTime - ACTION_MARGIN_MS, startTime + ACTION_MARGIN_MS]);
          actionIntervals.push([event.endTime - ACTION_MARGIN_MS, event.endTime + ACTION_MARGIN_MS]);
        }
      } else if (event.type === 'screencast-frame' && event.sha1 && typeof event.timestamp === 'number') {
        frames.push({
          entryName,
          index,
          event: event as TraceEvent & { sha1: string; timestamp: number },
        });
      }
    }
  }

  if (!frames.length)
    return {
      originalBytes,
      compactedBytes: originalBytes,
      frames: 0,
      droppedFrames: 0,
    };

  actionIntervals.sort((a, b) => a[0] - b[0]);
  const mergedActionIntervals = mergeIntervals(actionIntervals);
  const framesByPage = new Map<string, ScreencastFrame[]>();
  for (const frame of frames) {
    const pageId = frame.event.pageId ?? 'default';
    const pageFrames = framesByPage.get(pageId) ?? [];
    pageFrames.push(frame);
    framesByPage.set(pageId, pageFrames);
  }

  const droppedSha1s = new Set();
  for (const pageFrames of framesByPage.values()) {
    pageFrames.sort((a, b) => b.event.timestamp - a.event.timestamp);
    let nextKeptFingerprint: FrameFingerprint | undefined;

    for (const frame of pageFrames) {
      const resourceName = `resources/${frame.event.sha1}`;
      const resource = entries.get(resourceName);
      if (!resource) continue;

      const fingerprint = jpegFingerprint(resource);
      const protectedFrame = isWithinIntervals(frame.event.timestamp, mergedActionIntervals);
      if (protectedFrame) {
        nextKeptFingerprint = undefined;
        continue;
      }

      if (nextKeptFingerprint && isVisuallySimilar(fingerprint, nextKeptFingerprint)) {
        droppedSha1s.add(frame.event.sha1);
        continue;
      }

      nextKeptFingerprint = fingerprint;
    }
  }

  if (!droppedSha1s.size)
    return {
      originalBytes,
      compactedBytes: originalBytes,
      frames: frames.length,
      droppedFrames: 0,
    };

  for (const [entryName, lines] of traceLines) {
    const compactedLines: string[] = [];
    for (const line of lines) {
      let event: TraceEvent;
      try {
        event = JSON.parse(line) as TraceEvent;
      } catch {
        compactedLines.push(line);
        continue;
      }
      if (event.type === 'screencast-frame' && droppedSha1s.has(event.sha1)) continue;
      compactedLines.push(line);
    }
    entries.set(entryName, Buffer.from(`${compactedLines.join('\n')}\n`));
  }

  for (const sha1 of droppedSha1s) entries.delete(`resources/${sha1}`);

  const tempFile = `${traceFile}.compact-${process.pid}.tmp`;
  await writeZipEntries(tempFile, entries);
  fs.renameSync(tempFile, traceFile);
  return {
    originalBytes,
    compactedBytes: fs.statSync(traceFile).size,
    frames: frames.length,
    droppedFrames: droppedSha1s.size,
  };
}

async function readZipEntries(fileName) {
  const zipFile = new ZipFile(fileName);
  try {
    const entries = new Map();
    for (const entryName of await zipFile.entries()) entries.set(entryName, await zipFile.read(entryName));
    return entries;
  } finally {
    zipFile.close();
  }
}

async function writeZipEntries(fileName, entries) {
  await fs.promises.mkdir(path.dirname(fileName), { recursive: true });
  const zipFile = new yazl.ZipFile();
  const stream = fs.createWriteStream(fileName);
  const done = new Promise<void>((resolve, reject) => {
    zipFile.on('error', reject);
    stream.on('close', () => resolve());
    stream.on('error', reject);
  });
  for (const [entryName, buffer] of entries) zipFile.addBuffer(buffer, entryName);
  zipFile.end();
  zipFile.outputStream.pipe(stream);
  await done;
}

type FrameFingerprint = {
  gray: Uint8Array;
};

function jpegFingerprint(buffer): FrameFingerprint {
  const image = jpegjs.decode(buffer, { useTArray: true });
  const gray = new Uint8Array(HASH_WIDTH * HASH_HEIGHT);
  for (let y = 0; y < HASH_HEIGHT; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / HASH_HEIGHT));
    for (let x = 0; x < HASH_WIDTH; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / HASH_WIDTH));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      gray[y * HASH_WIDTH + x] = Math.round(
        image.data[sourceOffset] * 0.299 + image.data[sourceOffset + 1] * 0.587 + image.data[sourceOffset + 2] * 0.114,
      );
    }
  }
  return { gray: gaussianBlur(gray) };
}

function isVisuallySimilar(a: FrameFingerprint, b: FrameFingerprint) {
  let changedTiles = 0;
  let tileCount = 0;

  for (let y = 0; y < HASH_HEIGHT; y += TILE_HEIGHT) {
    for (let x = 0; x < HASH_WIDTH; x += TILE_WIDTH) {
      const tile = tileDifference(a, b, x, y);
      tileCount++;
      if (tile.ssim < SIMILARITY_TILE_SSIM_THRESHOLD && tile.meanGray > SIMILARITY_TILE_DELTA_THRESHOLD) changedTiles++;
    }
  }

  const changedTileRatio = changedTiles / tileCount;
  return changedTileRatio <= SIMILARITY_CHANGED_TILE_RATIO;
}

function tileDifference(a: FrameFingerprint, b: FrameFingerprint, startX: number, startY: number) {
  let grayTotal = 0;
  let sumA = 0;
  let sumB = 0;
  let count = 0;
  for (let y = startY; y < Math.min(startY + TILE_HEIGHT, HASH_HEIGHT); y++) {
    for (let x = startX; x < Math.min(startX + TILE_WIDTH, HASH_WIDTH); x++) {
      const offset = y * HASH_WIDTH + x;
      const aValue = a.gray[offset];
      const bValue = b.gray[offset];
      grayTotal += Math.abs(aValue - bValue);
      sumA += aValue;
      sumB += bValue;
      count++;
    }
  }

  const meanA = sumA / count;
  const meanB = sumB / count;
  let varianceA = 0;
  let varianceB = 0;
  let covariance = 0;
  for (let y = startY; y < Math.min(startY + TILE_HEIGHT, HASH_HEIGHT); y++) {
    for (let x = startX; x < Math.min(startX + TILE_WIDTH, HASH_WIDTH); x++) {
      const offset = y * HASH_WIDTH + x;
      const aDelta = a.gray[offset] - meanA;
      const bDelta = b.gray[offset] - meanB;
      varianceA += aDelta * aDelta;
      varianceB += bDelta * bDelta;
      covariance += aDelta * bDelta;
    }
  }

  varianceA /= count;
  varianceB /= count;
  covariance /= count;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return {
    meanGray: grayTotal / count,
    ssim:
      ((2 * meanA * meanB + c1) * (2 * covariance + c2)) /
      ((meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2)),
  };
}

function gaussianBlur(gray: Uint8Array) {
  const blurred = new Uint8Array(gray.length);
  for (let y = 0; y < HASH_HEIGHT; y++) {
    for (let x = 0; x < HASH_WIDTH; x++) {
      let weightedTotal = 0;
      let weightTotal = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const sourceX = Math.min(HASH_WIDTH - 1, Math.max(0, x + offsetX));
          const sourceY = Math.min(HASH_HEIGHT - 1, Math.max(0, y + offsetY));
          const weight = offsetX === 0 && offsetY === 0 ? 4 : offsetX === 0 || offsetY === 0 ? 2 : 1;
          weightedTotal += gray[sourceY * HASH_WIDTH + sourceX] * weight;
          weightTotal += weight;
        }
      }
      blurred[y * HASH_WIDTH + x] = Math.round(weightedTotal / weightTotal);
    }
  }
  return blurred;
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of intervals) {
    if (!merged.length || interval[0] > merged[merged.length - 1][1]) merged.push([...interval]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], interval[1]);
  }
  return merged;
}

function isWithinIntervals(value, intervals) {
  let left = 0;
  let right = intervals.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const [start, end] = intervals[mid];
    if (value < start) right = mid - 1;
    else if (value > end) left = mid + 1;
    else return true;
  }
  return false;
}

function percent(part, total) {
  return total ? ((part * 100) / total).toFixed(1) : '0.0';
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain)
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });

export { compactTrace };
