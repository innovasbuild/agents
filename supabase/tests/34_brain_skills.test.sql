-- supabase/tests/34_brain_skills.test.sql
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values ('a5a5a5a5-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@skill-a.test', now());

insert into public.tenants (id, slug, display_name)
values ('b5b5b5b5-0000-0000-0000-00000000000a', 'skill-a', 'Skill A'),
       ('b5b5b5b5-0000-0000-0000-00000000000b', 'skill-b', 'Skill B');

-- Páginas por brain_upsert_page para que tengan su revisión 1.
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/ventas/reporte', 'Reporte', 'skill', 'activo', '{}'::text[], '{"description":"Usar para armar el reporte semanal."}'::jsonb, 'cuerpo v1', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/admin/reporte', 'Reporte admin', 'skill', 'activo', '{}'::text[], '{"description":"Otro reporte."}'::jsonb, 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/sin-descripcion', 'Sin', 'skill', 'activo', '{}'::text[], '{}'::jsonb, 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/llena', 'Llena', 'skill', 'activo', '{}'::text[], '{"description":"x"}'::jsonb, 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'comercial/icp', 'ICP', 'comercial', 'activo', '{}'::text[], '{}'::jsonb, 'texto', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000b', 'skills/reporte', 'Reporte de B', 'skill', 'activo', '{}'::text[], '{"description":"El de B."}'::jsonb, 'cuerpo b', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000002');

-- Devuelve 'sqlstate:detail' del error que lanza la consulta, para afirmar el motivo exacto.
create function pg_temp.errd(q text) returns text language plpgsql as $f$
declare s text; d text;
begin
  execute q;
  return 'sin error';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  s := sqlstate;
  return s || ':' || coalesce(d, '');
end;
$f$;

create temp table ids as
select slug, tenant_id, id from public.brain_pages where slug like 'skills/%' or slug = 'comercial/icp';
grant select on ids to public;

-- 1-7: tablas y privilegios
select has_table('public', 'brain_skill_files', 'existe brain_skill_files');
select has_table('public', 'brain_skill_versions', 'existe brain_skill_versions');
select ok(not has_table_privilege('authenticated', 'public.brain_skill_files', 'select'), 'authenticated no lee archivos');
select ok(not has_table_privilege('authenticated', 'public.brain_skill_versions', 'select'), 'authenticated no lee versiones');
select ok(not has_table_privilege('anon', 'public.brain_skill_versions', 'select'), 'anon no lee versiones');
select ok(not has_table_privilege('service_role', 'public.brain_skill_versions', 'update'), 'ni el servidor actualiza una versión');
select ok(not has_table_privilege('service_role', 'public.brain_skill_versions', 'delete'), 'ni el servidor borra una versión');

-- 8-12: funciones cerradas a authenticated
select ok(not has_function_privilege('authenticated', 'public.brain_skill_put_file(uuid, uuid, text, text, integer, uuid)', 'execute'), 'authenticated no sube archivos');
select ok(not has_function_privilege('authenticated', 'public.brain_skill_remove_file(uuid, uuid, text, uuid)', 'execute'), 'authenticated no quita archivos');
select ok(not has_function_privilege('authenticated', 'public.brain_publish_skill(uuid, uuid, integer, text, text, uuid, integer)', 'execute'), 'authenticated no publica');
select ok(not has_function_privilege('authenticated', 'public.brain_withdraw_skill(uuid, uuid, text, uuid)', 'execute'), 'authenticated no retira');
select ok(not has_function_privilege('authenticated', 'public.brain_skill_overview(uuid)', 'execute'), 'authenticated no lee el resumen');

-- 13-14: bucket privado y sin políticas
select is((select public from storage.buckets where id = 'skills'), false, 'el bucket skills es privado');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%''skills''%'),
  0, 'ninguna política de storage abre el bucket skills');

