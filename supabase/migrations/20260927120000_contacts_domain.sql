-- El dominio pedido en el CSV de import_contacts (columna `domain`) se
-- parseaba y se descartaba: sin él, draft_message/queue_touch solo podían
-- resolver la cuenta del contacto derivando el dominio de su email, y un
-- contacto con email personal (gmail, etc.) nunca encontraba la ficha que
-- research_account acababa de guardar para el dominio real de la empresa.
alter table public.contacts
  add column domain text
  check (
    domain is null
    or (domain = lower(domain) and domain !~ '^www\.' and length(domain) between 3 and 253)
  );
