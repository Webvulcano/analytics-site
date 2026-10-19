-- Member invites: e-mail + password login without sending any e-mail.
-- scripts/create-invite.mjs (service role, local) creates the auth user (confirmed e-mail, random
-- password) and an invite row with the SHA-256 of a random token; Lehel sends the link
-- /meghivo/<token> on any channel. The invite page lets the member set their own password once.
-- Sign-ups stay disabled in Supabase Auth: accounts only come from this script (or Google, for
-- existing users), so nobody can register a member's e-mail address before them.

create table public.member_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.member_invites enable row level security;
-- No policies: only the service role (script) and the security definer functions below touch it.
revoke all on public.member_invites from public, anon, authenticated;

-- Valid (unused, unexpired) invite for a token → its e-mail, else null.
create or replace function private.invite_email(p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.email
  from public.member_invites i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and i.used_at is null
    and i.expires_at > now()
$$;
revoke all on function private.invite_email(text) from public, anon, authenticated;

-- Invite page: which e-mail is this link for? (null = invalid / used / expired)
create or replace function public.cms_invite_email(p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.invite_email(p_token)
$$;
revoke all on function public.cms_invite_email(text) from public;
grant execute on function public.cms_invite_email(text) to anon, authenticated;

-- Redeem an invite: sets the member's password (bcrypt, as GoTrue stores it) and burns the token.
-- Returns the e-mail, so the page can sign in with it right away.
create or replace function public.cms_accept_invite(p_token text, p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_user uuid;
begin
  if p_password is null or length(p_password) < 10 then
    raise exception 'A jelszó legalább 10 karakter legyen.' using errcode = '22023';
  end if;
  if octet_length(p_password) > 72 then
    raise exception 'A jelszó legfeljebb 72 karakter lehet.' using errcode = '22023';
  end if;

  -- burn first (row lock) → a token works exactly once, even with parallel requests
  update public.member_invites i
     set used_at = now()
   where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and i.used_at is null
     and i.expires_at > now()
  returning i.email into v_email;
  if v_email is null then
    raise exception 'A meghívó érvénytelen, lejárt vagy már felhasználták.' using errcode = '22023';
  end if;

  -- only members / superadmins (the script checks too; a removed member's old link must not work)
  if not exists (select 1 from public.site_members m where m.email = v_email)
     and not exists (select 1 from public.superadmins a where a.email = v_email) then
    raise exception 'Ehhez az e-mail-címhez már nem tartozik weboldal.' using errcode = '22023';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is null then
    raise exception 'A fiók nem található — kérj új meghívót.' using errcode = '22023';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_user;

  return v_email;
end;
$$;
revoke all on function public.cms_accept_invite(text, text) from public;
grant execute on function public.cms_accept_invite(text, text) to anon, authenticated;
