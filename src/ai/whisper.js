// Speech to text with Whisper. Uses GPU Whisper (Windows, Software > Whisper on the GPU) when it
// is installed, otherwise the CPU copy (Software > Whisper).
//
//   const { text, segments, engine } = await transcribe('clip.mp4', { model: 'base' });
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, IS_WINDOWS } from '../core/commands.js';
import { SOFTWARE } from '../core/paths.js';
import { uid } from '../core/utils.js';
import { whisperGpuExe, whisperGpuModels } from '../software/index.js';

// "[00:00:01.000 --> 00:00:04.500]  Hello" (whisper.cpp style; hours are optional)
const LINE = /^\s*\[((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\s*-->\s*((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\]\s*(.*)$/;
const seconds = (t) => t.replace(',', '.').split(':').reduce((acc, part) => acc * 60 + Number(part), 0);

export function parseTimestamped(stdout) {
  const segments = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m && m[3].trim()) segments.push({ start: seconds(m[1]), end: seconds(m[2]), text: m[3].trim() });
  }
  return segments;
}

// Picks a ggml model file by name: "base" prefers ggml-base.bin, then a quantized ggml-base-q8_0.bin,
// then anything starting with ggml-base (such as ggml-base.en).
export function pickModel(files, name) {
  const n = String(name).toLowerCase();
  const base = (f) => path.basename(f).toLowerCase();
  return files.find((f) => base(f) === `ggml-${n}.bin`)
    || files.find((f) => base(f).startsWith(`ggml-${n}-`))
    || files.find((f) => base(f).startsWith(`ggml-${n}`))
    || null;
}

async function onGpu(file, { model, language }) {
  const models = whisperGpuModels();
  const modelFile = pickModel(models, model);
  if (!modelFile) throw new Error(`No ggml model named "${model}" for GPU Whisper. Available: ${models.map((m) => path.basename(m)).join(', ') || 'none'}`);
  const exe = whisperGpuExe();
  const res = await run(exe, ['-m', modelFile, '-f', file, '-l', language], { cwd: path.dirname(exe), timeout: 60 * 60000 });
  if (!res.ok) throw new Error(`GPU Whisper failed (exit ${res.code}): ${(res.stderr || res.stdout).slice(-800)}`);
  const segments = parseTimestamped(res.stdout);
  const text = segments.length ? segments.map((s) => s.text).join(' ') : res.stdout.trim();
  return { text, segments, engine: 'gpu', model: path.basename(modelFile) };
}

async function onCpu(file, { model, language }) {
  const bin = path.join(SOFTWARE.whisper, 'venv', IS_WINDOWS ? 'Scripts' : 'bin');
  const exe = path.join(bin, IS_WINDOWS ? 'whisper.exe' : 'whisper');
  if (!fs.existsSync(exe)) throw new Error('Whisper is not installed. Use Software > Whisper (or Whisper on the GPU on Windows).');
  // ggml names such as "base.en-q8_0" map to the plain model name.
  const name = String(model).replace(/^ggml-/, '').replace(/-q\d.*$/, '').replace(/\.bin$/, '');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `alpha-whisper-${uid()}-`));
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  try {
    const res = await run(exe, [file, '--model', name, '--language', language, '--output_format', 'json', '--output_dir', out, '--verbose', 'False'], {
      env: { [pathKey]: `${bin}${path.delimiter}${process.env[pathKey] || ''}` }, // ffmpeg sits next to whisper
      timeout: 60 * 60000,
    });
    if (!res.ok) throw new Error(`Whisper failed (exit ${res.code}): ${(res.stderr || res.stdout).slice(-800)}`);
    const json = fs.readdirSync(out).find((f) => f.endsWith('.json'));
    if (!json) throw new Error('Whisper finished without writing a transcript');
    const data = JSON.parse(fs.readFileSync(path.join(out, json), 'utf8'));
    return { text: String(data.text || '').trim(), segments: (data.segments || []).map((s) => ({ start: s.start, end: s.end, text: String(s.text).trim() })), engine: 'cpu', model: name };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

export function whisperEngines() {
  return { gpu: Boolean(whisperGpuExe() && whisperGpuModels().length), cpu: fs.existsSync(path.join(SOFTWARE.whisper, 'venv', IS_WINDOWS ? 'Scripts' : 'bin', IS_WINDOWS ? 'whisper.exe' : 'whisper')) };
}

// engine: auto (GPU when installed) | gpu | cpu
export async function transcribe(file, { model = 'base', language = 'en', engine = 'auto' } = {}) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const abs = path.resolve(file);
  const useGpu = engine === 'gpu' || (engine === 'auto' && whisperEngines().gpu);
  const started = Date.now();
  const res = useGpu ? await onGpu(abs, { model, language }) : await onCpu(abs, { model, language });
  return { ...res, ms: Date.now() - started };
}
