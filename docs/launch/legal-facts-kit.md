# 03. LEGAL FACTS KIT: one form, one mapping, the commands

Prepared 2026-10-23 by agent kitB. Not legal advice; no legal answer is invented here, and no value was applied anywhere.
Verified against: Site `launch/integration` ad30a00 (`src/lib/site.ts`, `scripts/launch-check.mjs`, `docs/launch/owner-facts-batch.md`, `src/i18n/en.ts`), Control Plane `launch/integration` 8114ee2 (`class-aicc-lm-legal-config.php`, `class-aicc-lm-legal-documents.php`, `scripts/check-launch-blockers.php`, `scripts/seed-legal-documents.php`, `scripts/legal-source/*.md`).
Files: the form is `03a-LEGAL-FACTS-FORM.md` (this folder). Repo copies (local branch `launch/kitB`, committed, not pushed): Site `docs/launch/legal-facts-kit.md` (this file) and CP `docs/launch/legal-facts-form.md` (the form).

---------------------------------------------------------------------------------------------------

## 1. Dependency order

| Step | Who | Blocking? |
|---|---|---|
| L1. Fill Part 1 of the form (F1 to F11) | owner | BLOCKING (public pages stay "pending" and both launch checks fail) |
| L2. Give Part 2 to counsel; counsel returns edits C-1 to C-10 and the approval | owner + counsel | BLOCKING for removing the draft notices and for legal soundness; NOT needed to build or test |
| L3. Claude applies F1 to F8 (this kit, section 4) and re-runs both launch checks | Claude | needs L1 and `aicc-owner-facts` (F3, done; see 2.1) |
| L4. Counsel edits go into the source files; Claude re-seeds, rebuilds | Claude + counsel | needs L2 |
| L5. Approval switches (section 3) set only after counsel approves | owner decides, Claude sets | BLOCKING for launch |
| L6. `AICC_LEGAL_SUBPROCESSORS_VERIFIED` date set after C-4 is corrected and compared with production | owner + counsel | BLOCKING for the CP gate |

What Claude does immediately after L1: nothing is possible on the production host until the template region exists (2.1); on a local/QA CP and on the Site build Claude can apply and test everything the same day, and can pre-validate each value (email shape, name+address pair rule, length).

### 2.1 Known gap that blocks live application (verified)

**CLOSED 2026-10-23 (plumb round, follow-up F3):** the production template (and, restricted, the staging one) now has an owner-facts region fed by `render-wp-config.sh` from the root-only file `/etc/aicc/owner-facts.env`, which survives every re-render (the renderer never writes it). Set each Control Plane constant on the host with `sudo aicc-owner-facts set AICC_LEGAL_ENTITY_NAME '...'` (and the other `AICC_LEGAL_*` keys, `AICC_LEGAL_REVIEW_APPROVED` and `AICC_LEGAL_SUBPROCESSORS_VERIFIED`), then `sudo aicc-render-wp-config --env production --confirm-production` and `sudo systemctl reload php8.3-fpm`, then re-seed (section 4.2). Values are validated (no control characters, no `<` `>` `@@`, apostrophes escaped), so an apostrophe in a legal name is fine. Exact commands, the key table and the unset command: `docs/cutover/production-path.md` section 3a. Why a file and not the process environment: the PHP-FPM pool runs `clear_env=yes`, and a hand edit of wp-config.php is erased by the next render.

---------------------------------------------------------------------------------------------------

## 2. The mapping: each fact to its variable, constant, documents and visible surfaces

Site variables are BUILD-TIME environment variables of the static export (public by design). Control Plane constants are `define()`s in `wp-config.php` read by `AICC_LM_Legal_Config`; legal documents are rendered once into immutable stored versions by `seed-legal-documents.php` (so changing a constant needs a re-seed to change the stored text).

