import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createBdd, test as base } from 'playwright-bdd';
import { compactTrace } from './compact-trace-screencast.ts';

const require = createRequire(import.meta.url);
const playwrightCoreDir = path.dirname(require.resolve('playwright-core/package.json'));
const { jpegjs } = require(path.join(playwrightCoreDir, 'lib/utilsBundle.js'));
const { yazl } = require(path.join(playwrightCoreDir, 'lib/zipBundle.js'));
const { ZipFile } = require(path.join(playwrightCoreDir, 'lib/server/utils/zipFile.js'));

const WIDTH = 80;
const HEIGHT = 45;
const BLUE = [60, 120, 180];
const WHITE = [255, 255, 255];

export const test = base.extend({
  recording: async ({ $testInfo }, use) => {
    await use({ file: $testInfo.outputPath('trace.zip'), frames: [] });
  },
});

const { Given, When, Then } = createBdd(test);

Given('the screencast has a still screen with two nearly identical screenshots in a row', async ({ recording }) => {
  recording.frames = ['idle-1.jpeg', 'idle-2.jpeg'];
  await writeTrace(recording.file, [frame('idle-1.jpeg', 1000), frame('idle-2.jpeg', 1300)], {
    'idle-1.jpeg': image(BLUE),
    'idle-2.jpeg': image(BLUE),
  });
});

Given('the screencast has two screenshots taken while I press a button', async ({ recording }) => {
  recording.frames = ['press-1.jpeg', 'press-2.jpeg'];
  await writeTrace(
    recording.file,
    [
      { type: 'before', callId: 'action@1', startTime: 1000 },
      frame('press-1.jpeg', 1100),
      frame('press-2.jpeg', 1200),
      { type: 'after', callId: 'action@1', endTime: 1300, annotations: [] },
    ],
    { 'press-1.jpeg': image(BLUE), 'press-2.jpeg': image(BLUE) },
  );
});

Given('the screencast has two screenshots where the second one has one extra line of text', async ({ recording }) => {
  recording.frames = ['before-text.jpeg', 'after-text.jpeg'];
  await writeTrace(recording.file, [frame('before-text.jpeg', 1000), frame('after-text.jpeg', 1300)], {
    'before-text.jpeg': image(BLUE),
    'after-text.jpeg': image(BLUE, { x: 18, y: 16, width: 28, height: 8 }),
  });
});

Given('the screencast has two screenshots that look completely different', async ({ recording }) => {
  recording.frames = ['blue.jpeg', 'white.jpeg'];
  await writeTrace(recording.file, [frame('blue.jpeg', 1000), frame('white.jpeg', 1300)], {
    'blue.jpeg': image(BLUE),
    'white.jpeg': image(WHITE),
  });
});

When('I compact the screencast', async ({ recording }) => {
  await compactTrace(recording.file);
});

Then('only one screenshot of that stretch is left', async ({ recording }) => {
  expect(await remainingFrames(recording.file)).toHaveLength(1);
});

Then(/^both screenshots (?:taken while pressing )?are still there$/, async ({ recording }) => {
  expect(await remainingFrames(recording.file)).toEqual(recording.frames);
});

function frame(sha1, timestamp) {
  return { type: 'screencast-frame', pageId: 'page@1', sha1, width: 800, height: 450, timestamp };
}

function image(color, textLine) {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) data.set([...color, 255], i * 4);
  if (textLine) {
    for (let y = textLine.y; y < textLine.y + textLine.height; y++) {
      for (let x = textLine.x; x < textLine.x + textLine.width; x++) data.set([20, 20, 20], (y * WIDTH + x) * 4);
    }
  }
  return Buffer.from(jpegjs.encode({ data, width: WIDTH, height: HEIGHT }, 90).data);
}

async function writeTrace(file, events, images) {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(`${events.map((e) => JSON.stringify(e)).join('\n')}\n`), '0-trace.trace');
  zip.addBuffer(Buffer.from(''), '0-trace.network');
  for (const [name, buffer] of Object.entries(images)) zip.addBuffer(buffer, `resources/${name}`);
  zip.end();
  const stream = fs.createWriteStream(file);
  zip.outputStream.pipe(stream);
  await new Promise((resolve, reject) => {
    stream.on('close', resolve);
    stream.on('error', reject);
  });
}

async function remainingFrames(file) {
  const zip = new ZipFile(file);
  try {
    const entries = await zip.entries();
    const events = (await zip.read('0-trace.trace')).toString('utf8').trim().split('\n').map(JSON.parse);
    return events
      .filter((e) => e.type === 'screencast-frame' && entries.includes(`resources/${e.sha1}`))
      .map((e) => e.sha1);
  } finally {
    zip.close();
  }
}
