import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { REVIEW_COLS } from "@/lib/reviews";
import ReviewsManager from "@/components/reviews/ReviewsManager";

export const metadata = { title: "Értékelések" };

export default async function ReviewsPage({ params }) {
  const { site: slug } = await params;
  const { site } = await requireSite(slug);
  if (!site.reviews) notFound();
  const supabase = await createClient();

  const [reviews, locales] = await Promise.all([
    supabase.from("reviews").select(REVIEW_COLS).eq("site_id", site.id).order("position").order("created_at"),
    supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort"),
  ]);
  const failed = [reviews, locales].find((r) => r.error);
  if (failed) throw new Error(`Értékelések nem tölthetők be: ${failed.error.message}`);

  return (
    <ReviewsManager
      site={{
        slug: site.slug,
        label: site.reviews.label ?? "Értékelések",
        defaultLocale: site.default_locale,
        readOnly: site.status !== "active",
      }}
      locales={locales.data}
      initialReviews={reviews.data}
    />
  );
}
