// Login. With Supabase configured: "Login with Google" (Supabase Auth, PKCE flow).
// Without it: an offline local account tied to this machine, so the app still works.
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../core/env.js';
import { PATHS, readJson, writeJson } from '../core/paths.js';
import { machineInfo } from '../core/machine.js';
import { logger } from '../core/logbook.js';
import { emit } from '../core/events.js';
import { supabase } from '../db/supabase.js';

const log = logger('auth');
const LOCAL_SESSION = path.join(PATHS.state, 'local-session.json');

let current = null; // { id, email, name, mode }

export function currentUser() {
  return current;
}

export function requireUser() {
  if (!current) {
    const err = new Error('Not logged in');
    err.status = 401;
    throw err;
  }
  return current;
}

export function authMode() {
  return config.useSupabase ? 'google' : 'local';
}

function fromSupabaseUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.user_metadata?.full_name || u.user_metadata?.name || u.email,
    avatar: u.user_metadata?.avatar_url || null,
    mode: 'google',
  };
}

// Restores a saved session on startup. Returns the user or null.
export async function restoreSession() {
  try {
    if (config.useSupabase) {
      const { data } = await supabase().auth.getSession();
      if (data?.session?.user) current = fromSupabaseUser(data.session.user);
    } else {
      current = readJson(LOCAL_SESSION, null);
    }
  } catch (err) {
    log.warn('Could not restore the saved login', err);
  }
  if (current) log.ok(`Signed in as ${current.email}`);
  return current;
}

// Step 1 of Google login: returns the Google consent URL the browser should open.
export async function startGoogleLogin(redirectTo) {
  if (!config.useSupabase) throw new Error('Google login needs SUPABASE_URL and SUPABASE_ANON_KEY in Settings');
  const { data, error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw new Error(error.message);
  return data.url;
}

// Step 2: Supabase redirects back with ?code=..., which we exchange for a session.
export async function completeGoogleLogin(code) {
  const { data, error } = await supabase().auth.exchangeCodeForSession(code);
  if (error) throw new Error(error.message);
  current = fromSupabaseUser(data.user);
  log.ok(`Logged in with Google as ${current.email}`);
  emit('auth.changed', { user: current });
  return current;
}

export async function localLogin(name) {
  if (config.useSupabase) throw new Error('Supabase is configured, so use Login with Google');
  const m = await machineInfo();
  current = {
    // Local mode uses a deterministic id so data stays attached across restarts.
    id: `local-${m.machineId.slice(0, 12)}`,
    email: `${m.user}@${m.deviceName}`.toLowerCase(),
    name: name || m.user,
    mode: 'local',
  };
  writeJson(LOCAL_SESSION, current);
  log.ok(`Signed in locally as ${current.email}`);
  emit('auth.changed', { user: current });
  return current;
}

export async function logout() {
  if (config.useSupabase) {
    try {
      await supabase().auth.signOut();
    } catch (err) {
      log.warn('Sign-out request failed', err);
    }
  }
  fs.rmSync(LOCAL_SESSION, { force: true });
  log.ok(`Signed out ${current?.email ?? ''}`);
  current = null;
  emit('auth.changed', { user: null });
}

// Folder name used for this account in Google Drive.
export function accountFolderName(user = current) {
  return (user?.email || 'local').replace(/[^a-zA-Z0-9@._-]/g, '_');
}
