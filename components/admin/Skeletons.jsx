export function SidebarSkeleton() {
  return (
    <div className="h-12 w-full animate-pulse border-b border-zinc-200 bg-white md:h-dvh md:w-60 md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-950" />
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4 p-6 md:p-10">
      <div className="h-7 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-40 w-full animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
