// Local JSON database: one file per table under "Local Files/.alpha/db".
// Same interface as the Supabase adapter so the app runs fully offline.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, readJson, writeJson } from '../core/paths.js';

const DIR = path.join(PATHS.state, 'db');
const cache = new Map();

function load(table) {
  if (!cache.has(table)) cache.set(table, readJson(path.join(DIR, `${table}.json`), []));
  return cache.get(table);
}

function save(table) {
  writeJson(path.join(DIR, `${table}.json`), cache.get(table));
}

function matches(row, match) {
  return Object.entries(match || {}).every(([k, v]) => {
    if (Array.isArray(v)) return v.includes(row[k]);
    if (v === null) return row[k] == null;
    return row[k] === v;
  });
}

function sortRows(rows, order, desc) {
  if (!order) return rows;
  return [...rows].sort((a, b) => {
    const x = a[order] ?? '';
    const y = b[order] ?? '';
    return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
  });
}

export const localDb = {
  mode: 'local',

  async select(table, match = {}, { order = 'created_at', desc = false, limit } = {}) {
    let rows = sortRows(load(table).filter((r) => matches(r, match)), order, desc);
    if (limit) rows = rows.slice(0, limit);
    return structuredClone(rows);
  },

  async get(table, id) {
    const row = load(table).find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  },

  async insert(table, row) {
    const now = new Date().toISOString();
    const full = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...row };
    load(table).push(full);
    save(table);
    return structuredClone(full);
  },

  async update(table, match, patch) {
    const now = new Date().toISOString();
    const out = [];
    for (const row of load(table)) {
      if (matches(row, match)) {
        Object.assign(row, patch, { updated_at: now });
        out.push(structuredClone(row));
      }
    }
    if (out.length) save(table);
    return out;
  },

  async upsert(table, row, conflict = ['id']) {
    const key = Object.fromEntries(conflict.map((k) => [k, row[k]]));
    const hasKey = conflict.every((k) => row[k] !== undefined);
    if (hasKey) {
      const updated = await this.update(table, key, row);
      if (updated.length) return updated[0];
    }
    return this.insert(table, row);
  },

  async remove(table, match) {
    const rows = load(table);
    const keep = rows.filter((r) => !matches(r, match));
    const removed = rows.length - keep.length;
    cache.set(table, keep);
    if (removed) save(table);
    return removed;
  },

  // Local mode has no remote copy, so there is nothing to subscribe to.
  subscribe() {
    return () => {};
  },

  reset() {
    cache.clear();
    fs.rmSync(DIR, { recursive: true, force: true });
  },
};
