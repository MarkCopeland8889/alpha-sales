-- Alpha-Sales online database (Supabase / Postgres).
-- Run this once in the Supabase SQL editor (Dashboard > SQL > New query).
-- Every table is nested under an account ("bucket") and protected by row-level security:
-- a logged-in user can only read and write rows whose account_id is their own user id.

create extension if not exists pgcrypto;

-- The bucket created on first Google login.
create table if not exists public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Computers logged into the account (sub-bucket per machine).
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  machine_id text not null,
  device_name text,
  platform text,
  os text,
  app_version text,
  last_edit timestamptz,
  status text not null default 'available'
    check (status in ('available', 'busy', 'draining', 'updating', 'error', 'maintenance', 'offline')),
  status_reason text,
  last_heartbeat timestamptz,
  last_login timestamptz,
  info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, machine_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  description text,
  variables jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  name text not null,
  description text,
  definition jsonb not null default '{}'::jsonb,   -- browser, controller, steps, mode, guardrails
  schedule text,                                   -- cron expression, e.g. "0 9 * * 1-5"
  target_machine_id text,                          -- null = run on the computer that starts it
  enabled boolean not null default true,
  status text not null default 'idle',
  machine_id text,                                 -- computer currently running it
  last_heartbeat timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  label text,
  machine_id text not null,                        -- computer that must run it
  requested_by text,                               -- computer that queued it
  app_version text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'waiting_human', 'completed', 'failed', 'stopped')),
  spec jsonb not null default '{}'::jsonb,         -- snapshot of the job definition used
  progress jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  log_file text,                                   -- path under Logs/ on the computer that ran it
  started_at timestamptz,
  finished_at timestamptz,
  last_heartbeat timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  run_id uuid references public.job_runs (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  scraper text not null,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proxies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  label text,
  type text not null check (type in ('http', 'https', 'socks5', 'socks4')),
  host text not null,
  port integer not null,
  username text,
  password text,
  notes text,
  status text,                                     -- result of the last connectivity test
  last_ip text,
  last_checked timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Status checks bucket: how each website behaves through each proxy.
create table if not exists public.proxy_checks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  proxy_id uuid not null references public.proxies (id) on delete cascade,
  website text not null,
  status text not null check (status in ('working', 'restricted', 'blocked')),
  reason text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proxy_id, website)
);

-- Last edit date of each file backed up to Google Drive.
create table if not exists public.file_sync (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  path text not null,
  last_edit timestamptz not null default now(),
  machine_id text,
  size bigint,
  action text,                                     -- updated | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, path)
);

create table if not exists public.hitl_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  run_id uuid references public.job_runs (id) on delete cascade,
  machine_id text,
  kind text not null default 'captcha',
  message text,
  url text,
  status text not null default 'open' check (status in ('open', 'resolved', 'cancelled')),
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists devices_account_idx on public.devices (account_id);
create index if not exists jobs_account_idx on public.jobs (account_id);
create index if not exists job_runs_machine_idx on public.job_runs (machine_id, status);
create index if not exists checkpoints_run_idx on public.checkpoints (run_id, scraper);
create index if not exists proxy_checks_proxy_idx on public.proxy_checks (proxy_id);

-- Row-level security -----------------------------------------------------------
alter table public.accounts enable row level security;
drop policy if exists "own account" on public.accounts;
create policy "own account" on public.accounts
  for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['devices','projects','jobs','job_runs','checkpoints','proxies','proxy_checks','file_sync','hitl_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (account_id = auth.uid()) with check (account_id = auth.uid())', t);
  end loop;
end $$;

-- Realtime: lets computers react instantly to delegated jobs and CAPTCHA requests.
do $$
begin
  begin
    alter publication supabase_realtime add table public.job_runs, public.hitl_requests, public.devices;
  exception when duplicate_object then null;
  end;
end $$;
