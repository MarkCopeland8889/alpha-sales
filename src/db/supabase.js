// Supabase adapter (online DB). Uses the logged-in user's session, so row-level
// security in supabase/schema.sql keeps every account's rows private.
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from '../core/env.js';
import { PATHS, readJson, writeJson } from '../core/paths.js';

const AUTH_FILE = path.join(PATHS.state, 'supabase-auth.json');

// Session storage for supabase-js in Node: a small JSON file (never synced to Drive).
const fileStorage = {
  getItem: (key) => readJson(AUTH_FILE, {})[key] ?? null,
  setItem: (key, value) => {
    const all = readJson(AUTH_FILE, {});
    all[key] = value;
    writeJson(AUTH_FILE, all);
  },
  removeItem: (key) => {
    const all = readJson(AUTH_FILE, {});
    delete all[key];
    writeJson(AUTH_FILE, all);
  },
};

let client = null;
export function supabase() {
  if (!config.useSupabase) throw new Error('Supabase is not configured (set SUPABASE_URL and SUPABASE_ANON_KEY)');
  client ||= createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      flowType: 'pkce',
      storage: fileStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

function applyMatch(q, match = {}) {
  for (const [k, v] of Object.entries(match)) {
    if (Array.isArray(v)) q = q.in(k, v);
    else if (v === null) q = q.is(k, null);
    else q = q.eq(k, v);
  }
  return q;
}

function check({ data, error }, what) {
  if (error) throw new Error(`Supabase ${what} failed: ${error.message}`);
  return data;
}

export const supabaseDb = {
  mode: 'supabase',

  async select(table, match = {}, { order = 'created_at', desc = false, limit } = {}) {
    let q = applyMatch(supabase().from(table).select('*'), match);
    if (order) q = q.order(order, { ascending: !desc });
    if (limit) q = q.limit(limit);
    return check(await q, `select ${table}`) ?? [];
  },

  async get(table, id) {
    return check(await supabase().from(table).select('*').eq('id', id).maybeSingle(), `get ${table}`);
  },

  async insert(table, row) {
    return check(await supabase().from(table).insert(row).select().single(), `insert ${table}`);
  },

  async update(table, match, patch) {
    const q = applyMatch(supabase().from(table).update({ ...patch, updated_at: new Date().toISOString() }), match);
    return check(await q.select(), `update ${table}`) ?? [];
  },

  async upsert(table, row, conflict = ['id']) {
    const q = supabase().from(table).upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: conflict.join(',') });
    return check(await q.select().single(), `upsert ${table}`);
  },

  async remove(table, match) {
    const q = applyMatch(supabase().from(table).delete(), match);
    return (check(await q.select('id'), `delete ${table}`) ?? []).length;
  },

  // Realtime: calls fn(payload) on inserts/updates/deletes. Returns an unsubscribe function.
  subscribe(table, filter, fn) {
    const channel = supabase()
      .channel(`alpha-${table}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, fn)
      .subscribe();
    return () => supabase().removeChannel(channel);
  },
};
