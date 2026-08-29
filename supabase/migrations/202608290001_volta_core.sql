create extension if not exists pgcrypto;

create table if not exists public.volta_state (
  operation_id text primary key,
  snapshot jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.volta_ledger_events (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null,
  call_id text,
  event_type text not null,
  severity text not null check (severity in ('INFO', 'SUCCESS', 'WARNING', 'DANGER')),
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists volta_ledger_operation_time_idx
  on public.volta_ledger_events (operation_id, occurred_at desc);

create table if not exists public.volta_webhook_receipts (
  provider text not null,
  provider_event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

create table if not exists public.volta_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists volta_jobs_pending_idx
  on public.volta_jobs (status, available_at)
  where status = 'PENDING';

alter table public.volta_state enable row level security;
alter table public.volta_ledger_events enable row level security;
alter table public.volta_webhook_receipts enable row level security;
alter table public.volta_jobs enable row level security;

-- Browser clients receive no direct table policy. All state access goes through
-- authenticated application routes; the server uses the service role.

insert into storage.buckets (id, name, public)
values ('volta-recordings', 'volta-recordings', false)
on conflict (id) do update set public = false;

