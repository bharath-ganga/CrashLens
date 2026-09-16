'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
        signal: AbortSignal.timeout(20000),
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
      setError(
        e instanceof DOMException && e.name === 'TimeoutError'
          ? 'The request took too long. Please try again.'
          : e instanceof Error
            ? e.message
            : 'Request failed',
      );
    } finally {
      setBusy(false);
    }
  }
  function change(next: string) {
    setMode(next);
    setMessage('');
    setError('');
  }
  const input = 'mt-2 h-11 w-full bg-background text-sm';
  return (
    <main className="grid min-h-dvh bg-background text-foreground lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-neutral-950 p-12 text-white lg:flex">
        <Link
          href="/"
          className="flex items-center gap-3 text-lg font-semibold"
        >
          <Activity className="size-7" />
          CrashLens
        </Link>
        <div className="max-w-lg">
          <p className="mb-5 text-xs uppercase tracking-[.2em] text-neutral-400">
            Production observability
          </p>
          <h2 className="text-5xl font-medium leading-[1.15] tracking-tight">
            A clear view.
            <br />A faster resolution.
          </h2>
          <p className="mt-6 max-w-sm text-base leading-7 text-neutral-400">
            Bring your logs, incidents, and uptime monitoring into one focused
            workspace.
          </p>
          <div className="mt-10 border-t border-neutral-700 pt-6 text-sm text-neutral-400">
            Investigate errors. Understand impact. Keep services running.
          </div>
        </div>
        <p className="flex items-center gap-2 text-xs text-neutral-400">
          <ShieldCheck className="size-4" />
          Built for your production workflow
        </p>
      </aside>
      <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
        <Link
          href="/"
          className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to workspace
        </Link>
        <Card className="my-auto mx-auto w-full max-w-sm border-0! ring-0 py-12">
          <p className="mb-6 flex items-center gap-2 text-sm font-semibold lg:hidden">
            <Activity className="size-5" />
            CrashLens
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {titles[mode]}
          </h1>
          {signedIn && (
            <Button
              variant="ghost"
              type="button"
              className="mt-4 border border-border p-3 text-sm"
              onClick={async () => {
                const r = await fetch('/api/account', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'logout' }),
                });
                if (r.ok) {
                  setSignedIn(false);
                  setMessage('You have been signed out successfully.');
                }
              }}
            >
              Sign out of CrashLens account
            </Button>
          )}
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {mode === 'signup'
              ? 'Create your workspace and start investigating.'
              : mode === 'forgot'
                ? 'Enter your account email. We’ll send you a link to reset your password.'
                : 'Welcome back. Enter your details to continue.'}
          </p>
          {configured === false && (
            <p className="mt-5 border border-warning p-3 text-sm text-warning">
              Email delivery awaits administrator setup. You can create an
              account and sign in; password-reset emails are unavailable until
              setup is complete.
            </p>
          )}
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <Label className="block text-sm">
                Name
                <Input
                  name="name"
                  required
                  maxLength={100}
                  autoComplete="name"
                  className={input}
                />
              </Label>
            )}
            {!['verify', 'reset'].includes(mode) && (
              <Label className="block text-sm">
                Email
                <Input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  className={input}
                />
              </Label>
            )}
            {['login', 'signup', 'reset'].includes(mode) && (
              <Label className="block text-sm">
                Password
                <Input
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
                  <span className="mt-2 block text-sm text-muted-foreground">
                    Use at least 12 characters.
                  </span>
                )}
              </Label>
            )}
            {mode === 'verify' && (
              <p>
                Confirm ownership of your email. Verification is optional for
                signing in.
              </p>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {message && (
              <output className="block border border-border p-3 text-sm">
                {message}
              </output>
            )}
            <Button
              variant="default"
              type="submit"
              disabled={busy}
              className="h-11 w-full"
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
            </Button>
          </form>
          <nav className="mt-6 flex flex-wrap gap-4 text-sm text-foreground">
            {mode !== 'login' && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => change('login')}
              >
                Sign in
              </Button>
            )}
            {mode === 'login' && (
              <>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => change('signup')}
                >
                  Create account
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => change('forgot')}
                >
                  Forgot password?
                </Button>
              </>
            )}
          </nav>
          <p className="mt-8 border-t pt-5 text-xs leading-5 text-muted-foreground">
            Your account gives you access to saved investigations, uptime
            monitors, and your team workspace.
          </p>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          CrashLens · Production observability
        </p>
      </div>
    </main>
  );
}
