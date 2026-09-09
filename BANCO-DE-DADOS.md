# Banco de dados — esquema, segurança e resgate

Tudo o que o app guarda fora do aparelho mora em quatro tabelas do Supabase.
Este arquivo é a fonte única sobre elas: o que cada uma faz, o SQL que a cria,
as regras de acesso que a protegem e **como resgatar dados quando algo dá
errado**.

O SQL abaixo é **idempotente**: rodar duas vezes não causa dano e não apaga
nada. Nenhum comando aqui remove tabela, coluna ou linha.

---

## As quatro tabelas

| Tabela | O que guarda | Sobrescrita? |
|---|---|:---:|
| `study_profiles` | Um perfil por linha, com o **estado atual** inteiro em `payload` (o "blob") | sim, a cada envio |
| `profile_sections` | Uma linha por **seção** do perfil (registros, cards, leis, ciclo…), com revisão própria | sim, por seção |
| `profile_backups` | **Fotos imutáveis** do perfil, comprimidas. Nunca sobrescritas | **não** |
| `active_sessions` | Qual aparelho está com a conta agora (login único entre dispositivos) | sim |

As duas primeiras são o **presente**. A terceira é o **passado** — é ela que
responde "e se eu perder tudo?". A quarta não guarda dado de estudo nenhum.

> **`profile_backups` é a única tabela sem política de UPDATE.** Isso não é
> esquecimento: é o que torna a imutabilidade uma regra do banco, e não uma
> promessa do código. Nem o app, nem um bug dele, nem um cliente adulterado
> conseguem reescrever uma foto já gravada.

---

## 1. `profile_backups` — o backup que se resgata

**Esta é a tabela nova.** Sem ela, o app funciona igual e as cópias de
segurança continuam existindo — mas só dentro do navegador de cada aparelho, e
somem junto com ele. Rode o SQL uma vez e a proteção passa a viver no servidor.

```sql
-- ── Tabela ────────────────────────────────────────────────────────────────
create table if not exists public.profile_backups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  profile_id  uuid not null,
  created_at  timestamptz not null default now(),
  note        text,
  device      text,
  ancora      boolean not null default false,
  enc         text not null default 'gz',   -- 'gz' (gzip+base64) ou 'raw'
  chars       integer not null default 0,   -- tamanho do JSON original
  sig         text,                         -- assinatura do conteúdo (evita duplicata)
  data        text not null                 -- a foto em si
);

create index if not exists profile_backups_perfil_idx
  on public.profile_backups (profile_id, created_at desc);
-- limpa o índice antigo (não-único) de uma versão anterior deste documento,
-- se ele existir — nenhuma LINHA é afetada, só o índice é substituído
drop index if exists public.profile_backups_ancora_idx;
/* ÚNICO, não só um índice de apoio: no máximo UMA linha com ancora=true por
   perfil. Sem isto, duas gravações concorrentes (o gatilho diário e um clique
   manual, por exemplo) podiam cada uma checar "existe âncora?", ouvir "não" ao
   mesmo tempo, e as DUAS virarem âncora "permanente" do mesmo perfil — quebrando
   exatamente a garantia que ela promete. Com o índice, a segunda tentativa
   concorrente leva um erro de violação de unicidade; o app trata isso como
   sucesso normal (grava a foto como rolante) — ver profile_backups_uma_ancora
   em src/js/66-backup-nuvem.js. */
create unique index if not exists profile_backups_uma_ancora_por_perfil
  on public.profile_backups (profile_id) where ancora;

-- ── Segurança: cada pessoa só enxerga o que é dela ────────────────────────
alter table public.profile_backups enable row level security;

drop policy if exists "backups_select_proprios" on public.profile_backups;
create policy "backups_select_proprios" on public.profile_backups
  for select using (auth.uid() = user_id);

drop policy if exists "backups_insert_proprios" on public.profile_backups;
create policy "backups_insert_proprios" on public.profile_backups
  for insert with check (auth.uid() = user_id);

drop policy if exists "backups_delete_proprios" on public.profile_backups;
create policy "backups_delete_proprios" on public.profile_backups
  for delete using (auth.uid() = user_id);

-- NENHUMA política de UPDATE, de propósito: uma foto gravada é imutável.
```

> **Se a criação do índice único acima falhar** com um erro citando linhas
> duplicadas, é porque já existem duas (ou mais) fotos marcadas `ancora=true`
> para o mesmo perfil — só pode ter acontecido numa versão anterior a esta
> correção. Rode a faxina abaixo primeiro (mantém a âncora mais ANTIGA de cada
> perfil — a que de fato foi criada primeiro — e rebaixa as demais a fotos
> rolantes comuns; **nenhuma linha é apagada**, só o rótulo `ancora` muda),
> depois repita a criação do índice.
>
> ```sql
> with duplicadas as (
>   select id, row_number() over (partition by profile_id order by created_at asc) as pos
>   from public.profile_backups where ancora
> )
> update public.profile_backups set ancora = false
> where id in (select id from duplicadas where pos > 1);
> ```

