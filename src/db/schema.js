// Tables used by Alpha-Sales. The same names exist in Supabase (supabase/schema.sql)
// and in the local JSON store used when Supabase is not configured.
//
// accounts        the "bucket" created on first Google login (one per user)
// devices         computers logged into the account: name, machine id, version, status, heartbeat
// projects        a business / idea with its preset variables (business type, ICP lines, ...)
// jobs            saved job definitions: browser setup, scraper steps, schedule, target computer
// job_runs        each execution of a job: which computer, status, progress, heartbeat
// checkpoints     scraper progress saved at named checkpoints so runs can resume
// proxies         proxy list: type, host, port, username, password
// proxy_checks    per-proxy website status: working / restricted / blocked + reason
// file_sync       last edit date of every synced file, written after each rclone upload
// hitl_requests   human-in-the-loop requests (CAPTCHA etc.) visible to every computer
export const TABLES = [
  'accounts', 'devices', 'projects', 'jobs', 'job_runs', 'checkpoints',
  'proxies', 'proxy_checks', 'file_sync', 'hitl_requests',
];

export const DEVICE_STATUSES = ['available', 'busy', 'draining', 'updating', 'error', 'maintenance', 'offline'];
export const RUN_STATUSES = ['queued', 'running', 'paused', 'waiting_human', 'completed', 'failed', 'stopped'];
export const PROXY_TYPES = ['http', 'https', 'socks5', 'socks4'];
export const SITE_STATUSES = ['working', 'restricted', 'blocked'];
