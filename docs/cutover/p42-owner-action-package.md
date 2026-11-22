# P42 OWNER ACTION PACKAGE: the only things engineering cannot do for you

> **HISTORICAL for Package B (signing). Superseded by the P45 key replacement (2026-11-22).** Package B below describes signing 1.1.2 with the 2026-11-18 key pair (`9d49-041f-0ced-13ac` / `be7f-3dda-cddd-d781`), whose vault passphrases were lost: that pair is retired and must never be signed with, trusted by the host, or installed as `AICC_LM_PLUGIN_SIGNING_PUBKEYS`. The 1.1.2 ZIP bakes the retired keys and must not be published. Use the rekeyed release and the P45 runbooks (`cp-dark/p45/`: key values 5a8f-1d62-ac6e-ce00 / 8179-a77e-3b93-1f58). Packages A, C-F are unaffected.

Everything else is done, deployed (default OFF) and verified: Control Plane `20261120T075105Z-6884e0fc`, Site `20261119T220531Z-8db27c52`. Nothing below was run for you. No step asks for a secret in chat: secrets go through the hidden-prompt tools only. After each package, tell me "done A", "done B", ... and I run the coordinator part. Detailed, copy-pasteable versions with every flag verified are in the files named in each package.

## Package A: Cloudflare Turnstile (about 15 minutes; Cloudflare dashboard + your Mac Terminal)
1. Cloudflare dashboard → Turnstile → Add widget. Name `AICC signup (production)`. **Hostname: `www.copilt.org`** (add `copilt.org` only if the apex serves `/start/`; it redirects today). Mode **Managed**. Create it. Cloudflare shows a **Site key** (public) and a **Secret key** (private).
2. In an interactive Terminal on your Mac: `cd ~/self_projects/ai_copilot_site-worktrees/p42-activation` then `bash infra/provision/set-turnstile-secret.sh --dry-run` (checks only), then `bash infra/provision/set-turnstile-secret.sh` and paste the **Secret key** at the hidden prompt, twice. The tool installs it as `root:aicc-cp 0640`, never in a command line or log. It REFUSES Cloudflare's public test keys (`1x…`, `2x…`, `3x…`).
3. Send me the **Site key** only (it is public). I then run the one owner-facts update (Turnstile, notify, milestone sync, owner-ops), compare, render and reload, and show you the `status` output.
- **Expected evidence:** `installed: /etc/aicc-mail/turnstile.secret root:aicc-cp 640` and a 16-hex fingerprint; after my step `wp aicc-trial status` no longer lists `turnstile`, `turnstile_blocked`, `notify`.
- **If it fails:** the tool writes nothing and names the problem; nothing is changed on the host. Before step 2 the host needs the tool installed (I do that one hash-checked copy with your OK; steps in `ACTIVATION-STEPS-VERIFIED.md` §4).
- **Stays OFF:** signup, trial issuance, Commerce.
- Detail: `p42/R-activation/ACTIVATION-STEPS-VERIFIED.md` (also `docs/cutover/p42-activation-steps.md`, branch `feat/p42-site-readiness`).

## Package B: sign Plugin 1.1.2 offline (about 10 minutes; your vault Mac)
- Artifact (verified from a fresh clone, two byte-identical builds): `p42/P-plugin/release-final/ai-commerce-copilot-1.1.2.zip`, 57 files, 842,792 bytes, **SHA-256 `e3f7763256552e490f6efe6f171f4bfbdca2f09cb77e5e17d017b8a66a4e02a9`**, built from commit `f31e2a7e510aea901b4f3202cddcabd31f5dd142`, expected signing key **primary `9d49-041f-0ced-13ac`**.
- Run the four blocks of `p42/P-plugin/OWNER-SIGNING-PACKAGE.md` (attach the vault read-only, run `infra/release/sign-plugin-release.sh` with `AICC_RELEASE_SIGNING_KEY_FILE` set to the key file, detach). It prints `SIGNED 1.1.2 key 9d49-041f-0ced-13ac` and verifies three ways. Hand me **only** `ai-commerce-copilot-1.1.2.manifest.sig` and its SHA-256. The private key never leaves your Mac.
- **If it fails:** the wrapper refuses (loose key permissions, dirty checkout, wrong fingerprint) and leaves nothing behind; the document lists each refusal.
- I then publish: dry-run first, then `--apply --set-current`, then `verify-published-plugin.sh` (30 checks incl. a signed-in download as your test account). Rollback: `--point-at` or `yank-plugin-release.sh`.
- **Stays disabled until done:** signup (blocker `plugin_release`).

