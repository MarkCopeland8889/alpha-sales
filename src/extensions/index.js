// Extension copies live in Software/Extension Copies/<Chrome|Firefox>/ and are
// installed into profiles. A profile lists the extensions it uses (profile.json),
// and each browser launcher loads them in the way that browser supports:
//   Chrome                      unpacked folders, loaded over the DevTools pipe (Extensions.loadUnpacked)
//   Firefox / Invisible         signed .xpi copied into <profile>/extensions/<addon id>.xpi
//   Camoufox / VulpineOS        unpacked folders passed as Camoufox "addons"
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PATHS, ensureDir, readJson, safeName } from '../core/paths.js';
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

// Adds an extension copy from a folder, .crx, .zip or .xpi file.
export function addExtension(kind, sourcePath, name) {
  const target = kind === 'chrome' ? 'Chrome' : 'Firefox';
  const base = safeName(name || path.basename(sourcePath).replace(/\.(crx|zip|xpi)$/i, ''));
  const dest = path.join(dirFor(target), base);
  const st = fs.statSync(sourcePath);
  if (st.isDirectory()) {
    fs.cpSync(sourcePath, dest, { recursive: true });
  } else if (target === 'Chrome') {
    // Chrome needs an unpacked folder.
    const zip = new AdmZip(crxToZipBuffer(fs.readFileSync(sourcePath)));
    zip.extractAllTo(dest, true);
  } else {
    fs.copyFileSync(sourcePath, `${dest}.xpi`);
  }
  log.ok(`Added ${kind} extension "${base}"`);
  return findExtension(target.toLowerCase(), base);
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
