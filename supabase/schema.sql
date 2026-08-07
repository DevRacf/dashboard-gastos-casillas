-- Ejecuta esto una vez en el SQL Editor de tu proyecto Supabase.

create table if not exists transactions (
  id        bigint generated always as identity primary key,
  tipo      text not null check (tipo in ('Ingreso', 'Egreso')),
  fecha     date not null,
  concepto  text not null,
  monto     double precision not null check (monto >= 0),
  categoria text not null
);

create index if not exists transactions_fecha_idx on transactions (fecha);
create index if not exists transactions_tipo_idx on transactions (tipo);

-- El servidor accede con la Service Role Key (nunca se expone al navegador),
-- así que Row Level Security puede quedar activado y bloqueado por defecto
-- sin necesidad de políticas: la service role la salta automáticamente.
alter table transactions enable row level security;
