// Extension copies live in Software/Extension Copies/<Chrome|Firefox>/ and are
// installed into profiles. A profile lists the extensions it uses (profile.json),
// and each browser launcher loads them in the way that browser supports:
//   Chrome                      unpacked folders, loaded over the DevTools pipe (Extensions.loadUnpacked)
//   Firefox / Invisible         signed .xpi copied into <profile>/extensions/<addon id>.xpi
//   Camoufox / VulpineOS        unpacked folders passed as Camoufox "addons"
//
// Default extensions (Configurations/extension-defaults.json) are added to every new profile
// of that kind. Chrome Web Store extensions can be fetched by id and keep their store id.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { PATHS, ensureDir, readJson, writeJson, safeName } from '../core/paths.js';
import { logger } from '../core/logbook.js';

const log = logger('extensions');
export const EXT_KIND = { chrome: 'Chrome', firefox: 'Firefox', camoufox: 'Firefox', vulpineos: 'Firefox', invisible: 'Firefox' };

const dirFor = (kind) => ensureDir(path.join(PATHS.extensionCopies, kind));
const unpackedCache = () => ensureDir(path.join(PATHS.extensionCopies, 'Firefox', '.unpacked'));

function manifestOf(entryPath) {
  try {
    if (fs.statSync(entryPath).isDirectory()) return readJson(path.join(entryPath, 'manifest.json'), null);
    const zip = new AdmZip(entryPath);
    const m = zip.getEntry('manifest.json');
    return m ? JSON.parse(zip.readAsText(m)) : null;
  } catch {
    return null;
  }
}

function geckoId(manifest) {
  return manifest?.browser_specific_settings?.gecko?.id || manifest?.applications?.gecko?.id || null;
}

const DEFAULTS_FILE = () => path.join(PATHS.configurations, 'extension-defaults.json');

export function defaultExtensions(kind) {
  const all = readJson(DEFAULTS_FILE(), {});
  return (all[kind] || []).filter((n) => findExtension(kind, n));
}

export function setDefaultExtension(kind, name, on = true) {
  const all = readJson(DEFAULTS_FILE(), {});
  const list = new Set(all[kind] || []);
  if (on) list.add(name);
  else list.delete(name);
  all[kind] = [...list];
  writeJson(DEFAULTS_FILE(), all);
  log.ok(`${on ? 'Added' : 'Removed'} "${name}" ${on ? 'to' : 'from'} the default ${kind} extensions`);
  return all[kind];
}

export function listExtensions() {
  const out = [];
  for (const kind of ['Chrome', 'Firefox']) {
    const dir = dirFor(kind);
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const manifest = manifestOf(full);
      if (!manifest) continue;
      out.push({
        kind: kind.toLowerCase(),
        name: name.replace(/\.(xpi|zip)$/i, ''),
        file: name,
        path: full,
        title: manifest.name,
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
        geckoId: geckoId(manifest),
        default: (readJson(DEFAULTS_FILE(), {})[kind.toLowerCase()] || []).includes(name.replace(/\.(xpi|zip)$/i, '')),
      });
    }
  }
  return out;
}

export function findExtension(kind, name) {
  return listExtensions().find((e) => e.kind === kind && (e.name === name || e.file === name)) || null;
}

// Strips the CRX3 header so a .crx can be unzipped.
function crxToZipBuffer(buf) {
  if (buf.subarray(0, 4).toString() !== 'Cr24') return buf;
  const version = buf.readUInt32LE(4);
  const offset = version === 3 ? 12 + buf.readUInt32LE(8) : 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
  return buf.subarray(offset);
}

// ---- CRX3 header: the public key, so an unpacked copy keeps the Web Store extension id ----
function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

function protoFields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      out.push([field, buf.subarray(pos, pos + len)]);
      pos += len;
    } else if (wire === 0) [, pos] = readVarint(buf, pos);
    else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else break;
  }
  return out;
}

