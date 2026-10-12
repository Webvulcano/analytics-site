import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Nem található</h1>
      <p className="text-sm text-zinc-500">Ez az oldal nem létezik, vagy nincs hozzá hozzáférésed.</p>
      <Link href="/" className="text-sm font-medium underline">Vissza a weboldalaimhoz</Link>
    </main>
  );
}
