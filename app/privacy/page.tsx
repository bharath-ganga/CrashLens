import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-background px-6 py-16 text-foreground">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-muted-foreground underline">
          Return to CrashLens
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">
          Privacy notice
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: September 21, 2026
        </p>
        <div className="mt-10 space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground">
              Information processed
            </h2>
            <p className="mt-2">
              CrashLens processes account information, workspace activity,
              operational telemetry, uploaded diagnostic files, incident
              records, and email-delivery metadata required to provide and
              secure the service.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground">
              Purpose and protection
            </h2>
            <p className="mt-2">
              Information is used to authenticate users, investigate production
              failures, notify authorized team members, operate uptime checks,
              and protect accounts. CrashLens redacts common sensitive values
              before diagnostic information is persisted and does not include
              passwords or API credentials in transactional emails.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground">
              Service providers and retention
            </h2>
            <p className="mt-2">
              CrashLens uses infrastructure and delivery providers to store
              application data and send transactional email. Information is
              retained only for operational, security, and legal requirements,
              and access is restricted to authorized workspace members.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground">
              Your choices
            </h2>
            <p className="mt-2">
              Signed-in users may manage non-essential email preferences from
              the account page. Essential authentication and security notices
              remain enabled. Contact the CrashLens administrator to request
              access, correction, export, or deletion of account information.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
