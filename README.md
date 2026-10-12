# Ügyfél Admin (CMS + Analytics)

Next.js 16 (JSX) + Supabase. Terv: `../terv.md`, státusz: `../projekt.md`.

## Fejlesztés
```bash
cp .env.example .env.local   # értékek: Supabase dashboard / Lehel
npm install
npm run dev
```

## Fontos
- Next 16: `proxy.js` (nem middleware), `cacheComponents` be → session/params olvasás `<Suspense>` mögött.
- Jogosultság: `lib/dal.js` (`requireSite`) + Supabase RLS. Minden server action először `requireSite()`.
- DB séma: `supabase/migrations/`.
- Élesítés előtt: `npm run audit:prod`.