-- 15-16: rechazos al subir
select throws_ok(
  $$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'comercial/icp'), 'a.txt', repeat('a', 64), 10, 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR422', null, 'no se suben archivos a una página que no es skill');
select throws_ok(
  $$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), '../afuera.txt', repeat('a', 64), 10, 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  '23514', null, 'una ruta que se sale del paquete viola el check');

-- 17-19: subir y hash de archivos, sin importar el orden
select is(
  public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'scripts/a.py', repeat('a', 64), 100, 'a5a5a5a5-0000-0000-0000-000000000001'),
  encode(sha256(convert_to(jsonb_build_array(jsonb_build_array('scripts/a.py', repeat('a', 64)))::text, 'UTF8')), 'hex'),
  'el hash de archivos de un solo archivo');
select is(
  public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'assets/z.txt', repeat('b', 64), 200, 'a5a5a5a5-0000-0000-0000-000000000001'),
  encode(sha256(convert_to(jsonb_build_array(jsonb_build_array('assets/z.txt', repeat('b', 64)), jsonb_build_array('scripts/a.py', repeat('a', 64)))::text, 'UTF8')), 'hex'),
  'el hash ordena por ruta, no por orden de carga');
select is(
  (select count(*)::int from public.events where type = 'brain.skill_file_added' and tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a'),
  2, 'cada archivo subido deja su evento');

-- 20-22: publicar rechaza lo que no coincide o no valida
select is(
  pg_temp.errd($$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 9, public.brain_skill_files_digest((select id from ids where slug = 'skills/ventas/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR409:revision', 'una revisión esperada vieja es conflicto');
select is(
  pg_temp.errd($$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 1, 'otro-hash', 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR409:files', 'un hash de archivos viejo es conflicto');
select is(
  pg_temp.errd($$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/sin-descripcion'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/sin-descripcion')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR422:description', 'sin descripción no se publica');

-- Notas vacías y página de otra empresa
select is(
  pg_temp.errd($$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/ventas/reporte')), '   ', 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR422:note', 'publicar sin nota se rechaza');
select is(
  pg_temp.errd($$select public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), '', 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR422:note', 'retirar sin nota se rechaza');
select is(
  pg_temp.errd($$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/reporte'), 'a.txt', repeat('a', 64), 10, 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR404:', 'una página de otra empresa no existe para esta');

-- 23-25: publicar
select is(
  (select skill_version from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/ventas/reporte')), 'primera', 'a5a5a5a5-0000-0000-0000-000000000001')),
  1, 'la primera publicación es la versión 1');
select is(
  (select jsonb_array_length(manifest) from public.brain_skill_versions where slug = 'skills/ventas/reporte' and version = 1),
  2, 'la versión guarda el manifiesto de sus dos archivos');
select is(
  (select (payload ->> 'version')::int from public.events where type = 'brain.skill_published' and summary = 'skills/ventas/reporte'),
  1, 'publicar deja su evento con la versión');

-- 26-27: el nombre es único por empresa, no entre empresas
select is(
  pg_temp.errd($$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/admin/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/admin/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR409:name', 'otra skill vigente con el mismo nombre choca');
select is(
  (select action::text from public.brain_skill_versions where slug = 'skills/ventas/reporte' order by id desc limit 1),
  'publicar', 'tras el choque, ventas/reporte sigue siendo la vigente');
select is(
  (select count(*)::int from public.brain_skill_versions where slug = 'skills/admin/reporte'),
  0, 'el choque no deja ningún acto de admin/reporte');
select lives_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000b', (select id from ids where slug = 'skills/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'otra empresa publica el mismo nombre sin chocar');

-- Lo publicado es una copia: editar la página después no la cambia.
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000b', 'skills/reporte', 'Reporte de B', 'skill', 'activo', '{}'::text[], '{"description":"El de B."}'::jsonb, 'cuerpo b editado', 'edición', 1, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000002');
select is(
  (select body from public.brain_skill_versions where slug = 'skills/reporte' and version = 1),
  'cuerpo b', 'la versión publicada es una copia: editar la página no la cambia');

-- 28: una skill publicada no se borra
select is(
  pg_temp.errd($$select * from public.brain_delete_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/ventas/reporte', 1, 'a5a5a5a5-0000-0000-0000-000000000001', 'c5c5c5c5-0000-0000-0000-000000000001', '[]'::jsonb)$$),
  'BR409:skill_published', 'con versión vigente no se borra');

-- 29-31: retirar libera el nombre
select is(public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'salió mal', 'a5a5a5a5-0000-0000-0000-000000000001'), true, 'retira la vigente');
select is(public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'otra vez', 'a5a5a5a5-0000-0000-0000-000000000001'), false, 'retirar lo ya retirado no hace nada');
select lives_ok(
  $$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/admin/reporte'), 1, public.brain_skill_files_digest((select id from ids where slug = 'skills/admin/reporte')), 'nota', 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'con la otra retirada, el nombre queda libre');

select is(
  pg_temp.errd($$select * from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), null, null, 'x', 'a5a5a5a5-0000-0000-0000-000000000001', 99)$$),
  'BR404:version', 'republicar una versión que no existe');

-- 32: republicar una versión anterior crea una versión nueva (la otra se retira primero)
select public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/admin/reporte'), 'libero', 'a5a5a5a5-0000-0000-0000-000000000001');
select is(
  (select skill_version from public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), null, null, 'vuelvo', 'a5a5a5a5-0000-0000-0000-000000000001', 1)),
  2, 'republicar la versión 1 crea la versión 2');

select ok(
  (select (v2.body, v2.description, v2.frontmatter, v2.manifest, v2.files_digest, v2.digest, v2.republished_from)
        is not distinct from (v1.body, v1.description, v1.frontmatter, v1.manifest, v1.files_digest, v1.digest, 1)
   from public.brain_skill_versions v1, public.brain_skill_versions v2
   where v1.slug = 'skills/ventas/reporte' and v1.version = 1 and v1.action = 'publicar'
     and v2.slug = 'skills/ventas/reporte' and v2.version = 2 and v2.action = 'publicar'),
  'la versión 2 republicada tiene el mismo contenido y hash que la 1');

-- 33: el resumen es por empresa
select is(
  (select count(*)::int from public.brain_skill_overview('b5b5b5b5-0000-0000-0000-00000000000a')),
  4, 'el resumen trae las cuatro skills de A y ninguna de B');

-- 34: retirada, se borra y las versiones quedan como registro
select public.brain_withdraw_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/ventas/reporte'), 'cierro', 'a5a5a5a5-0000-0000-0000-000000000001');
select public.brain_delete_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/ventas/reporte', 1, 'a5a5a5a5-0000-0000-0000-000000000001', 'c5c5c5c5-0000-0000-0000-000000000001', '[]'::jsonb);
select is(
  (select count(*)::int from public.brain_skill_versions where slug = 'skills/ventas/reporte' and page_id is null),
  4, 'borrada la página, sus cuatro actos quedan con page_id nulo');

-- 35: tope de 50 archivos
insert into public.brain_skill_files (tenant_id, page_id, path, sha256, size)
select 'b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/llena'), 'f' || n || '.txt', repeat('c', 64), 1
from generate_series(1, 50) n;
select throws_ok(
  $$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/llena'), 'uno-mas.txt', repeat('d', 64), 1, 'a5a5a5a5-0000-0000-0000-000000000001')$$,
  'BR422', null, 'el archivo 51 se rechaza');

-- 36: quitar lo que no está no deja evento
select public.brain_skill_remove_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/llena'), 'no-existe.txt', 'a5a5a5a5-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.events where type = 'brain.skill_file_removed'),
  0, 'quitar lo que no está no deja evento');

-- Quitar un archivo que sí está: borra la fila, deja evento y cambia el hash
create temp table d0 as select public.brain_skill_files_digest((select id from ids where slug = 'skills/llena')) as digest;
create temp table d1 as select public.brain_skill_remove_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/llena'), 'f1.txt', 'a5a5a5a5-0000-0000-0000-000000000001') as digest;
select is(
  (select digest from d1),
  public.brain_skill_files_digest((select id from ids where slug = 'skills/llena')), 'quitar devuelve el hash nuevo');
select is(
  (select count(*)::int from public.brain_skill_files where page_id = (select id from ids where slug = 'skills/llena') and path = 'f1.txt'),
  0, 'quitar borra la fila');
select is(
  (select count(*)::int from public.events where type = 'brain.skill_file_removed' and payload ->> 'path' = 'f1.txt'),
  1, 'quitar deja su evento');
select isnt(
  public.brain_skill_files_digest((select id from ids where slug = 'skills/llena')), (select digest from d0), 'quitar cambia el hash de archivos');

-- Tope de 20 MB por paquete: 5 x 4 MB entran, un byte más no
insert into public.brain_skill_files (tenant_id, page_id, path, sha256, size)
select 'b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/sin-descripcion'), 'g' || n || '.bin', repeat('e', 64), 4194304
from generate_series(1, 5) n;
select is(
  pg_temp.errd($$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/sin-descripcion'), 'extra.bin', repeat('f', 64), 1, 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'BR422:package_limit', 'pasar los 20 MB del paquete se rechaza');

-- Archivo vacío: entra con size 0 y el hash de archivos lo cuenta
select is(
  pg_temp.errd($$select public.brain_skill_put_file('b5b5b5b5-0000-0000-0000-00000000000a', (select id from ids where slug = 'skills/admin/reporte'), '__init__.py', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0, 'a5a5a5a5-0000-0000-0000-000000000001')$$),
  'sin error', 'un archivo vacío (size 0) se sube');

-- El hash del paquete no es ambiguo: con el separador viejo (\n), estas dos
-- skills (compatibility "x\ny" sin licencia / compatibility "x" y licencia "y")
-- daban el mismo texto a hashear.
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000a', 'skills/colision', 'Colisión', 'skill', 'activo', '{}'::text[], jsonb_build_object('description', 'd', 'compatibility', E'x\ny', 'license', 'z'), 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000001');
select public.brain_upsert_page('b5b5b5b5-0000-0000-0000-00000000000b', 'skills/colision', 'Colisión', 'skill', 'activo', '{}'::text[], jsonb_build_object('description', 'd', 'compatibility', 'x', 'license', E'y\nz'), 'cuerpo', 'alta', null, 'user', 'a5a5a5a5-0000-0000-0000-000000000001', null, 'c5c5c5c5-0000-0000-0000-000000000002');
select public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000a', (select id from public.brain_pages where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a' and slug = 'skills/colision'), 1, public.brain_skill_files_digest((select id from public.brain_pages where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a' and slug = 'skills/colision')), 'n', 'a5a5a5a5-0000-0000-0000-000000000001');
select public.brain_publish_skill('b5b5b5b5-0000-0000-0000-00000000000b', (select id from public.brain_pages where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000b' and slug = 'skills/colision'), 1, public.brain_skill_files_digest((select id from public.brain_pages where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000b' and slug = 'skills/colision')), 'n', 'a5a5a5a5-0000-0000-0000-000000000001');
select isnt(
  (select digest from public.brain_skill_versions where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a' and slug = 'skills/colision'),
  (select digest from public.brain_skill_versions where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000b' and slug = 'skills/colision'),
  'combinaciones que colisionaban con el separador viejo dan hashes distintos');
select is(
  (select digest from public.brain_skill_versions where tenant_id = 'b5b5b5b5-0000-0000-0000-00000000000a' and slug = 'skills/colision') ~ '^[0-9a-f]{64}$',
  true, 'el hash del paquete es un sha256 hex');

select * from finish();
rollback;
