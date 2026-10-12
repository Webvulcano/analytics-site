import { redirect } from "next/navigation";

export default async function SiteIndex({ params }) {
  const { site } = await params;
  redirect(`/${site}/szerkesztes`);
}
