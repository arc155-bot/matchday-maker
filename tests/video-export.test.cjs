const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.Mediabunny = require('../vendor/mediabunny-1.61.3.min.js');
const { inspectMP4 } = require('../video-export.js');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/complete-11.2s.mp4'));
const expected = { duration: 11.2, frameCount: 336, fps: 30 };
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// This tiny, decodable H.264 fixture contains 336 frames at 30 fps. Altering
// container headers recreates a file that plays fully but declares only 4 s.
function shortenHeader(bytes, boxName) {
  const copy = Buffer.from(bytes);
  const typeOffset = copy.indexOf(Buffer.from(boxName));
  assert.ok(typeOffset >= 0, `fixture has ${boxName}`);
  const payload = typeOffset + 4;
  assert.equal(copy[payload], 0, 'fixture uses a version 0 time header');
  const timescale = boxName === 'tkhd'
    ? copy.readUInt32BE(copy.indexOf(Buffer.from('mvhd')) + 4 + 12)
    : copy.readUInt32BE(payload + 12);
  copy.writeUInt32BE(4 * timescale, payload + (boxName === 'tkhd' ? 20 : 16));
  return copy;
}

test('a complete MP4 has matching file, track and packet durations', async () => {
  const result = await inspectMP4(arrayBuffer(fixture), expected);
  assert.equal(result.duration, 11.2);
  assert.equal(result.frameCount, 336);
});

for (const box of ['mvhd', 'tkhd', 'mdhd']) {
  test(`a 4-second ${box} header cannot hide the remaining video`, async () => {
    await assert.rejects(inspectMP4(arrayBuffer(shortenHeader(fixture, box)), expected), /unvollständige Zeitangaben/);
  });
}

test('an incomplete frame sequence is rejected even with the expected duration', async () => {
  await assert.rejects(inspectMP4(arrayBuffer(fixture), { ...expected, frameCount: 337 }), /unvollständige Zeitangaben/);
});
