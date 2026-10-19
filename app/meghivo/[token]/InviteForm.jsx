"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { inputClass } from "@/app/login/PasswordForm";

export default function InviteForm({ token, email }) {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const router = useRouter();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError("A jelszó legalább 10 karakter legyen.");
    if (password !== password2) return setError("A két jelszó nem egyezik.");

    setLoading(true);
    const supabase = createClient();
    const { error: acceptError } = await supabase.rpc("cms_accept_invite", { p_token: token, p_password: password });
    if (acceptError) {
      setError(acceptError.message);
      setLoading(false);
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("A jelszó beállítva, de a belépés nem sikerült. Lépj be a belépő oldalon.");
      setLoading(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="inv-email" className="mb-1 block text-sm font-medium">
          E-mail
        </label>
        <input id="inv-email" type="email" value={email} readOnly autoComplete="username" className={`${inputClass} opacity-70`} />
      </div>
      <div>
        <label htmlFor="inv-pw" className="mb-1 block text-sm font-medium">
          Jelszó
        </label>
        <input
          id="inv-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
          required
          className={inputClass}
        />
        <p className="mt-1 text-xs text-zinc-500">Legalább 10 karakter.</p>
      </div>
      <div>
        <label htmlFor="inv-pw2" className="mb-1 block text-sm font-medium">
          Jelszó még egyszer
        </label>
        <input
          id="inv-pw2"
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          autoComplete="new-password"
          required
          className={inputClass}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900"
      >
        {loading ? "Mentés…" : "Jelszó mentése és belépés"}
      </button>
    </form>
  );
}
