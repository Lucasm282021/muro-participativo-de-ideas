-- ==============================================================================
-- scripts/audit-v2-preflight.sql
-- Control de PREFLIGHT de solo lectura para la promocion de la migracion v2
-- (20261021140000_audit_cascade_counts_v2).
--
-- Objetivo: evitar continuar cuando las columnas y/o las funciones instaladas no
-- correspondan inequivocamente a la MISMA version del contrato de auditoria.
--
-- Este script NO escribe nada. Solo ejecuta SELECT sobre catalogos del sistema.
-- Apto para ejecutarse tanto en una base desechable como (previsto) en un
-- preflight remoto de solo lectura.
--
-- Clasificaciones posibles (columna `classification`):
--   V1_COHERENTE            -> columnas v1 + funciones v1 + historial sin v2
--   V2_COHERENTE            -> columnas v2 + funciones v2 + historial con v2
--   ESTADO_MIXTO            -> columnas y funciones en versiones distintas
--   HISTORIAL_INCONSISTENTE -> el historial no concuerda con los objetos
--   DERIVA                  -> funcion/trigger/objeto no reconocido o alterado
--   NO_VERIFICABLE          -> falta un objeto base requerido o un metadato
--
-- REGLA CRITICA: la clasificacion positiva SOLO se emite cuando columnas,
-- funciones e historial coinciden inequivocamente. Cualquier duda => aborto.
-- No se usa el historial como unica fuente para inferir la version.
--
-- Metodo de identificacion de funciones (documentado):
--   body_md5 = md5( normalize(prosrc) || '|secdef=' || prosecdef || '|cfg=' || proconfig )
--   donde normalize = quitar comentarios '--', colapsar espacios, trim.
--   Este metodo NO depende del propietario. Los valores de referencia se
--   derivaron de las definiciones reales de las migraciones 7 y v2 y se
--   encuentran embebidos mas abajo.
-- ==============================================================================

\pset format aligned
\pset border 1

-- ------------------------------------------------------------------------------
-- A. Definiciones de referencia embebidas (derivadas de las migraciones reales)
-- ------------------------------------------------------------------------------
-- v1 = migracion 20261020130000_administrative_audit_hardening.sql
-- v2 = migracion 20261021140000_audit_cascade_counts_v2.sql
create temporary table _r107_ref(kind text, fname text, body_md5 text, has_participants_count boolean, has_contract_version boolean, has_counter_increment boolean);
insert into _r107_ref values
  ('v1','fn_audit_activity_before_delete','43399e88f24e0f7023a93f93c7e5966a', false, false, false),
  ('v1','fn_audit_idea_delete',           '5c25e216cef41423011e4134c0430551', false, false, true ),
  ('v1','fn_audit_activity_after_delete',  '5905e5c3288d4418191d42b473a8e322', false, false, false),
  ('v2','fn_audit_activity_before_delete','e812c4637f3c46fc98a85b842cb32dd9', true,  false, false),
  ('v2','fn_audit_idea_delete',           'e076f4a2b1230a37325cb035e570fbc8', false, false, false),
  ('v2','fn_audit_activity_after_delete',  'b115f77f4cb9f1ce3ab111f1f2fa1537', false, true,  false);

-- ------------------------------------------------------------------------------
-- B. Estado observado
-- ------------------------------------------------------------------------------
-- B.1 Columnas v2 presentes y sus tipos
create temporary table _r107_cols as
select
  count(*) filter (where column_name = 'participants_count')  as has_participants_count,
  count(*) filter (where column_name = 'idea_authors_count')  as has_idea_authors_count,
  bool_and(data_type = 'integer') filter (where column_name in ('participants_count','idea_authors_count')) as v2_cols_integer,
  bool_and(is_nullable = 'NO')    filter (where column_name in ('participants_count','idea_authors_count')) as v2_cols_notnull,
  count(*) filter (where column_name in ('activity_id','tx_id','ideas_count','created_at')) as base_cols
from information_schema.columns
where table_schema = 'public' and table_name = 'audit_cascade_context';

