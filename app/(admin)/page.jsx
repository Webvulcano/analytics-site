import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, listMySites } from "@/lib/dal";
import NoAccess from "@/components/admin/NoAccess";
import SignOutButton from "@/components/admin/SignOutButton";
import { PageSkeleton } from "@/components/admin/Skeletons";

export const metadata = { title: "Weboldalaim" };

export default function HomePage() {
  return (
    <main className="flex-1 px-4 py-12">
      <Suspense fallback={<PageSkeleton />}>
        <SitePicker />
      </Suspense>
    </main>
  );
}

async function SitePicker() {
  const [user, sites] = await Promise.all([getCurrentUser(), listMySites()]);

  if (sites.length === 0) return <NoAccess email={user.email} />;
  if (sites.length === 1) redirect(`/${sites[0].slug}/szerkesztes`);

  return (
    <div className="mx-auto max-w-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Weboldalaim</h1>
        <SignOutButton />
      </div>
      <ul className="mt-6 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {sites.map((s) => (
          <li key={s.id}>
            <Link
              href={`/${s.slug}/szerkesztes`}
              className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-sm text-zinc-500">{s.site_url.replace(/^https?:\/\//, "")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
