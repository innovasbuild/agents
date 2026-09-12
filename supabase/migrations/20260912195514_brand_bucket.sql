-- El logo del cliente no es secreto: lectura pública, escritura restringida.
insert into storage.buckets (id, name, public)
values ('brand', 'brand', true)
on conflict (id) do nothing;

-- La primera carpeta del path es el slug del tenant: brand/<slug>/logo.png
create policy "brand_write_admins" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand'
    and exists (
      select 1 from public.tenants t
      where t.slug = (storage.foldername(name))[1]
        and (
          (select public.has_tenant_role(t.id, array['tenant_admin']::public.tenant_role[]))
          or (select public.is_platform_admin())
        )
    )
  );

create policy "brand_update_admins" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brand'
    and exists (
      select 1 from public.tenants t
      where t.slug = (storage.foldername(name))[1]
        and (
          (select public.has_tenant_role(t.id, array['tenant_admin']::public.tenant_role[]))
          or (select public.is_platform_admin())
        )
    )
  );
