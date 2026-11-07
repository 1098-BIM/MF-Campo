-- MF Campo — estrutura do banco (Supabase)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Pode rodar mais de uma vez sem problema.

-- 1) Obras (nome como aparece no app + projeto ACC correspondente, usado na fase 3)
create table if not exists public.obras (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  acc_project_id text,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

-- 2) Ocorrências (incompatibilidades registradas em campo)
create table if not exists public.ocorrencias (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  obra text not null,
  local text not null default '',
  disciplina text not null default '',
  prioridade text not null default 'media' check (prioridade in ('baixa','media','alta')),
  titulo text not null,
  descricao text not null default '',
  transcricao text not null default '',
  transcricao_status text not null default 'nao_aplica'
    check (transcricao_status in ('nao_aplica','pendente','processando','concluida','erro')),
  status text not null default 'aberta' check (status in ('aberta','analise','resolvida')),
  fotos jsonb not null default '[]'::jsonb,   -- [{"path": "...", "mime": "image/jpeg"}]
  audios jsonb not null default '[]'::jsonb,  -- [{"path": "...", "mime": "audio/webm", "segundos": 12}]
  lat double precision,
  lng double precision,
  build jsonb not null default '{}'::jsonb,   -- fase 3: {"pedido": "issue"|"rfi", "issue_id": "...", "url": "..."}
  autor uuid not null default auth.uid() references auth.users(id),
  autor_email text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists ocorrencias_obra_idx on public.ocorrencias (obra);
create index if not exists ocorrencias_status_idx on public.ocorrencias (status);
create index if not exists ocorrencias_criado_idx on public.ocorrencias (criado_em desc);

-- atualiza "atualizado_em" automaticamente
create or replace function public.set_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;
drop trigger if exists trg_ocorrencias_atualizado on public.ocorrencias;
create trigger trg_ocorrencias_atualizado before update on public.ocorrencias
  for each row execute function public.set_atualizado_em();

-- 3) Segurança: só gente logada (equipe convidada) lê e escreve
alter table public.obras enable row level security;
alter table public.ocorrencias enable row level security;

drop policy if exists "obras: equipe le" on public.obras;
create policy "obras: equipe le" on public.obras for select to authenticated using (true);
drop policy if exists "obras: equipe escreve" on public.obras;
create policy "obras: equipe escreve" on public.obras for all to authenticated using (true) with check (true);

drop policy if exists "ocorrencias: equipe le" on public.ocorrencias;
create policy "ocorrencias: equipe le" on public.ocorrencias for select to authenticated using (true);
drop policy if exists "ocorrencias: equipe cria" on public.ocorrencias;
create policy "ocorrencias: equipe cria" on public.ocorrencias for insert to authenticated with check (autor = auth.uid());
drop policy if exists "ocorrencias: equipe edita" on public.ocorrencias;
create policy "ocorrencias: equipe edita" on public.ocorrencias for update to authenticated using (true) with check (true);
drop policy if exists "ocorrencias: autor exclui" on public.ocorrencias;
create policy "ocorrencias: autor exclui" on public.ocorrencias for delete to authenticated using (autor = auth.uid());

-- 4) Armazenamento de fotos e áudios (pasta privada "evidencias")
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidencias', 'evidencias', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "evidencias: equipe le" on storage.objects;
create policy "evidencias: equipe le" on storage.objects for select to authenticated using (bucket_id = 'evidencias');
drop policy if exists "evidencias: equipe envia" on storage.objects;
create policy "evidencias: equipe envia" on storage.objects for insert to authenticated with check (bucket_id = 'evidencias');
drop policy if exists "evidencias: dono exclui" on storage.objects;
create policy "evidencias: dono exclui" on storage.objects for delete to authenticated using (bucket_id = 'evidencias' and owner = auth.uid());

-- 5) Tempo real: o painel atualiza sozinho quando alguém registra
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ocorrencias') then
    alter publication supabase_realtime add table public.ocorrencias;
  end if;
end $$;