-- B.2 Funciones: hash de cuerpo + propiedades
create temporary table _r107_fn as
select p.proname,
       md5(
         btrim(regexp_replace(
           regexp_replace(p.prosrc, '--[^\n]*', '', 'g'),
           '\s+', ' ', 'g'))
         || '|secdef=' || p.prosecdef::text
         || '|cfg=' || coalesce(array_to_string(p.proconfig,','),'')
       ) as body_md5,
       p.prosecdef,
       coalesce(array_to_string(p.proconfig,','),'') as proconfig,
       pg_get_userbyid(p.proowner) as owner,
       p.prosrc
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'fn_audit_activity_before_delete','fn_audit_idea_delete','fn_audit_activity_after_delete');

-- B.3 Version detectada por hash de cada funcion (si el hash no se reconoce => 'desconocida')
create temporary table _r107_fn_ver as
select f.proname,
       coalesce(max(r.kind) filter (where r.body_md5 = f.body_md5), 'desconocida') as version,
       f.body_md5, f.prosecdef, f.proconfig, f.owner
from _r107_fn f left join _r107_ref r on r.fname = f.proname
group by f.proname, f.body_md5, f.prosecdef, f.proconfig, f.owner;

-- B.4 Historial de migraciones (robusto a la ausencia de la tabla)
-- La tabla puede no existir en una base desechable. Si no existe, se marca
-- hist_exists=false y el veredicto sera NO_VERIFICABLE (abortar).
create temporary table _r107_hist(hist_exists boolean, has_m7 integer, has_v2 integer, total_rows integer);
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    insert into _r107_hist values (false, 0, 0, 0);
  else
    execute $q$
      insert into _r107_hist
      select true,
             (select count(*) from supabase_migrations.schema_migrations where version = '20261020130000'),
             (select count(*) from supabase_migrations.schema_migrations where version = '20261021140000'),
             (select count(*) from supabase_migrations.schema_migrations)
    $q$;
  end if;
end $$;

-- B.5 Triggers de auditoria requeridos (los 7 de la migracion 7)
create temporary table _r107_trg as
select
  count(*) filter (where tgname = 'trg_audit_activity_before_delete') as t1,
  count(*) filter (where tgname = 'trg_audit_activity_after_delete')  as t2,
  count(*) filter (where tgname = 'trg_audit_activity_update')        as t3,
  count(*) filter (where tgname = 'trg_audit_idea_before_delete')     as t4,
  count(*) filter (where tgname = 'trg_audit_idea_created')           as t5,
  count(*) filter (where tgname = 'trg_audit_idea_update')            as t6,
  count(*) filter (where tgname = 'trg_audit_user_roles')             as t7,
  count(*) filter (where tgname in ('trg_audit_activities_mutation','trg_audit_ideas_mutation')) as legacy,
  count(*) filter (where tgname like 'trg_audit_%' and tgenabled <> 'O') as disabled,
  -- Triggers de auditoria INESPERADOS: cualquier trg_audit_% que no sea uno de los 7 requeridos
  count(*) filter (
    where tgname like 'trg_audit_%'
      and tgname not in (
        'trg_audit_activity_before_delete','trg_audit_activity_after_delete',
        'trg_audit_activity_update','trg_audit_idea_before_delete',
        'trg_audit_idea_created','trg_audit_idea_update','trg_audit_user_roles',
        'trg_audit_activities_mutation','trg_audit_ideas_mutation'
      )
  ) as unexpected,
  -- Triggers de auditoria duplicados: mismo evento sobre la misma tabla con distinto nombre
  (select count(*) from (
     select t.tgrelid, t.tgtype, count(*) as c
     from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and not t.tgisinternal and t.tgname like 'trg_audit_%'
     group by t.tgrelid, t.tgtype having count(*) > 1
   ) d) as duplicated
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal;

-- B.6 Objetos base requeridos
create temporary table _r107_base as
select
  to_regclass('public.activities')     is not null as has_activities,
  to_regclass('public.ideas')          is not null as has_ideas,
  to_regclass('public.participants')   is not null as has_participants,
  to_regclass('public.idea_authors')   is not null as has_idea_authors,
  to_regclass('public.audit_logs')     is not null as has_audit_logs,
  to_regclass('public.audit_cascade_context') is not null as has_ctx,
  to_regclass('supabase_migrations.schema_migrations') is not null as has_hist;

