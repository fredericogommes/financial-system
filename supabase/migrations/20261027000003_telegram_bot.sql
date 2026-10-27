-- Dono do bot: só este chat do Telegram pode usar o bot (o primeiro /start registra)
create table public.telegram_dono (
  unico boolean primary key default true check (unico),
  chat_id bigint not null,
  registrado_em timestamptz not null default now()
);

-- Lançamentos aguardando o Fred escolher a pessoa certa (quando a busca acha mais de uma)
create table public.telegram_pendentes (
  id bigint generated always as identity primary key,
  tipo public.tipo_movimentacao not null,
  valor numeric(12,2) not null check (valor > 0),
  descricao text,
  criado_em timestamptz not null default now()
);

-- Só a Edge Function (chave de serviço) mexe nessas tabelas
alter table public.telegram_dono enable row level security;
alter table public.telegram_pendentes enable row level security;
