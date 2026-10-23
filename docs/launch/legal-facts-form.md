# 03a. LEGAL AND BUSINESS FACTS: the ONE form (fill it once)

Verified against heads: Site 914fade CP 7d61559 Plugin c879b4a Backend 1f99cc0 (2026-10-23).

Copy this file to a private place outside every repository (for example `~/aicc-owner/legal-facts.md`, `chmod 600`) and fill the right-hand column. Do NOT paste the filled form into chat, git or a ticket. When it is complete, tell Claude "facts form complete" and where it is; Claude reads that file locally and applies it (kit 03, section 4).
Not legal advice. A blank answer stays blank: nothing is invented, the sites then show a visible "pending" line and the launch checks fail on purpose.

## Part 1. FACTS (only you know them; no lawyer needed)

| # | Fact | Your answer | Notes |
|---|---|---|---|
| F1 | Legal entity name, exactly as registered (person or company; if osek patur/murshe: the registered business name) | | Appears in Terms, Privacy, Refund, DPA and the Site footer |
| F2 | Registered business address (one line) | | Terms (identity of the seller), Site legal pages. Half an identity is refused: name AND address are shown together or neither |
| F3 | Support email shown to customers (a mailbox someone answers) | | Must be real; `example`, `test`, `invalid`, `local` are rejected by both gates. Today only `support@copilt.org` (forwarding) exists; see F9 and kit 02 |
| F4 | Governing-law preference | | PREFERENCE only. Counsel confirms. One line, for example "the laws of ...". The Site prints law AND courts from one value (F5 must be inside it for the Site) |
| F5 | Courts / jurisdiction preference | | PREFERENCE only. Also tell counsel whether you want exclusive, non-exclusive or arbitration (counsel decision C-1 below) |
| F6 | Payment processor name as it should be printed ("Payment processor: ...") | | The processor you actually sign with. Do not fill before the PayPlus decision (kit 01). Must equal the Site allowlist entry |
| F7 | Hosting region statement | | Evidence-derived CANDIDATE, you confirm: Control Plane = DigitalOcean, Frankfurt (FRA1), Germany (the Droplet is FRA1); Backend and database = DigitalOcean FRA1 per the 2026-08 infrastructure note, NOT re-verified; email = Brevo, EU (France/Germany/Belgium, per Brevo's data-location article read in the earlier round); processor = PayPlus, Israel (UNKNOWN). Counsel decides the wording so it stays true after the database move |
| F8 | VAT / tax statement or number (optional) | | Leave blank if none applies. Ask your accountant. Appears in Terms 4.3 and Refund 5.3 |
| F9 | Support response expectation (the sentence you can truly keep) | | Today the text says "we aim to reply within one business day ... a service target, not a contractual deadline" (Refund 2, Terms 15.4, Site refund). If you cannot keep it, write the sentence you can keep: it is a text edit in three places plus translations, not a setting |
| F10 | Named person who reads and answers the support inbox, and how often (internal; not published) | | The 14-day money-back window makes replies time-critical. Needed before the address is published (kit 02, Part D of the earlier round) |
| F11 | Gmail "Send as support@copilt.org" decision | | Either send through Brevo's relay from your computer (clean), or accept replies that do not come from the published address (kit 02, section 6) |

## Part 2. DECISIONS ONLY COUNSEL CAN MAKE (no value can fill them; give this table to your lawyer)

Source: Site `docs/launch/owner-facts-batch.md` section C and `docs/launch/legal-readiness.md`, re-read at Site 914fade on 2026-10-23. Proposed wording for each is in `legal-readiness.md`. Mark each when done.

| # | Counsel item | Where | Status |
|---|---|---|---|
| C-1 | Exclusive or non-exclusive jurisdiction (or arbitration). The Terms keep a "(pending)" here even after F1 to F7 are set | CP `scripts/legal-source/terms-of-service.md` 28.1 and the three translations | |
| C-2 | Legal basis for account/purchase data and for store data (two "(pending)" markers) | CP `privacy-policy.md` sections 2 and 3 | |
| C-3 | Controller / processor roles, breach-notice timeframe, audit mechanism, return format | CP `data-processing-addendum.md` 1, 9, 11.1, 11.2 | |
| C-4 | Subprocessor schedule at launch: DigitalOcean (Control Plane, in use), Backend and database hosts at launch and after the move (Render and Neon are described as live today; the plan retires them), email provider (Brevo), payment processor status "in use", the sentence "no email-sending service" | CP `privacy-policy.md` 6, `data-processing-addendum.md` 8, `terms-of-service.md` 18.1 | |
| C-5 | Hosting region and transfer mechanism (or the statement that none is relied on), written to stay true after the database move | CP Privacy 7, DPA 12; Site `legal.privacy.s.transfers.a` | |
| C-6 | Website and account cookies (language, plan choice, sign-in, cart) | CP Privacy, Site Privacy | |
| C-7 | Ask Reco questions: stored locally or sent to the Service (the policies contradict each other); plugin owner confirms the shipped behaviour | CP Privacy 3.3, DPA 4 vs Site `/product/` | |
| C-8 | Does a larger plan bought later get its own 14 days? | Refund 1, Terms 3.6 | |
| C-9 | Tax statement and any tax number | Terms 4.3, pricing page | |
| C-10 | Remove "and the legal drafts have not been reviewed by a lawyer" from the CP translation banner and change the "Draft" labels in the Site legal header, TOGETHER with approval | CP `pages/legal.php`; Site `common.draftUpdated` / `versionDraft` | |
| Approval | Counsel (a person with legal authority) approves the English texts | switches in kit 03 section 3 | |
| Subprocessors attestation | After C-4 is corrected AND compared with the live production setup, a real date `YYYY-MM-DD` (not in the future, at most 90 days old) | `AICC_LEGAL_SUBPROCESSORS_VERIFIED` | |

## Part 3. SWITCHES YOU SET LATER (leave blank now)

| Switch | Set when |
|---|---|
| English legal text approved | counsel has approved (C-1 to C-10 done) |
| he / es / ru legal text reviewed by native-speaking legal reviewers | optional, later; blank keeps the machine-translation disclosure, which is allowed |
| Purchasable-price structured data | only after public checkout works end to end |
