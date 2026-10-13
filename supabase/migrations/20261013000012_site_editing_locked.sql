-- 0012 site editing lock: a Szerkesztés (szöveg + képhelyek) tiltása ügyfelenként.
--   sites.editing_locked  true = a panel tiltó overlay-t mutat, a mentő actionök elutasítanak.
-- Default true (új site zárva indul, mint eddig a globális kapcsolóval). Csak a service role / superadmin
-- írja (a sites táblára az authenticated rolenak nincs írási joga) → ügyfél nem oldhatja fel magának.
-- A manifest-sync nem érinti (nincs a sync oszloplistájában). Portfólió / Blog nem tartozik alá.

alter table public.sites add column editing_locked boolean not null default true;
