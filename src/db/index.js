// Database entry point: Supabase when configured, otherwise the local JSON store.
//   import { db } from '../db/index.js';
//   await db.select('devices', { account_id });
import { config } from '../core/env.js';
import { localDb } from './local.js';
import { supabaseDb } from './supabase.js';

export const db = new Proxy({}, {
  get(_t, prop) {
    const impl = config.useSupabase ? supabaseDb : localDb;
    const v = impl[prop];
    return typeof v === 'function' ? v.bind(impl) : v;
  },
});
