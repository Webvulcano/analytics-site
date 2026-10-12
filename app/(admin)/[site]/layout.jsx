import { Suspense } from "react";
import { listMySites, requireSite } from "@/lib/dal";
import Sidebar from "@/components/admin/Sidebar";
import { PageSkeleton, SidebarSkeleton } from "@/components/admin/Skeletons";

export default function SiteLayout({ children, params }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col md:flex-row">
      <Suspense fallback={<SidebarSkeleton />}>
        <SiteSidebar params={params} />
      </Suspense>
      <main className="min-w-0 flex-1">
        <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
      </main>
    </div>
  );
}

async function SiteSidebar({ params }) {
  const { site: slug } = await params;
  const [{ site, user }, sites] = await Promise.all([requireSite(slug), listMySites()]);
  return (
    <Sidebar
      site={{ slug: site.slug, name: site.name, siteUrl: site.site_url, galleryLabel: site.gallery?.label ?? null, blogLabel: site.blog?.label ?? null }}
      sites={sites.map((s) => ({ slug: s.slug, name: s.name }))}
      user={{ email: user.email }}
    />
  );
}