-- B.7 Permisos: EXECUTE indebido para anon/authenticated/public y ACL de tabla
create temporary table _r107_acl as
select
  count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))          as anon_exec,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as auth_exec,
  count(*) filter (where has_function_privilege('public', p.oid, 'EXECUTE'))        as pub_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname like 'fn_audit_%';

create temporary table _r107_acl_ctx as
select
  has_table_privilege('anon','public.audit_cascade_context','SELECT') as anon_ctx,
  has_table_privilege('authenticated','public.audit_cascade_context','SELECT') as auth_ctx;

-- ------------------------------------------------------------------------------
-- C. Evaluacion por dimension
-- ------------------------------------------------------------------------------
create temporary table _r107_eval as
with
  c as (select * from _r107_cols),
  h as (select * from _r107_hist),
  t as (select * from _r107_trg),
  b as (select * from _r107_base),
  a as (select * from _r107_acl),
  ac as (select * from _r107_acl_ctx)
select
  -- Version de columnas: v2 si tiene AMBAS y son integer not null; v1 si no tiene NINGUNA
  case
    when c.has_participants_count = 1 and c.has_idea_authors_count = 1
         and c.v2_cols_integer and c.v2_cols_notnull then 'v2'
    when c.has_participants_count = 0 and c.has_idea_authors_count = 0 then 'v1'
    else 'mixta'
  end as col_version,
  -- Version de funciones: v2/v1 solo si las 3 coinciden; si difieren => mixta; desconocida => deriva
  case
    when (select count(*) from _r107_fn_ver) <> 3 then 'incompleta'
    when (select count(*) from _r107_fn_ver where version = 'desconocida') > 0 then 'desconocida'
    when (select count(distinct version) from _r107_fn_ver) = 1
         then (select max(version) from _r107_fn_ver)
    else 'mixta'
  end as fn_version,
  -- Propiedades de seguridad completas
  (select count(*) from _r107_fn_ver where prosecdef and proconfig = 'search_path=""') as fn_secdef_ok,
  (select count(*) from _r107_fn_ver) as fn_total,
  -- Triggers: 7 requeridos presentes, 0 legacy, 0 deshabilitados, 0 inesperados, 0 duplicados
  (t.t1+t.t2+t.t3+t.t4+t.t5+t.t6+t.t7) as trg_present,
  t.legacy as trg_legacy,
  t.disabled as trg_disabled,
  t.unexpected as trg_unexpected,
  t.duplicated as trg_duplicated,
  -- Historial
  h.hist_exists as hist_exists,
  coalesce(h.has_m7, 0) as hist_m7,
  coalesce(h.has_v2, 0) as hist_v2,
  -- Base y permisos
  (b.has_activities and b.has_ideas and b.has_participants and b.has_idea_authors
   and b.has_audit_logs and b.has_ctx) as base_ok,
  a.anon_exec as acl_anon_exec,
  a.auth_exec as acl_auth_exec,
  a.pub_exec  as acl_pub_exec,
  (ac.anon_ctx or ac.auth_ctx) as acl_ctx_leak
from c, h, t, b, a, ac;

