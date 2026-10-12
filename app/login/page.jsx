import { Suspense } from "react";
import LoginButton from "./LoginButton";

export const metadata = { title: "Belépés" };

export default function LoginPage({ searchParams }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">Ügyfél Admin</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Lépj be, hogy szerkeszd a weboldalad és lásd a látogatottságát.
        </p>
        <div className="mt-8">
          <LoginButton />
        </div>
        <Suspense fallback={null}>
          <AuthError searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function AuthError({ searchParams }) {
  const { error } = await searchParams;
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      A belépés nem sikerült. Próbáld újra.
    </p>
  );
}
