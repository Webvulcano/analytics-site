import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import InviteForm from "./InviteForm";

export const metadata = { title: "Meghívó" };

// Meghívó link (scripts/create-invite.mjs): a tag itt adja meg a saját jelszavát, egyszer.
export default function InvitePage({ params }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">Ügyfél Admin</h1>
        <Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Betöltés…</p>}>
          <Invite params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Invite({ params }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: email } = await supabase.rpc("cms_invite_email", { p_token: token });

  if (!email) {
    return (
      <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Ez a meghívó link érvénytelen, lejárt vagy már felhasználták. Kérj újat attól, aki a weboldalad készítette.
      </p>
    );
  }
  return (
    <>
      <p className="mt-1 text-sm text-zinc-500">Add meg a jelszavad. Ezzel és az e-mail-címeddel tudsz majd belépni.</p>
      <InviteForm token={token} email={email} />
    </>
  );
}