## Package C: legal approval (counsel; the long pole)
- Read `p42/LEGAL-READINESS-REVIEW.md`. Key finding: **the live Terms, Privacy, Refund and DPA contain no trial terms at all** (nothing about the Dec 24 cutoff, one store, no card, no auto-conversion), the privacy text does not describe the self-service signup (Turnstile script, keyed IP buckets, waitlist, lifecycle e-mails), and some statements look stale (sub-processors, retention 12 months vs 90 days). The trial facts themselves are consistent on every Site page in all four languages; no page shows "Israel time" or any Jan-10 date.
- Needed from you/counsel: answers to the 20 policy questions (each has options and a recommended default; Q1 trial section in the Terms, Q4 data after Dec 31 = 90-day hold, Q5 hosting region, Q7 business-only, Q11 entity name/address, Q12 disclose Turnstile + the mail provider), then the six `AICC_LEGAL_*` owner facts.
- I then apply the mechanical redlines (R1-R11) and counsel's substantive text to the legal sources, re-publish through the CP legal tooling (new immutable versions v3.0), and you set the owner fact **`AICC_LEGAL_REVIEW_APPROVED=true`** (strict boolean) only on counsel's word. That is the code-enforced `legal_review` gate; it also removes the "Being finalized" banners. Keep a signed memo (document versions + SHA-256); the code records no approver.
- **Stays disabled until done:** signup (blockers `legal_review`).

## Package D: rotate the exposed webhook secret (about 30 minutes in a deploy window)
- `AICC_ENTITLEMENT_WEBHOOK_SECRET` appeared in an earlier transcript and is still live. The reviewed rotation tool (1,069 tests; independent review: no Critical/High) rotates it Backend-first then CP, with probes and a rollback ladder that can never leave the exposed secret active after `finalize`.
- Your action: read `p42/R-activation/WEBHOOK-ROTATION-OWNER-PACKAGE.md`; to authorize, reply with its **approval sentence** (section 9). It covers the three-file tool install and exactly one rotation, only after `plan` prints the expected identities, outside UTC hours 02-03.
- **If it fails:** the tool aborts before change or rolls back per section 6; merchants' entitlements are protected (in-flight events are retried; section 7 shows how to prove none was lost).
- **Stays as is until done:** the exposed secret remains live (a launch security gate).

## Package E: decisions only you can make (answer in one message)
1. **Reco mascot images** (3 files in the plugin): generated with ChatGPT, no rights evidence. Confirm you may ship them, or approve replacing them before publication.
2. **Strike clearance**: do you have a counsel reference to enable the comparative price? Default: no, the compliant planned-price design stays (the strike would still show only while signup is open).
3. **Jan-10 extension**: default OFF and unadvertised. Keep OFF? (If you ever turn it on it needs a constant + a ratified decision row, and the pages must say so before Dec 24.)
4. **Mail caps**: 25 signups inside one clock hour pause signup by design (account-class cap 20/hour; 100 customers = exactly the 100/day cap; the 240/day budget bites near 80 customers/day). Keep (safe) or raise with your Brevo plan?
5. **Backend defense-in-depth** (finding D1): a second store could briefly pass the Backend before the first entitlement lands; the CP's own limit of 1 refuses it first. Leave, or schedule a Backend fix (a gated deploy)?
6. **SPF**: optionally add `include:spf.brevo.com` to the copilt.org SPF record (DKIM alignment already passes DMARC; SPF currently lists only the registrar forwarder).
7. **Your test mailbox** for the first live self-test, and your explicit authorization to open trial issuance at **cap 25**.

## Package F: the first live activation (only when A-D are done and you authorize in Package E7)
I run, in order: final preflight (wait 15 min after any deploy, then one public request and `status`: expect `READY TO OPEN: yes`) → cap 25 + the switch as the last owner-facts stage → you sign up with the approved mailbox, Turnstile real, Brevo real → I confirm exactly one grant, the signed download, pairing, sync, a recommendation rendered, the dashboard row, and no billing side effect. Any critical failure: `wp aicc-trial pause` immediately (about 0.7 s, proven). Commerce and recurring billing stay OFF throughout.

## One reply is enough
"A done (site key: …). B done (sig sha256: …). C: counsel decisions attached / approved on <date>. D: <approval sentence>. E: 1 yes/replace, 2 no, 3 keep off, 4 keep, 5 leave, 6 yes/no, 7 mailbox …, open at 25: yes/no."
