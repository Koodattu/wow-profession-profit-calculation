export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">Policy</p>
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>

      <div className="mt-8 space-y-6 text-sm leading-7 text-muted">
        <section>
          <h2 className="font-semibold text-foreground">What Copper stores</h2>
          <p className="mt-2">
            Copper does not require a user account. Your connected-realm and profession-tool preferences are stored in your browser. They are not part of the
            auction database.
          </p>
        </section>
        <section>
          <h2 className="font-semibold text-foreground">Request logs</h2>
          <p className="mt-2">The deployment platform may retain standard technical request logs for reliability, security, and abuse prevention.</p>
        </section>
        <section>
          <h2 className="font-semibold text-foreground">Market data</h2>
          <p className="mt-2">
            Auction, realm, and item data comes from Blizzard&apos;s Developer APIs and is presented on an as-is basis. Copper does not collect character or player
            profile data.
          </p>
        </section>
      </div>
    </article>
  );
}
