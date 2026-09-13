'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
export default function AccountPage() {
  const [mode, setMode] = useState('login');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const init = window.setTimeout(() => {
      const selected = new URLSearchParams(window.location.search).get('mode');
      if (
        selected &&
        ['login', 'signup', 'forgot', 'reset', 'verify', 'resend'].includes(
          selected,
        )
      )
        setMode(selected);
      setToken(
        new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
      );
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
      void fetch('/api/account')
        .then(
          (r) =>
            r.json() as Promise<{ emailConfigured: boolean; user: unknown }>,
        )
        .then((d) => {
          setConfigured(d.emailConfigured);
          setSignedIn(Boolean(d.user));
        })
        .catch(() => setConfigured(false));
    }, 0);
    return () => window.clearTimeout(init);
  }, []);
  const titles: Record<string, string> = {
    login: 'Sign in to CrashLens',
    signup: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
    verify: 'Verify your email',
    resend: 'Resend verification',
  };
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          email: form.get('email'),
          password: form.get('password'),
          name: form.get('name'),
          token,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        message: string;
      };
      if (!response.ok) throw new Error(data.error ?? 'Request failed');
      if (mode === 'login') {
        window.location.assign('/');
        return;
      }
      if (mode === 'signup') setMode('login');
      setMessage(data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  function change(next: string) {
    setMode(next);
    setMessage('');
    setError('');
  }
  const input =
    'mt-2 w-full border border-[#3e5686] bg-[#050816] p-3 text-base';
  return (
    <main className="min-h-screen bg-[#050816] px-5 py-12 text-[#edf2ff]">
      <div className="mx-auto max-w-md border-2 border-[#2f426b] bg-[#0c1224] p-6 sm:p-8">
        <Link className="font-black text-[#4da3ff]" href="/">
          CRASHLENS
        </Link>
        <h1 className="mt-8 text-3xl font-bold">{titles[mode]}</h1>
        {signedIn && (
          <button
            className="mt-4 border border-[#2f426b] p-3 text-sm"
            onClick={async () => {
              const r = await fetch('/api/account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'logout' }),
              });
              if (r.ok) {
                setSignedIn(false);
                setMessage(
                  'CrashLens session ended. Existing ChatGPT access is managed separately.',
                );
              }
            }}
          >
            Sign out of CrashLens account
          </button>
        )}
        <p className="mt-3 text-base text-[#9aa9c7]">
          {mode === 'signup'
            ? 'Create an account and sign in immediately. No email verification required.'
            : 'Your incidents, monitors, and account notifications.'}
        </p>
        {configured === false && (
          <p className="mt-5 border border-[#e5a50a] p-3 text-sm text-[#ffc247]">
            Email delivery awaits administrator setup. You can create an account
            and sign in; password-reset emails are unavailable until setup is
            complete.
          </p>
        )}
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === 'signup' && (
            <label className="block text-sm">
              Name
              <input
                name="name"
                required
                maxLength={100}
                autoComplete="name"
                className={input}
              />
            </label>
          )}
          {!['verify', 'reset'].includes(mode) && (
            <label className="block text-sm">
              Email
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                className={input}
              />
            </label>
          )}
          {['login', 'signup', 'reset'].includes(mode) && (
            <label className="block text-sm">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={mode === 'login' ? 1 : 12}
                maxLength={128}
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                className={input}
              />
              {mode !== 'login' && (
                <span className="mt-2 block text-sm text-[#9aa9c7]">
                  Use at least 12 characters.
                </span>
              )}
            </label>
          )}
          {mode === 'verify' && (
            <p>
              Confirm ownership of your email. Verification is optional for
              signing in.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="border border-[#ff4d4d] p-3 text-sm text-[#ff8585]"
            >
              {error}
            </p>
          )}
          {message && (
            <output className="block border border-[#4da3ff] p-3 text-sm">
              {message}
            </output>
          )}
          <button
            disabled={busy}
            className="w-full bg-[#4da3ff] p-3 font-bold text-black disabled:opacity-50"
          >
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'reset'
                    ? 'Save new password'
                    : mode === 'verify'
                      ? 'Verify email'
                      : 'Send email link'}
          </button>
        </form>
        <nav className="mt-6 flex flex-wrap gap-4 text-sm text-[#22d3ee]">
          {mode !== 'login' && (
            <button onClick={() => change('login')}>Sign in</button>
          )}
          {mode === 'login' && (
            <>
              <button onClick={() => change('signup')}>Create account</button>
              <button onClick={() => change('forgot')}>Forgot password?</button>
            </>
          )}
        </nav>
        {/* Sign-in must be a full navigation, without framework prefetch. */}
        {/* oxlint-disable-next-line next/no-html-link-for-pages */}
        <a
          href="/signin-with-chatgpt?return_to=/"
          target="_top"
          className="mt-6 block border-t border-[#2f426b] pt-4 text-sm text-[#9aa9c7]"
        >
          Continue with existing ChatGPT access
        </a>
      </div>
    </main>
  );
}
