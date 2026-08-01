-- analysis_jobs: tracks async skin analysis requests
create table if not exists analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  images_count int not null default 3,
  questionnaire jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table analysis_jobs enable row level security;

create policy "Anyone can insert analysis jobs"
  on analysis_jobs for insert
  to anon
  with check (true);

create policy "Anyone can read their own analysis jobs"
  on analysis_jobs for select
  to anon
  using (true);

create policy "Anyone can update analysis jobs"
  on analysis_jobs for update
  to anon
  using (true);

-- skin_analyses: persisted results for record keeping
create table if not exists skin_analyses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references analysis_jobs(id) on delete set null,
  images_storage_paths jsonb,
  questionnaire jsonb,
  gemini_result jsonb,
  recommendations jsonb,
  created_at timestamptz not null default now()
);

alter table skin_analyses enable row level security;

create policy "Anyone can insert skin analyses"
  on skin_analyses for insert
  to anon
  with check (true);

create policy "Anyone can read skin analyses"
  on skin_analyses for select
  to anon
  using (true);
