import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestamped, pickModel } from '../src/ai/whisper.js';

test('whisper: timestamped lines become segments', () => {
  const out = 'whisper_init: loading model\n[00:00:00.000 --> 00:00:02.500]   Hi, I need a bookkeeper.\n[00:00:02.500 --> 00:01:04.000]  For my bakery.\n[1:00:00,000 --> 1:00:01,000] Late.\n';
  assert.deepEqual(parseTimestamped(out), [
    { start: 0, end: 2.5, text: 'Hi, I need a bookkeeper.' },
    { start: 2.5, end: 64, text: 'For my bakery.' },
    { start: 3600, end: 3601, text: 'Late.' },
  ]);
});

test('whisper: models are picked by name, plain before quantized before variants', () => {
  const files = ['C:/m/ggml-base.en-q8_0.bin', 'C:/m/ggml-base-q8_0.bin', 'C:/m/ggml-tiny.en-q5_1.bin', 'C:/m/ggml-tiny.bin'];
  assert.equal(pickModel(files, 'base'), 'C:/m/ggml-base-q8_0.bin');
  assert.equal(pickModel(files, 'base.en'), 'C:/m/ggml-base.en-q8_0.bin');
  assert.equal(pickModel(files, 'tiny'), 'C:/m/ggml-tiny.bin');
  assert.equal(pickModel(files, 'tiny.en'), 'C:/m/ggml-tiny.en-q5_1.bin');
  assert.equal(pickModel(files, 'medium'), null);
});