| Fact (form id) | Site env var | CP constant | CP legal placeholder and documents | Site legal / marketing surfaces | CP surfaces outside the documents |
|---|---|---|---|---|---|
| F1 legal entity name | `NEXT_PUBLIC_AICC_LEGAL_NAME` | `AICC_LEGAL_ENTITY_NAME` | `[AICC LEGAL ENTITY NAME]`: Terms (2 places), Privacy (2), Refund (2), DPA (1) | `{companyDetails}` in Terms "agreement" and Privacy "who we are"; footer (name; "AICC" is the fallback) | none beyond the documents |
| F2 registered address | `NEXT_PUBLIC_AICC_ADDRESS` | `AICC_LEGAL_ENTITY_ADDRESS` | `[REGISTERED BUSINESS ADDRESS]`: Terms (2) | `{companyDetails}` (printed only together with the name) | none |
| F3 support email | `NEXT_PUBLIC_AICC_SUPPORT_EMAIL` | `AICC_LEGAL_SUPPORT_EMAIL` | `[LEGAL/SUPPORT EMAIL]`: Terms (3, incl. 15.4), Privacy (2), Refund (2) | footer, 404 page, pricing FAQ ("which plan"), questions page hero, Accessibility "report", Data and trust "requests", Privacy (requests, rights, changes), Refund "how", Terms "contact" | theme footer, My Account panels (licenses, plugin download, recovery), default `Reply-To` of every outgoing mail (`AICC_MAIL_REPLY_TO` defaults to it), launch rule 5e |
| F4 governing law | `NEXT_PUBLIC_AICC_GOVERNING_LAW` (law AND courts, one line) | `AICC_LEGAL_GOVERNING_LAW` | `[GOVERNING LAW]`: Terms (2) | Terms "law" section: "Governing law and courts: {value}" | none |
| F5 courts / jurisdiction | (inside the line above) | `AICC_LEGAL_JURISDICTION` | `[EXCLUSIVE/NON-EXCLUSIVE JURISDICTION]`: Terms 28 (2); the word `[EXCLUSIVE/NON-EXCLUSIVE]` (1) has NO configuration key: counsel item C-1 | Terms "law" | none |
| F6 payment processor | `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR` | `AICC_LEGAL_PAYMENT_PROCESSOR` | `[PAYMENT PROCESSOR]`: Terms (2), Privacy (2), Refund (2), DPA (2) | "Payment processor: {value}" in Terms "fees", Privacy "account", Refund "rights", pricing FAQ | the Site value must also be on `REAL_GATEWAY_ALLOWLIST`; the CP gateway ids are separate (kit 01 section 3) |
| F7 hosting region | `NEXT_PUBLIC_AICC_HOSTING_REGION` | (none) | none: the CP text carries no region value (counsel item C-5) | Privacy "Where data is processed" ("transfers") | none |
| F8 VAT / tax text (optional) | (none) | `AICC_LEGAL_VAT_DETAILS` | `[VAT ...]`: Terms (2), Refund (2); unset prints "(not applicable at this time)" | none | none |
| F9 response expectation | text, no variable | text | Refund 2, Terms 15.4 ("one business day ... a service target, not a contractual deadline") | refund policy block | any "we answer within" claim anywhere else must match |
| F10 named inbox operator | none (internal) | none | none | none | decides whether F3 may be published at all |
| F11 Gmail send-as | none | none | none | none | determines whether DMARC can ever leave `p=none` |

Nothing cross-checks the Site and CP copies of the same fact: after applying, compare entity name, address, support email and processor text by eye on both surfaces (the owner-facts batch says the same).

Switches (decisions, not facts):

| Switch | Site | CP | Rules |
|---|---|---|---|
| English legal text approved | `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true` | `AICC_LEGAL_REVIEW_APPROVED=true` (constant or env `true`/`1`/`yes`) | set only after counsel approves; without it the draft notices stay on every legal page and BOTH launch checks fail. Supplying F1 to F8 never hides them. `NEXT_PUBLIC_LEGAL_DRAFT_NOTICE=off` only hides the pills for screenshots and the launch check still fails: never use it for a deployed build |
| he/es/ru reviewed | `NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=true` | none (the CP banner remains until the C-10 source edit) | set ONLY when native-speaking legal reviewers have approved the Hebrew, Spanish and Russian legal text AND the English approval is already `true` (`launch:check` fails on the reverse order); blank is allowed and keeps the machine-translation disclosure on the he/es/ru legal pages; approving the English text never removes it; today he/es/ru are MACHINE DRAFTS |
| Subprocessor attestation | note only | `AICC_LEGAL_SUBPROCESSORS_VERIFIED=YYYY-MM-DD` | a real, non-future date at most 90 days old, set only after counsel corrected C-4 and compared it with the live setup; the gate fails closed on "Standby only", Render/Neon named as live hosts, "no hosting region fixed", "no email-sending service"; the processor row "Not yet selected" next to a configured processor can NEVER be cleared by the attestation |
| Structured offers | `NEXT_PUBLIC_AICC_STRUCTURED_OFFERS=on` | `AICC_STRUCTURED_DATA_OFFERS` true | only when public checkout works; both gates fail if it is on while no real gateway is allow-listed |

---------------------------------------------------------------------------------------------------

## 3. Counsel-required decisions (the 10 clauses no value can fill)