// Chrome extension ids are the first 16 bytes of a SHA-256, written with the letters a-p.
export const extensionIdFromBytes = (b) => [...b.subarray(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('').replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

export function crxPublicKey(buf) {
  if (buf.subarray(0, 4).toString() !== 'Cr24' || buf.readUInt32LE(4) !== 3) return null;
  const fields = protoFields(buf.subarray(12, 12 + buf.readUInt32LE(8)));
  const signed = fields.find(([f]) => f === 10000);
  const crxId = signed ? protoFields(signed[1]).find(([f]) => f === 1)?.[1] : null;
  for (const [f, proof] of fields) {
    if (f !== 2 && f !== 3) continue;
    const key = protoFields(proof).find(([g]) => g === 1)?.[1];
    if (!key) continue;
    const id = extensionIdFromBytes(crypto.createHash('sha256').update(key).digest());
    if (!crxId || id === extensionIdFromBytes(crxId)) return { key: key.toString('base64'), id };
  }
  return null;
}

// Adds an extension copy from a folder, .crx, .zip or .xpi file.
export function addExtension(kind, sourcePath, name) {
  const target = kind === 'chrome' ? 'Chrome' : 'Firefox';
  const base = safeName(name || path.basename(sourcePath).replace(/\.(crx|zip|xpi)$/i, ''));
  const dest = path.join(dirFor(target), base);
  const st = fs.statSync(sourcePath);
  if (st.isDirectory()) {
    fs.cpSync(sourcePath, dest, { recursive: true });
  } else if (target === 'Chrome') {
    // Chrome needs an unpacked folder. Chrome refuses unpacked folders with _metadata, and the
    // store key goes into the manifest so the extension keeps its Web Store id.
    const buf = fs.readFileSync(sourcePath);
    const zip = new AdmZip(crxToZipBuffer(buf));
    zip.extractAllTo(dest, true);
    fs.rmSync(path.join(dest, '_metadata'), { recursive: true, force: true });
    const signer = crxPublicKey(buf);
    const manifestFile = path.join(dest, 'manifest.json');
    if (signer && fs.existsSync(manifestFile)) {
      const manifest = readJson(manifestFile, {});
      if (!manifest.key) writeJson(manifestFile, { ...manifest, key: signer.key });
    }
  } else {
    fs.copyFileSync(sourcePath, `${dest}.xpi`);
  }
  log.ok(`Added ${kind} extension "${base}"`);
  return findExtension(target.toLowerCase(), base);
}

// Downloads an extension from the Chrome Web Store by id (or store URL) and adds it.
export async function addFromWebStore(idOrUrl, name, { chromeVersion = '140.0.0.0' } = {}) {
  const id = (String(idOrUrl).match(/[a-p]{32}/) || [])[0];
  if (!id) throw new Error('Give a Chrome Web Store extension id (32 letters a-p) or its store link');
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Chrome Web Store download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString() !== 'Cr24') throw new Error('The Chrome Web Store did not return an extension file (is the id right?)');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-crx-')), `${id}.crx`);
  fs.writeFileSync(tmp, buf);
  try {
    const ext = addExtension('chrome', tmp, name || id);
    log.ok(`Added "${ext.title}" ${ext.version} from the Chrome Web Store`);
    return ext;
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

export function removeExtension(kind, name) {
  const ext = findExtension(kind, name);
  if (!ext) throw new Error('Extension not found');
  fs.rmSync(ext.path, { recursive: true, force: true });
  log.ok(`Removed ${kind} extension "${name}"`);
}

// Chrome: absolute paths of unpacked extension folders for a profile's extension list.
export function chromeExtensionPaths(names = []) {
  return names.map((n) => {
    const ext = findExtension('chrome', n);
    if (!ext) throw new Error(`Chrome extension "${n}" is not in Software/Extension Copies/Chrome`);
    return ext.path;
  });
}

// Camoufox/VulpineOS: unpacked folders (xpi files are extracted once into a cache).
export function firefoxAddonFolders(names = []) {
  return names.map((n) => {
    const ext = findExtension('firefox', n);
    if (!ext) throw new Error(`Firefox extension "${n}" is not in Software/Extension Copies/Firefox`);
    if (fs.statSync(ext.path).isDirectory()) return ext.path;
    const out = path.join(unpackedCache(), ext.name);
    if (!fs.existsSync(path.join(out, 'manifest.json'))) new AdmZip(ext.path).extractAllTo(out, true);
    return out;
  });
}

// Firefox / Invisible Playwright: copy signed .xpi files into the profile's extensions folder.
// Returns the prefs needed so Firefox enables sideloaded add-ons without asking.
export function installXpisIntoProfile(profilePath, names = []) {
  if (!names.length) return {};
  const extDir = ensureDir(path.join(profilePath, 'extensions'));
  for (const n of names) {
    const ext = findExtension('firefox', n);
    if (!ext) throw new Error(`Firefox extension "${n}" is not in Software/Extension Copies/Firefox`);
    if (!ext.geckoId) throw new Error(`Firefox extension "${n}" has no add-on id in its manifest; use a signed .xpi from addons.mozilla.org`);
    const dest = path.join(extDir, `${ext.geckoId}.xpi`);
    if (fs.statSync(ext.path).isDirectory()) {
      const zip = new AdmZip();
      zip.addLocalFolder(ext.path);
      zip.writeZip(dest);
    } else {
      fs.copyFileSync(ext.path, dest);
    }
  }
  return {
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'xpinstall.signatures.required': false,
  };
}