-- ------------------------------------------------------------------------------
-- D. Veredicto
-- ------------------------------------------------------------------------------
create temporary table _r107_verdict as
select
  e.col_version,
  e.fn_version,
  case
    when not e.hist_exists then 'NO_VERIFICABLE'
    when not e.base_ok then 'NO_VERIFICABLE'
    when e.fn_total <> 3 then 'NO_VERIFICABLE'
    when e.fn_version = 'desconocida' then 'DERIVA'
    when e.fn_version = 'incompleta' then 'NO_VERIFICABLE'
    when e.fn_secdef_ok <> 3 then 'DERIVA'
    when e.trg_legacy > 0 or e.trg_disabled > 0 or e.trg_present <> 7 then 'DERIVA'
    when e.trg_unexpected > 0 or e.trg_duplicated > 0 then 'DERIVA'
    when e.acl_anon_exec > 0 or e.acl_auth_exec > 0 or e.acl_pub_exec > 0 then 'DERIVA'
    when e.acl_ctx_leak then 'DERIVA'
    when e.col_version = 'mixta' then 'ESTADO_MIXTO'
    when e.fn_version = 'mixta' then 'ESTADO_MIXTO'
    when e.col_version <> e.fn_version then 'ESTADO_MIXTO'
    when e.col_version = 'v2' and e.hist_v2 = 0 then 'HISTORIAL_INCONSISTENTE'
    when e.col_version = 'v2' and e.hist_m7 = 0 then 'HISTORIAL_INCONSISTENTE'
    when e.col_version = 'v1' and e.hist_v2 > 0 then 'HISTORIAL_INCONSISTENTE'
    when e.col_version = 'v1' and e.hist_m7 = 0 then 'HISTORIAL_INCONSISTENTE'
    when e.col_version = 'v1' then 'V1_COHERENTE'
    when e.col_version = 'v2' then 'V2_COHERENTE'
    else 'NO_VERIFICABLE'
  end as classification,
  case
    when not e.hist_exists or not e.base_ok or e.fn_total <> 3 then 'ABORTAR'
    when e.fn_version = 'desconocida' then 'ABORTAR'
    when e.fn_secdef_ok <> 3 then 'ABORTAR'
    when e.trg_legacy > 0 or e.trg_disabled > 0 or e.trg_present <> 7 then 'ABORTAR'
    when e.trg_unexpected > 0 or e.trg_duplicated > 0 then 'ABORTAR'
    when e.acl_anon_exec > 0 or e.acl_auth_exec > 0 or e.acl_pub_exec > 0 then 'ABORTAR'
    when e.acl_ctx_leak then 'ABORTAR'
    when e.col_version = 'mixta' or e.fn_version = 'mixta' or e.col_version <> e.fn_version then 'ABORTAR'
    when e.col_version = 'v1' and e.hist_v2 > 0 then 'ABORTAR'
    when e.col_version = 'v2' and e.hist_v2 = 0 then 'ABORTAR'
    when e.hist_m7 = 0 then 'ABORTAR'
    when e.col_version = e.fn_version then 'CONTINUAR'
    else 'ABORTAR'
  end as decision
from _r107_eval e;

-- ------------------------------------------------------------------------------
-- E. Salida
-- ------------------------------------------------------------------------------
\echo '=== R107 PREFLIGHT — DETALLE POR DIMENSION ==='
select col_version as "version_columnas", fn_version as "version_funciones",
       fn_secdef_ok || '/' || fn_total as "secdef+search_path",
       trg_present as "triggers_ok(7)", trg_legacy as "legacy", trg_disabled as "deshabilitados",
       trg_unexpected as "inesperados", trg_duplicated as "duplicados",
       hist_m7 as "hist_m7", hist_v2 as "hist_v2",
       case when base_ok then 'ok' else 'FALTAN' end as "objetos_base",
       acl_anon_exec as "exec_anon", acl_auth_exec as "exec_auth", acl_pub_exec as "exec_public",
       case when acl_ctx_leak then 'FUGA' else 'ok' end as "acl_ctx"
from _r107_eval;

\echo '=== R107 PREFLIGHT — VERSION POR FUNCION ==='
select proname, version, body_md5,
       case when prosecdef then 'secdef' else 'INSEGURO' end as seguridad,
       case when proconfig = 'search_path=""' then 'ok' else 'REVISAR:' || proconfig end as search_path
from _r107_fn_ver order by proname;

\echo '=== R107 PREFLIGHT — VEREDICTO ==='
select classification as "clasificacion", decision as "decision" from _r107_verdict;

-- Codigo de salida logico para automatizacion (0 = continuar, 1 = abortar)
\echo '=== R107 PREFLIGHT — EXITCODE LOGICO (0=CONTINUAR,1=ABORTAR) ==='
select case when decision = 'CONTINUAR' then 0 else 1 end as exitcode from _r107_verdict;