C-1 jurisdiction exclusivity/arbitration; C-2 legal basis for account and store data; C-3 DPA roles, breach timeframe, audit, return format; C-4 subprocessor schedule at launch (DigitalOcean, Backend/DB hosts before and after the move, Brevo, PayPlus status "in use", the "no email-sending service" sentence); C-5 hosting region and transfer mechanism; C-6 cookies; C-7 Ask Reco statement (stored locally or sent to the Service); C-8 larger-plan 14 days; C-9 tax statement; C-10 remove the "not reviewed by a lawyer" banner text and the "Draft" labels at approval. Full table with files in `03a-LEGAL-FACTS-FORM.md` Part 2. Counsel wording proposals: Site `docs/launch/legal-readiness.md`.

---------------------------------------------------------------------------------------------------

## 4. Exact commands (Claude runs them after L1; nothing here was run)

Prepare the values in a private file read by the shell, never typed into history:
```bash
# ~/aicc-owner/legal-facts.env (chmod 600; outside every repo; the filled form, one KEY=value per line, quoted)
set -a; . ~/aicc-owner/legal-facts.env; set +a
```

### 4.1 Site (Mac)
```bash
cd ~/self_projects/ai_copilot_site-worktrees/launch-integration     # or the approved release worktree
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build      # NEXT_PUBLIC_AICC_* are read from the environment at build time
npm run launch:check -- --strict          # fails on: any unset fact; a fake support email; processor empty / placeholder / not on REAL_GATEWAY_ALLOWLIST;
                                          # unapproved legal blocks; translations-reviewed without approval; built output with draft notices or without the
                                          # machine-translation disclosure; checkout page live while the allowlist is empty
AICC_CHECKOUT_URL=https://www.copilt.org/checkout/ npm run launch:check -- --strict     # later, against the live checkout
```
The production RELEASE is built by `infra/release/build-site-release.sh --target production --out-dir ~/aicc-releases` from the same shell (it runs `npm run build` and inherits the environment): export the facts BEFORE running it, or the release publishes pending lines.

### 4.2 Control Plane (local/QA, and production through `aicc-owner-facts`: section 2.1)
```bash
# constants available to WordPress (wp-config.php define(), or env on a local CP), then:
AICC_LEGAL_SEED_APPLY=1 wp eval-file scripts/seed-legal-documents.php          # publishes NEW immutable versions with the values baked in; idempotent
AICC_PRODUCTION=1 wp eval-file scripts/check-launch-blockers.php               # read-only; exit 1 on any blocker
# on the production host:
sudo env AICC_LEGAL_SEED_APPLY=1 aicc-wp eval-file /var/lib/aicc-cp/seed/seed-legal-documents.php
sudo env AICC_PRODUCTION=1 aicc-wp eval-file /var/lib/aicc-cp/seed/check-launch-blockers.php
```
What the CP check reports for this area: any `(pending)` left in a stored legal version; `AICC_LEGAL_REVIEW_APPROVED` not set; a legal translation older than its English source; `AICC_LEGAL_SUPPORT_EMAIL` not a real address (rule 5e); the pre-launch infrastructure statements (section 2, subprocessor attestation). (The Terms 16.2 `[PRE-LAUNCH BLOCKER]` drafting note is stripped by the renderer and is a counsel/owner item L-10/L-21 of `legal-readiness.md`, not a check result.)
Expected after L1 only: the Terms still show "(pending)" for the jurisdiction exclusivity (C-1) and the draft notices remain: that is correct and proves the counsel items are not fillable by configuration.

### 4.3 Compare the two surfaces (by eye)
Entity name, address, support email, governing law line, processor text, hosting region: Site `/terms/`, `/privacy/`, `/refund-policy/`, footer; CP `/terms/`, `/privacy/`, `/refund-policy/`, `/data-processing-addendum/`, My Account support line.

### 4.4 Order of work once counsel returns
1. Counsel edits C-1 to C-10 land in `scripts/legal-source/*.md` (and translations) and in Site `src/data/legal.ts` / `src/i18n/*.ts` (Claude edits from counsel's text, never invents).
2. Re-run 4.2 seed, rebuild 4.1.
3. Owner sets `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true` and `AICC_LEGAL_REVIEW_APPROVED=true`, plus the subprocessor date; Claude re-runs both checks; `npm run test:approved` (its own fixture values; do not feed it the real ones) must still assert the translation disclosure is published.
4. Publishing the support address (kit 02 conditions: inbound proven, named reader, truthful reply path, outgoing proven, no unkept time promise, all publication points in one change).

---------------------------------------------------------------------------------------------------

## 5. UNKNOWN list

The values themselves; whether counsel wants a country-specific consumer-law clause; whether the owner's entity type changes Terms wording; the Backend/database region after the move (decided in kit 04; F7 depends on it); what the old `www` GitHub Pages site currently shows; the translation reviewers; the exact Site footer markup for each locale (checked only at source level). The Site and CP do not validate each other's copies.
