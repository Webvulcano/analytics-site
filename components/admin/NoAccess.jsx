import SignOutButton from "./SignOutButton";

export default function NoAccess({ email }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-semibold">Nincs hozzáférésed weboldalhoz</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Ezzel a fiókkal léptél be: <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>.
        Ha szerinted ez hiba, írj nekünk, és hozzáadjuk a fiókod.
      </p>
      <div className="mt-6 flex justify-center">
        <SignOutButton />
      </div>
    </div>
  );
}
