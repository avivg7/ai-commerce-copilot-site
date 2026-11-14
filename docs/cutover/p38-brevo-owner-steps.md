# P38 Brevo mail: the three things only you can do

One page. Everything else (the host tooling, the facts, the render) is done by the operator with `docs/cutover/p38-brevo-host-update.md`. **The key is never typed into a chat, a ticket, an e-mail or a command line, and never pasted back to anyone.**

## Before you start

* In Brevo (SMTP & API, **API Keys**) create a new key with only **Transactional Email** permission. It starts with `xkeysib-`. **Not** the SMTP key (`xsmtpsib-`, "SMTP" tab): the script refuses that one with "this is an SMTP key, an API key is needed".
* You need the Terminal on your Mac, the production operator key `~/.ssh/aicc_cp_prod_operator` and the pinned host key `~/.ssh/known_hosts_aicc_prod` (they exist from the promotion; the script checks and tells you if not).
* The operator tells you the host tooling is updated and the facts are set (section 6.1 of the runbook). A mailbox you read (for example your Gmail) is your test mailbox.

## 1. Place the key (about two minutes)

In Terminal, from the Site checkout the operator names:

```bash
infra/provision/set-brevo-key.sh --dry-run                                        # local checks only, no connection, no secret: it prints the exact command it would run
infra/provision/set-brevo-key.sh --then-check --tests verify,welcome,trial_ending
```

What you will see and do:

1. `host identity verified: production, www.copilt.org, stage id 3e897286...` (if this line does not appear, stop: it is the wrong machine and nothing was sent).
2. `Brevo API key (input hidden ...)`: paste the key once and press Enter. **Nothing appears while you paste; that is correct.** Then paste it again at `confirm`. If the two differ, or it is the SMTP key, or it is malformed, nothing is sent.
3. `installed: /etc/aicc-mail/brevo-api.key root:aicc-cp 640 <size>` and a fingerprint of 8 characters. Note the fingerprint (it is not the key); it must match the line `fingerprint matches what you typed`.
4. `Render the configuration and reload PHP-FPM now? [y/N]`: it first lists the setting NAMES that will change (never values). Answer `y`.
5. It runs the read-only check, then asks for **a mailbox you control**. Type your test address, then `y`. It sends the three test messages and prints only `verify: ok` style lines and Brevo's message ids (your address is masked).

If anything says `REFUSED` before the key was sent, nothing was done; copy the REFUSED line (it never contains the key) to the operator. If it says **STATE UNKNOWN** (the connection dropped or the host reported a failure after the key was sent), the key may already be installed: run `set-brevo-key.sh status` (it never shows the key) before you retry or rotate. Rotating later: `set-brevo-key.sh rotate`; the old key is then gone from the host but **still valid in Brevo until you revoke it there** (the host keeps no copy of it). Stopping: `set-brevo-key.sh revoke` (type `REVOKE`), then revoke the key in Brevo too.

Your test address is sent to the host on stdin, never in a command line, and every host echo of it is masked; the one place it is visible is the `wp` process's argument list on the host while a test runs (single-tenant host, not in the sudo log).

## 2. Read the three test messages and paste back FIVE lines

Open one test message in the test mailbox (subject starts `[AICC delivery test]`, a "DELIVERY TEST" banner inside). Gmail: three dots, **Show original**. Paste back **only**:

```
SPF: ...            (the SPF line of the summary box)
DKIM: ...           (must say  DKIM: 'PASS' with domain copilt.org)
DMARC: ...          (must say  DMARC: 'PASS')
From: ...           (must be  AI Commerce Copilot <notifications@copilt.org>)
Reply-To: ...       (must be  support@copilt.org)
```

Not the whole header, not any link from the message, **never the key**. Also tell us if any of the three messages did not arrive (look in Spam) and whether the links in the message open (they should be on `copilt.org` or `mail.copilt.org`).

## 3. Prove that a reply reaches support

In the same mailbox press **Reply** on one test message. The To field must show `support@copilt.org`. Write "reply test" and send. Confirm the message arrives in the support mailbox through the existing Gmail forwarding within a few minutes, and tell us yes or no. **Do not change the forwarding.**

## If you pasted the key somewhere by mistake

Revoke it in Brevo immediately (SMTP & API, API Keys, delete), create a new one and run step 1 with `rotate` if a key file is already installed, or with `install` if none is (`infra/provision/set-brevo-key.sh status` tells you which; the host refuses the wrong one and says so). A revoked key is harmless; a pasted live key is not.

## Optional hardening: Brevo "Authorised IPs" (defense in depth)

In Brevo (Security, **Authorised IPs**) you can restrict the API key to the production host's address so a leaked key is useless elsewhere. If you do: add exactly `157.230.110.211` (the address the site sends from; confirm it first from the host: `~/aicc-promotion/pssh 'curl -4 -s https://api.ipify.org'`; the Reserved IP `206.189.248.204` is for incoming traffic and may differ). **Lock-out risk:** if the host's outbound address ever changes (new Droplet, restore elsewhere, a network change), every send fails with an `auth_failed` health status and mail stops until you correct the list. To lift it: remove the entry or switch the restriction off on the same Brevo screen, then run `sudo aicc-wp aicc-mail check`. Do this only after the first successful test messages, and write the change date down.