### Quando uma foto é criada

| Gatilho | Nota que aparece na lista |
|---|---|
| Primeira abertura do dia | `backup diário` |
| Antes de o perfil **encolher** mais de 40% num envio | `antes de uma redução de N% no perfil` |
| Antes de **esvaziar** seções que tinham conteúdo | `antes de esvaziar N seção(ões): …` |
| Antes de restaurar outra foto | `antes de restaurar um backup da nuvem` |
| Botão em Configurações → Dados | `salvo manualmente` |

A **primeira foto de cada perfil** recebe `ancora = true` e nunca é removida
pela limpeza automática, tenha a idade que tiver.

### O que a limpeza automática pode apagar

Uma linha só sai se as **quatro** travas permitirem:

1. não é a âncora;
2. está além das 14 fotos mais recentes;
3. tem mais de 24 horas;
4. sobram pelo menos 5 fotos depois da remoção.

A lógica é a função pura `CloudBackup.selecionarParaFaxina`, exercitada pela
suíte `AutoTeste` — inclusive com o caso "todas as fotos são de hoje", em que a
resposta correta é não apagar nada.

---

## 2. `study_profiles` — o estado atual (blob)

> **`id` é `uuid`, sempre.** O app usa este mesmo id como chave do namespace
> local (`diario-estudos:u:<id>:…`) e como `profile_id` em `profile_sections`
> e `profile_backups` — as três também exigem `uuid`. Um perfil criado com um
> id fora desse formato (existiu uma versão do app que gerava ids como
> `u_<algo>`) nunca consegue sincronizar nada: toda escrita na nuvem falha com
> `invalid input syntax for type uuid`, na maioria dos caminhos em silêncio. O
> app se autocorrige — `ProfileManager.migrarIdsAntigos()`, chamado a cada
> login, promove qualquer perfil assim a um id novo e válido, movendo o
> namespace local inteiro sem apagar nada — mas nenhuma tabela deve receber
> um id fora desse padrão por nenhum outro caminho.

```sql
create table if not exists public.study_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  profile_name text,
  avatar       text,
  color        text,
  payload      jsonb,
  rev          integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.study_profiles enable row level security;

drop policy if exists "perfis_proprios_select" on public.study_profiles;
create policy "perfis_proprios_select" on public.study_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "perfis_proprios_insert" on public.study_profiles;
create policy "perfis_proprios_insert" on public.study_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "perfis_proprios_update" on public.study_profiles;
create policy "perfis_proprios_update" on public.study_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "perfis_proprios_delete" on public.study_profiles;
create policy "perfis_proprios_delete" on public.study_profiles
  for delete using (auth.uid() = user_id);
```

`rev` é o **cadeado otimista**: todo envio exige `rev = <valor conhecido>` e
grava `rev + 1`. Dois aparelhos salvando ao mesmo tempo não se sobrescrevem —
o segundo recebe "conflito", recarrega a revisão real e reenvia.

---

## 3. `profile_sections` — o estado atual, seção por seção

```sql
create table if not exists public.profile_sections (
  profile_id uuid not null,
  section    text not null,
  data       jsonb,
  rev        integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (profile_id, section)
);

alter table public.profile_sections enable row level security;
```

**A regra de acesso desta tabela é a mais delicada do sistema**, porque ela não
tem `user_id` próprio: o dono é o dono do perfil. As políticas precisam
verificar isso por consulta — nunca `using (true)`.

```sql
drop policy if exists "secoes_do_meu_perfil_select" on public.profile_sections;
create policy "secoes_do_meu_perfil_select" on public.profile_sections
  for select using (exists (
    select 1 from public.study_profiles p
    where p.id = profile_sections.profile_id and p.user_id = auth.uid()));

drop policy if exists "secoes_do_meu_perfil_insert" on public.profile_sections;
create policy "secoes_do_meu_perfil_insert" on public.profile_sections
  for insert with check (exists (
    select 1 from public.study_profiles p
    where p.id = profile_sections.profile_id and p.user_id = auth.uid()));

drop policy if exists "secoes_do_meu_perfil_update" on public.profile_sections;
create policy "secoes_do_meu_perfil_update" on public.profile_sections
  for update using (exists (
    select 1 from public.study_profiles p
    where p.id = profile_sections.profile_id and p.user_id = auth.uid()));

drop policy if exists "secoes_do_meu_perfil_delete" on public.profile_sections;
create policy "secoes_do_meu_perfil_delete" on public.profile_sections
  for delete using (exists (
    select 1 from public.study_profiles p
    where p.id = profile_sections.profile_id and p.user_id = auth.uid()));

alter publication supabase_realtime add table public.profile_sections;
```

A linha `section = '__manifest'` é especial: lista quais seções o perfil tem.
É o que permite que uma exclusão viaje entre aparelhos — e, desde a correção do
episódio de perda, **só o que foi apagado de propósito** entra nela. Ausência
nunca é interpretada como exclusão.

