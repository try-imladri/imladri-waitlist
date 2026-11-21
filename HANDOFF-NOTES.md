# Current waitlist source handoff

This is a clean source snapshot of the live Imladri Cloudflare waitlist. See `PROVENANCE.json` for the source commit and exclusions. Publication status is managed by the parent handoff task; this file does not assert an upload has happened.

The active build and deploy commands are in `package.json` and use `vite.cloudflare.config.ts` and `wrangler.cloudflare.json`. The old `vite.config.ts` is retained as historical Sites starter source; its `.openai/hosting.json` input is intentionally excluded. Do not use that retired hosting path.

The website, signup data, contact inbox, owner administration, signed email actions and branded email rendering are present. Runtime encryption/signing/mail secrets and all production data stay outside Git. The Cloudflare account/database identifiers and owner-only Access audience in the private deployment configuration are configuration identifiers, not authentication credentials. They do not give the mobile client owner access.

Read `README.md` for current behavior, retention and owner access. Start the mobile handoff at the [iOS blueprint](https://github.com/try-imladri/imladri-ios-blueprint) and read its [agent instructions](https://github.com/try-imladri/imladri-ios-blueprint/blob/main/AGENTS.md) before adapting code. Marketing consent to join the waitlist does not by itself enroll someone into a dating profile or authorize copying legacy coaching data.

Public brand artwork and font license notices are preserved. Older versioned logo/email assets are retained because already-sent emails and cached social cards may still reference them. The current selected site mark is the transparent two-face v3 asset; the current email header uses the black-on-white v2 lockup.