### Conferindo se a proteção está de pé

```sql
-- Toda tabela precisa responder 't' aqui. Um 'f' significa que qualquer
-- pessoa com a chave pública do app lê os dados de todo mundo.
select relname, relrowsecurity
from pg_class
where relname in ('study_profiles','profile_sections','profile_backups','active_sessions');

-- E nenhuma política pode ser permissiva demais: procure por 'true' solto.
select tablename, policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

---

## 4. `active_sessions` — login único entre aparelhos

```sql
create table if not exists public.active_sessions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  device_id    text not null,
  device_label text,
  updated_at   timestamptz default now()
);

alter table public.active_sessions enable row level security;

drop policy if exists "own_select" on public.active_sessions;
create policy "own_select" on public.active_sessions for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on public.active_sessions;
create policy "own_insert" on public.active_sessions for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on public.active_sessions;
create policy "own_update" on public.active_sessions for update using (auth.uid() = user_id);

alter publication supabase_realtime add table public.active_sessions;
```

Se esta tabela não existir, o app apenas desliga o login único e continua
funcionando. Nenhum dado de estudo passa por aqui.

---

## Como rodar o SQL

1. Abra o painel do Supabase do projeto.
2. Menu lateral → **SQL Editor** → **New query**.
3. Cole os blocos deste arquivo (pode ser tudo de uma vez) e execute.
4. No app: **Configurações → Dados → ☁️ Backup no banco de dados**. Se o
   aviso de tabela ausente sumiu, está pronto. Clique em **Guardar cópia no
   banco** para criar a âncora agora mesmo.

---

## Runbook: resgatar dados

Na ordem. Cada passo é mais forte que o anterior, e **nenhum deles apaga nada**
por conta própria.

### 1. "Abriu vazio" — Configurações → 🔎 Recuperação de dados

Vasculha o aparelho inteiro: todos os perfis, todos os planejamentos, a lixeira
e as fotos locais. Na maioria esmagadora dos casos o dado **não sumiu** — o app
é que perdeu o caminho até ele (um planejamento fora da lista, um perfil fora
do índice, dado no motor de armazenamento antigo). Reanexar é aditivo.

### 2. Últimos 30 dias de qualquer coisa apagada — a Lixeira

Na mesma tela. Recebe tudo o que foi **apagado** *e* tudo o que foi
**esvaziado**, seja pelo app, seja por um download da nuvem. Restaurar não
passa por cima do que existe hoje sem confirmação explícita.

### 3. Voltar o perfil inteiro neste aparelho — 🛟 Histórico de versões

Até 24 fotos dos últimos 7 dias, uma a cada 20 minutos de uso. Restaurar guarda
antes o estado atual, então a própria restauração é reversível.

### 4. Trocou de aparelho, formatou, limpou o navegador — ☁️ Backup no banco

Entre na conta no aparelho novo e abra **Configurações → Dados → Backup no
banco de dados**. As fotos estão lá, com data, tamanho e de qual aparelho
vieram. **Baixar** gera um `.json`; **Restaurar** aplica sobre o perfil atual e
envia o resultado para a nuvem.

### 5. Direto no banco, se o app não abrir

```sql
-- as fotos de um perfil, da mais nova para a mais velha
select id, created_at, note, device, ancora, chars
from public.profile_backups
where profile_id = '<id-do-perfil>'
order by created_at desc;
```

A coluna `data` é o JSON do perfil comprimido em gzip e codificado em base64
(`enc = 'gz'`). Para ler fora do app, decodifique o base64 e descomprima o
gzip: o resultado é um objeto `{ "<seção>": "<texto>" }`, exatamente o formato
que a importação de backup aceita.

### E se nada disso resolver

Antes de qualquer tentativa mais agressiva, **exporte um `.json` do estado
atual** (Configurações → Dados → Exportar backup). Um estado ruim exportado
ainda é um ponto de retorno; um estado ruim sobrescrito não é mais nada.

---

## As travas que impedem a perda

Documentadas aqui porque valem tanto para quem mexe no banco quanto para quem
mexe no código. As quatro são exercitadas pela suíte `AutoTeste`, que roda na
CI a cada commit.

1. **Um perfil vazio nunca sobe.** Se o app não enxerga nenhuma seção com
   conteúdo, o envio é recusado e a cópia da nuvem fica intacta. Antes, um
   espelho de perfis incompleto fazia `payload: null` ser gravado por cima de
   tudo.
2. **Uma chave que sumiu não sobe como vazia.** Sumiço sem ordem de exclusão é
   tratado como acidente: nada é publicado e o próximo download devolve a seção.
3. **Encolher e esvaziar são fotografados antes.** Apagar é um direito de quem
   digitou — mas o estado anterior fica guardado no banco e no aparelho antes de
   deixar de existir.
4. **Ausência nunca é exclusão.** Nem local (uma seção que nunca subiu é
   preservada e enfileirada), nem remota (uma seção que existe na nuvem e não
   aqui continua no manifesto e volta na próxima leitura).
