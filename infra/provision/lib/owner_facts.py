#!/usr/bin/env python3
"""Owner facts for the Control Plane wp-config.php: parsing, validation and rendering. Standard library only.

The owner's non-secret launch facts (activation-proof key id, the AICC_LEGAL_* values, the payment-gateway allowlists, one extra outbound host for a payment
gateway) live in ONE root-only host file, /etc/aicc/owner-facts.env (mode 0600, root). render-wp-config.sh reads it on every render and writes the values into
the rendered wp-config.php; it never writes the file, so a re-render (new release, restore, --force-salts, promotion) can never lose a value. Nothing in this
file is a secret and nothing from it is ever committed: the repository only holds the KEY NAMES and the validators.

File format: one `KEY=value` per line (value = the rest of the line, surrounding blanks removed, no quoting), `#` comment lines and empty lines. UTF-8. The file
is parsed by this module only, never sourced by a shell and never included by PHP. Every value is validated and then written as a PHP single-quoted string with
backslash and apostrophe escaped (or as a boolean / date / array built from validated tokens), so nothing in a value can leave its string.

Used two ways: imported by render-wp-config.sh (importlib, because `python3 -I` does not put this directory on sys.path) and as a command by owner-facts.sh:
    python3 -I owner_facts.py list|check|set|unset --file F --env stage|production [KEY [VALUE]]
"""
import datetime
import os
import re
import stat
import sys
import tempfile
import unicodedata

# ---- key sets -------------------------------------------------------------------------------------------------------------------------------------------
ORDER = [
    "AICC_ACTIVATION_PROOF_KID",
    "AICC_LEGAL_ENTITY_NAME", "AICC_LEGAL_ENTITY_ADDRESS", "AICC_LEGAL_SUPPORT_EMAIL", "AICC_LEGAL_GOVERNING_LAW", "AICC_LEGAL_JURISDICTION",
    "AICC_LEGAL_PAYMENT_PROCESSOR", "AICC_LEGAL_VAT_DETAILS",
    "AICC_LEGAL_REVIEW_APPROVED", "AICC_LEGAL_SUBPROCESSORS_VERIFIED", "AICC_STRUCTURED_DATA_OFFERS", "AICC_COMMERCE_OPEN",
    "AICC_LM_PAID_GATEWAYS", "AICC_LM_PAYMENT_EVIDENCE_PROVIDER", "AICC_LAUNCH_REAL_GATEWAYS", "AICC_LM_PAYMENT_GATE_STRICT",
    "AICC_EXTRA_ACCESSIBLE_HOSTS",
    "AICC_TURNSTILE_ENABLED",
    "AICC_LM_PLUGIN_SIGNING_PUBKEYS",
    # ---- P35 hand-added constants pinned as owner facts (production only; rendered as the three delimited blocks the P35 script appended on 2026-11-13; ABSENT = OFF = today's golden render byte for byte) ----
    "AICC_OWNER_METRICS_TOKEN_FILE", "AICC_OWNER_METRICS_BASE", "AICC_OWNER_DASHBOARD_USER_IDS", "AICC_EA_LAUNCH_OFFER_MODE", "AICC_OWNER_OPS_SNAPSHOT_FILE",
    # ---- P38 Brevo API mail region (production only; renders into its own delimited region of the template, never into the owner-facts or P37 region; ABSENT = OFF = today's render byte for byte) ----
    "AICC_MAIL_PROVIDER", "AICC_MAIL_FROM_ADDRESS", "AICC_MAIL_FROM_NAME", "AICC_MAIL_REPLY_TO", "AICC_MAIL_DAILY_BUDGET", "AICC_MAIL_TEST_RECIPIENTS", "AICC_MAIL_STATUS_POLL_ENABLED",
    # ---- P37 self-service region (production only; everything below renders into the delimited P37 region, never into the owner-facts region; ABSENT = OFF = today's render byte for byte) ----
    "AICC_TRIAL_SELF_SERVICE_ENABLED", "AICC_TRIAL_SELF_SERVICE_CAP",
    "AICC_TURNSTILE_SITE_KEY",
    "AICC_NOTIFY_ENABLED", "AICC_NOTIFY_EXCLUDED_CUSTOMERS",
    "AICC_MAIL_MAX_PER_HOUR", "AICC_MAIL_MAX_PER_DAY",
    "AICC_FUNNEL_COUNTERS_ENABLED", "AICC_FUNNEL_ALLOWED_ORIGINS",
    "AICC_OWNER_OPS_SECTION_ENABLED", "AICC_MILESTONE_SYNC_SCHEDULED",
    "AICC_PLAN_CHANGE_ENABLED", "AICC_PAY_RECONCILE_ENABLED", "AICC_PRIVACY_REQUESTS_ENABLED",
]
P37_KEYS = ORDER[ORDER.index("AICC_TRIAL_SELF_SERVICE_ENABLED"):]
P35_KEYS = ORDER[ORDER.index("AICC_OWNER_METRICS_TOKEN_FILE"):ORDER.index("AICC_MAIL_PROVIDER")]
P38_KEYS = ORDER[ORDER.index("AICC_MAIL_PROVIDER"):ORDER.index("AICC_TRIAL_SELF_SERVICE_ENABLED")]
FREE_TEXT = {  # key -> maximum length in characters
    "AICC_LEGAL_ENTITY_NAME": 200, "AICC_LEGAL_ENTITY_ADDRESS": 300, "AICC_LEGAL_GOVERNING_LAW": 300, "AICC_LEGAL_JURISDICTION": 300,
    "AICC_LEGAL_PAYMENT_PROCESSOR": 80, "AICC_LEGAL_VAT_DETAILS": 300,
    "AICC_MAIL_FROM_NAME": 70,
}
TRUE_ONLY = ("AICC_LEGAL_REVIEW_APPROVED", "AICC_STRUCTURED_DATA_OFFERS", "AICC_LM_PAYMENT_GATE_STRICT", "AICC_COMMERCE_OPEN", "AICC_TURNSTILE_ENABLED",
             "AICC_TRIAL_SELF_SERVICE_ENABLED", "AICC_NOTIFY_ENABLED", "AICC_FUNNEL_COUNTERS_ENABLED", "AICC_OWNER_OPS_SECTION_ENABLED", "AICC_MILESTONE_SYNC_SCHEDULED",
             "AICC_PLAN_CHANGE_ENABLED", "AICC_PAY_RECONCILE_ENABLED", "AICC_PRIVACY_REQUESTS_ENABLED", "AICC_MAIL_STATUS_POLL_ENABLED")
# P37 self-service (see docs/cutover/p37-self-service-wp-config.md). Every P37 switch is TRUE_ONLY: exactly `true` or unset, and UNSET is the OFF state the Control Plane reads (each constant is "exactly boolean true or off"), so the
# default render defines none of them and is byte-identical to the render before the region existed. The Control Plane reads these constants and nothing else; the names below were verified against the Control Plane source (class files named
# in the doc). Secrets are never owner facts: the Turnstile SECRET and the SMTP credentials stay in root-placed files (AICC_TURNSTILE_SECRET_FILE / AICC_MAIL_SECRETS_FILE); only PUBLIC values (site key, origins, caps, user ids) are facts.
P37_APPROVED_CAPS = ("25", "50", "100")          # AICC_LM_Trial::APPROVED_CAP_STAGES
TURNSTILE_SECRET_FILE = "/etc/aicc-mail/turnstile.secret"   # fixed host path of the secret FILE (same 0750 root:aicc-cp directory as smtp.env, which PHP can already traverse); the renderer defines the constant only when the file passed every check
# AICC_TURNSTILE_ENABLED (P32 launch offer): exactly `true` or unset (unset = today's render, byte for byte). It renders NO define(): its only effect is that the renderer appends the ONE host the Control Plane's server-side
# Turnstile verification POSTs to (https://challenges.cloudflare.com/turnstile/v0/siteverify) to WP_ACCESSIBLE_HOSTS, because production blocks every other outbound request (WP_HTTP_BLOCK_EXTERNAL). Without it the
# request form can never pass its bot check. The Turnstile site key and secret are Control Plane constants and secret files, never owner facts of this file.
TURNSTILE_HOST = "challenges.cloudflare.com"
# AICC_COMMERCE_OPEN is the ONE switch for "commercial checkout is open" (pre-commercial truth round, docs/cutover/pre-commercial.md): production only, exactly `true`, UNSET = CLOSED. The public website is live
# before checkout opens, so unset is the normal state and the file never has to mention it. It can be set only when every launch fact the Control Plane launch gate (scripts/check-launch-blockers.php) demands from
# THIS file is present; the gate itself is the real lock (the Control Plane also needs WooCommerce "Coming soon" off AND a clean attested gate run before it treats commerce as open), and there is NO override.
COMMERCE_OPEN_REQUIRES = [
    "AICC_LEGAL_ENTITY_NAME", "AICC_LEGAL_ENTITY_ADDRESS", "AICC_LEGAL_SUPPORT_EMAIL", "AICC_LEGAL_GOVERNING_LAW", "AICC_LEGAL_JURISDICTION", "AICC_LEGAL_PAYMENT_PROCESSOR",
    "AICC_LEGAL_REVIEW_APPROVED", "AICC_LEGAL_SUBPROCESSORS_VERIFIED", "AICC_ACTIVATION_PROOF_KID", "AICC_LM_PAID_GATEWAYS", "AICC_LM_PAYMENT_EVIDENCE_PROVIDER", "AICC_LAUNCH_REAL_GATEWAYS",
]
# COM-GATE-01 (Production 14, owner decision OD-1): provider-side captured-payment verification is REQUIRED before commerce opens. AICC_LM_PAYMENT_EVIDENCE_PROVIDER names the provider tag (e.g. payplus);
# when it is set, EVERY id in AICC_LM_PAID_GATEWAYS is rendered with require_provider_evidence, that provider tag and an evidence environment that the RENDERER (never the owner) fixes: "live" for production,
# "sandbox" for the staging host. So a production file can neither leave a wallet id unflagged nor accept sandbox evidence. The Control Plane (AICC_LM_Payment_Readiness) refuses to open commerce without it, and
# without a registered adapter and an attested provider sandbox run; this fact alone enables nothing. No credential is ever an owner fact.
# Production derives strictness from its host name (www.copilt.org) or WP_ENVIRONMENT_TYPE=production (set by the production template), so it never needs (and may not set) AICC_LM_PAYMENT_GATE_STRICT; staging rehearses a payment sandbox with it.
# Staging never carries legal facts, launch switches or the launch allowlist: those describe the public launch.
KEYS_FOR = {
    "production": [k for k in ORDER if k != "AICC_LM_PAYMENT_GATE_STRICT"],  # includes AICC_LM_PLUGIN_SIGNING_PUBKEYS (public keys only; production serves the signed Plugin releases)
    "stage": ["AICC_ACTIVATION_PROOF_KID", "AICC_LM_PAID_GATEWAYS", "AICC_LM_PAYMENT_EVIDENCE_PROVIDER", "AICC_LM_PAYMENT_GATE_STRICT", "AICC_EXTRA_ACCESSIBLE_HOSTS", "AICC_TURNSTILE_ENABLED"],
}
BASE_HOST = {"production": "api.copilt.org", "stage": "stage.copilt.org"}
# ---- P35 owner-dashboard / launch-offer constants (the Control Plane reads: class-aicc-lm-owner-dashboard.php, class-aicc-lm-ea-requests.php) ---------------------------------------------------------------------------------
# These five lines were appended BY HAND to the live wp-config.php on 2026-11-13 (P35 gates B2, OFFER, SNAP: evidence in execution-reset/cp-dark/p35/b2-exec/wpconfig-add.sh), so every render would silently remove them. They are now owner facts; the renderer writes
# the SAME three delimited blocks, in the order the P35 script applied them (B2, OFFER, SNAP), each followed by one blank line, between the "intentionally NOT defined" line and the bootstrap banner. None of them is a secret: the token itself is a FILE the renderer never reads.
SHARED_DIR = "/srv/aicc/shared/"
SHARED_FORBIDDEN_FIRST = ("uploads", "plugin-releases")        # the public uploads tree and the private release store: a token or snapshot path must never point into them
SHARED_SEGMENT = r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}"             # no leading dot: no '.', no '..', no hidden file
OWNER_METRICS_BASE = "https://api.copilt.org"                   # AICC_LM_Owner_Dashboard::ALLOWED_BASE_HOSTS = api.copilt.org, https, default port, no path: nothing else is accepted by the Control Plane in production
EA_OFFER_MODES = ("announce",)                                  # the Control Plane also knows `open`, which depends on the request intake and the mail-provider constant: it stays a separate reviewed step; unset = off
P35_BLOCKS = (   # (block id, keys, the exact comment line the P35 script wrote)
    ("B2", ("AICC_OWNER_METRICS_TOKEN_FILE", "AICC_OWNER_METRICS_BASE", "AICC_OWNER_DASHBOARD_USER_IDS"),
     "// ---- Owner Dashboard (P35 gate B2, 2026-11-13): the Backend token is read server-side from this root-owned file (never sent to a browser), the Backend base is fixed, only the listed administrator may open the page ----"),
    ("OFFER", ("AICC_EA_LAUNCH_OFFER_MODE",), "// ---- Launch offer, ANNOUNCE mode only (2026-11-13 owner batch authorization): no request intake, no strike-through, no limited chip ----"),
    ("SNAP", ("AICC_OWNER_OPS_SNAPSHOT_FILE",), '// ---- Owner Dashboard ops snapshot (backup + recovery-gate state, produced on the owner Mac; 2026-11-13): optional, a stale or missing file reads "Not reported" ----'),
)

# ---- P38: Brevo transactional e-mail over the HTTPS API (docs/cutover/p38-brevo-host-update.md). Everything below is production only and DEFAULT OFF: with no P38 fact the render is byte for byte the render before P38. -----------------
# The ONE switch is AICC_MAIL_PROVIDER=brevo_api (`smtp` only says "use the smtp.env layer" when both secret files exist). The API KEY is never a fact and never a constant: it is the FILE /etc/aicc-mail/brevo-api.key, placed by the owner with
# infra/provision/set-brevo-key.sh (aicc-set-brevo-key on the host); wp-config carries only its PATH (AICC_MAIL_API_KEY_FILE), exactly like the Turnstile secret. Names verified against the Control Plane source (worktree p38-brevo):
# class-aicc-lm-mail.php (AICC_MAIL_PROVIDER, AICC_MAIL_API_KEY_FILE, AICC_MAIL_DAILY_BUDGET (default 240, clamped to 1-300 and to AICC_MAIL_MAX_PER_DAY), AICC_MAIL_ALLOWED_FROM_DOMAINS (array), AICC_MAIL_FROM_*, AICC_MAIL_REPLY_TO; a constant AICC_MAIL_API_KEY is refused),
# class-aicc-lm-mail-secret.php (KEY_PATTERN /^[A-Za-z0-9_-]{20,200}$/ on the first line; root-owned, no "other" bits, not group-writable, not a symlink, outside the web root).
BREVO_HOST = "api.brevo.com"                                  # the ONLY host added to WP_ACCESSIBLE_HOSTS, and only while the Brevo region is rendered; never a wildcard, never a subdomain pattern
BREVO_KEY_FILE = "/etc/aicc-mail/brevo-api.key"               # fixed host path of the key FILE (same 0750 root:aicc-cp directory as smtp.env / turnstile.secret)
BREVO_KEY_SHAPE = re.compile(rb"[A-Za-z0-9_-]{20,200}")  # bytes: the file is read as bytes and never decoded
BREVO_KEY_MAX_FILE_BYTES = 256
MAIL_FROM_DOMAINS = ("copilt.org",)                            # the Brevo-authenticated domain; a sender on any other domain is refused (subdomains too: only copilt.org is authenticated)
BREVO_FROM_NAME_DEFAULT = "AI Commerce Copilot"
BREVO_REPLY_TO_DEFAULT = "support@copilt.org"
BREVO_BUDGET_DEFAULT = 240
BREVO_DAY_CEILING = 300                                        # Brevo Free: 300 e-mails per day
MAIL_PROVIDERS = ("brevo_api", "smtp")
MAX_TEST_RECIPIENTS = 5
OWN_BREVO_SUFFIX = "brevo.com"
MAX_FILE_BYTES = 16384
PLACEHOLDER_GATEWAYS = ("bacs", "cheque", "cod")
MAX_GATEWAYS = 12
MAX_EXTRA_HOSTS = 5
MAX_SIGNING_KEYS = 2  # the Control Plane's AICC_LM_Release_Signature::MAX_KEYS (primary + standby so a rotation never strands anyone)
# top-level domains that are never a payment provider's public API
BAD_TLDS = {"localhost", "local", "internal", "intranet", "lan", "home", "corp", "test", "invalid", "example", "onion", "arpa", "localdomain"}


class OwnerFactsError(Exception):
    pass


# ---- validators -----------------------------------------------------------------------------------------------------------------------------------------
def _text(key, v):
    maxlen = FREE_TEXT[key]
    if len(v) > maxlen:
        raise OwnerFactsError("%s is longer than %d characters" % (key, maxlen))
    for ch in v:
        cat = unicodedata.category(ch)
        if cat[0] == "C" or cat in ("Zl", "Zp"):
            raise OwnerFactsError("%s contains a control, invisible or line-separator character (U+%04X): retype the value as plain text" % (key, ord(ch)))
    if "<" in v or ">" in v:
        raise OwnerFactsError("%s contains '<' or '>': not allowed (no markup, no PHP tags)" % key)
    if "@@" in v:
        raise OwnerFactsError("%s contains '@@': not allowed (template placeholder syntax)" % key)
    return v


def _email(key, v):
    if len(v) > 254 or not re.fullmatch(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", v):
        raise OwnerFactsError("%s is not a plain e-mail address (name@domain.tld)" % key)
    return v


def _kid(key, v):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", v):
        raise OwnerFactsError("%s must be 1-64 characters from [A-Za-z0-9._-], starting with a letter or digit (it must equal the Backend's ACTIVATION_PROOF_KID_CURRENT)" % key)
    return v


def _true(key, v):
    if v != "true":
        raise OwnerFactsError("%s must be exactly 'true' (to turn it off, unset it)" % key)
    return v


def _date(key, v):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v):  # ASCII digits only: \d would also match other Unicode digits (the PHP launch gate is ASCII)
        raise OwnerFactsError("%s must be a date YYYY-MM-DD" % key)
    try:
        datetime.date(int(v[:4]), int(v[5:7]), int(v[8:10]))
    except ValueError:
        raise OwnerFactsError("%s is not a real calendar date" % key)
    return v


# P45: the owner lost the passphrases of the two encrypted signing vaults made in P44; those key pairs are RETIRED and must never be a production trust anchor
# (fingerprints 9d49-041f-0ced-13ac and be7f-3dda-cddd-d781). PUBLIC values; the same pair is refused by infra/release/trust-anchor-plan.sh and the Plugin's release/retired-public-keys.txt.
RETIRED_SIGNING_PUBKEYS = {
    "yCsFX6176Ue5ZTdi4Dr99J9LFM43jXrN6Kbp13KF04Y=": "9d49-041f-0ced-13ac",
    "5p50qA1SYMTV7MXeDAWfMnNqLKVuTRDVS4FREuKuQwM=": "be7f-3dda-cddd-d781",
}


def parse_signing_pubkeys(key, v):
    """'<base64>[,<base64>]' -> canonical list: PUBLIC Ed25519 keys only, i.e. standard base64 of exactly 32 raw bytes (what AICC_LM_Release_Signature::parse_keys
    accepts), at most two, no duplicates. A 64-byte secret key or anything else is refused. Returned canonically re-encoded so the PHP side reads exactly this."""
    import base64
    import binascii
    out = []
    for raw in v.split(","):
        item = raw.strip()
        if not item:
            raise OwnerFactsError("%s has an empty entry (stray comma)" % key)
        if len(item) != 44 or not re.fullmatch(r"[A-Za-z0-9+/]{43}=", item):
            raise OwnerFactsError("%s: each key must be the standard base64 (44 characters, ending in '=') of a 32-byte Ed25519 PUBLIC key: this entry is not (%d characters)" % (key, len(item)))
        try:
            rawkey = base64.b64decode(item, validate=True)
        except (binascii.Error, ValueError):
            raise OwnerFactsError("%s: an entry is not valid base64" % key)
        if len(rawkey) != 32:
            raise OwnerFactsError("%s: each key must decode to exactly 32 bytes" % key)
        canon = base64.b64encode(rawkey).decode("ascii")
        if canon in RETIRED_SIGNING_PUBKEYS:
            raise OwnerFactsError("%s: that public key (fingerprint %s) is an OLD key and is RETIRED (P45: the passphrase of its vault was lost and the pair was replaced): it must never be a trust anchor" % (key, RETIRED_SIGNING_PUBKEYS[canon]))
        if canon in out:
            raise OwnerFactsError("%s lists the same key twice" % key)
        out.append(canon)
    if len(out) > MAX_SIGNING_KEYS:
        raise OwnerFactsError("%s lists more than %d keys (primary + standby)" % (key, MAX_SIGNING_KEYS))
    return out


GW_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
META = re.compile(r"[A-Za-z0-9_]{1,64}")


def _gateway_id(key, gid):
    if not GW_ID.fullmatch(gid):
        raise OwnerFactsError("%s: gateway id '%s' must be lower case [a-z0-9_-], 1-64 characters (the exact WooCommerce gateway id)" % (key, gid))
    if gid in PLACEHOLDER_GATEWAYS:
        raise OwnerFactsError("%s: '%s' is a WooCommerce placeholder method and can never be a paid gateway" % (key, gid))
    return gid


def parse_paid_gateways(key, v):
    """'id[:meta[:meta2]],id2...' -> [(id, [meta...])] ; exact ids only, no patterns."""
    out, seen = [], set()
    for raw in v.split(","):
        item = raw.strip()
        if not item:
            raise OwnerFactsError("%s has an empty entry (stray comma)" % key)
        parts = item.split(":")
        gid = _gateway_id(key, parts[0])
        if gid in seen:
            raise OwnerFactsError("%s lists '%s' twice" % (key, gid))
        seen.add(gid)
        metas = parts[1:]
        for m in metas:
            if not META.fullmatch(m):
                raise OwnerFactsError("%s: proof meta key '%s' must be [A-Za-z0-9_]{1,64}" % (key, m))
        out.append((gid, metas))
    if len(out) > MAX_GATEWAYS:
        raise OwnerFactsError("%s lists more than %d gateways" % (key, MAX_GATEWAYS))
    return out


PROVIDER_TAG = re.compile(r"[a-z0-9_-]{1,40}")


def _provider(key, v):
    if not PROVIDER_TAG.fullmatch(v):
        raise OwnerFactsError("%s: the provider tag '%s' must be lower case [a-z0-9_-], 1-40 characters (for example payplus); it is a name, never a credential" % (key, v[:60]))
    return v


def parse_gateway_list(key, v):
    out, seen = [], set()
    for raw in v.split(","):
        gid = _gateway_id(key, raw.strip())
        if gid in seen:
            raise OwnerFactsError("%s lists '%s' twice" % (key, gid))
        seen.add(gid)
        out.append(gid)
    if len(out) > MAX_GATEWAYS:
        raise OwnerFactsError("%s lists more than %d gateways" % (key, MAX_GATEWAYS))
    return out


LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")


def parse_hosts(key, v, env, allow_own=False):
    """Plain, lower-case DNS host names only: no wildcard, no IP literal, no port, no path, no internal-looking name, none of this project's own hosts."""
    out = []
    for raw in v.split(","):
        h = raw.strip().lower()
        if not h:
            raise OwnerFactsError("%s has an empty entry (stray comma)" % key)
        if "*" in h:
            raise OwnerFactsError("%s: wildcards are refused ('%s')" % (key, h))
        if len(h) > 253 or not re.fullmatch(r"[a-z0-9.-]+", h):
            raise OwnerFactsError("%s: '%s' is not a plain host name (letters, digits, hyphen and dots only: no scheme, port, path, underscore or space)" % (key, h[:60]))
        labels = h.split(".")
        if len(labels) < 2 or not all(LABEL.fullmatch(x) for x in labels):
            raise OwnerFactsError("%s: '%s' is not a fully qualified host name (at least two valid labels)" % (key, h))
        if not re.search(r"[a-z]", labels[-1]):
            raise OwnerFactsError("%s: '%s' looks like an IP address: only host names are allowed" % (key, h))
        if labels[-1] in BAD_TLDS:
            raise OwnerFactsError("%s: '%s' is a local or reserved name" % (key, h))
        if not allow_own and (h == "copilt.org" or h.endswith(".copilt.org")):
            raise OwnerFactsError("%s: '%s' is one of this project's own hosts: the API host is built in and nothing else of ours may be added" % (key, h))
        if h in out:
            raise OwnerFactsError("%s lists '%s' twice" % (key, h))
        out.append(h)
    if len(out) > MAX_EXTRA_HOSTS:
        raise OwnerFactsError("%s lists more than %d hosts" % (key, MAX_EXTRA_HOSTS))
    return out


# ---- P37 validators -------------------------------------------------------------------------------------------------------------------------------------
def _p37_cap(key, v):
    if v not in P37_APPROVED_CAPS:
        raise OwnerFactsError("%s must be exactly 25, 50 or 100 (the owner-approved stages; the Control Plane writes the constant as an integer and reads any other value as 'not an approved stage')" % key)
    return v


CF_TEST_CREDENTIAL = re.compile(r"[123]x0")   # Cloudflare's PUBLISHED dummy Turnstile keys (site keys 1x00000000000000000000AA / 2x...AB / 3x...FF, secrets 1x0000000000000000000000000000000AA ...): always pass / always block / force interaction. Real keys start 0x4.
CF_TEST_MSG = "Cloudflare test credentials are for tests only: create a real widget"


def _p37_site_key(key, v):
    if CF_TEST_CREDENTIAL.match(v):
        raise OwnerFactsError("%s: %s (a production signup behind a dummy key either lets every bot through or blocks every visitor)" % (key, CF_TEST_MSG))
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", v):  # AICC_LM_EA_Requests_Turnstile::site_key(): the PUBLIC site key; the SECRET never goes here (it lives in the secret file)
        raise OwnerFactsError("%s must be the PUBLIC Turnstile site key: 8-64 characters from [A-Za-z0-9_-]. The Turnstile SECRET key is never an owner fact: it goes into %s (hidden prompt, see docs/cutover/p37-self-service-wp-config.md)" % (key, TURNSTILE_SECRET_FILE))
    return v


def _p37_mail_cap(key, v):
    hi = {"AICC_MAIL_MAX_PER_HOUR": 2000, "AICC_MAIL_MAX_PER_DAY": 20000}[key]
    if not re.fullmatch(r"[1-9][0-9]{0,4}", v) or int(v) > hi:
        raise OwnerFactsError("%s must be a whole number from 1 to %d (the relay plan's own limit is the real ceiling; the Control Plane defaults are 60 per hour and 300 per day)" % (key, hi))
    return str(int(v))


def parse_origins(key, v):
    """Exact https origins (scheme + host [+ port]) as the Control Plane's AICC_LM_Funnel::allowed_origins() reads them: no path, no trailing slash, no wildcard, no IP literal, no local name; lower case; at most 5."""
    out = []
    for raw in v.split(","):
        o = raw.strip().lower()
        if not o:
            raise OwnerFactsError("%s has an empty entry (stray comma)" % key)
        m = re.fullmatch(r"https://([a-z0-9.-]+)(?::([0-9]{1,5}))?", o)
        if not m:
            raise OwnerFactsError("%s: '%s' is not an exact https origin (https://host or https://host:port: no path, no trailing slash, no wildcard, no http)" % (key, o[:80]))
        host = parse_hosts(key, m.group(1), "production", allow_own=True)[0]
        if m.group(2) is not None and not (1 <= int(m.group(2)) <= 65535):
            raise OwnerFactsError("%s: '%s' has a port outside 1-65535" % (key, o))
        canon = "https://" + host + ((":" + str(int(m.group(2)))) if m.group(2) else "")
        if canon in out:
            raise OwnerFactsError("%s lists '%s' twice" % (key, canon))
        out.append(canon)
    if len(out) > 5:
        raise OwnerFactsError("%s lists more than 5 origins" % key)
    return out


def parse_user_ids(key, v):
    """AICC_NOTIFY_EXCLUDED_CUSTOMERS: positive WordPress user ids only. The Control Plane also accepts a 64-hex address hash; this renderer does not write one into a config file (a hash of an e-mail address is personal data: mark the account with the user meta instead)."""
    out = []
    for raw in v.split(","):
        t = raw.strip()
        if re.fullmatch(r"[0-9a-fA-F]{64}", t):
            raise OwnerFactsError("%s: an address hash is not accepted here (it is personal data in a config file). List the numeric user id, or mark the account with the user meta _aicc_lm_synthetic_test_account" % key)
        if not re.fullmatch(r"[1-9][0-9]{0,9}", t):
            raise OwnerFactsError("%s: '%s' is not a positive user id (comma separated whole numbers, e.g. 2,7)" % (key, t[:40]))
        if int(t) in out:
            raise OwnerFactsError("%s lists user %s twice" % (key, t))
        out.append(int(t))
    if len(out) > 50:
        raise OwnerFactsError("%s lists more than 50 users" % key)
    return out


# ---- P35 validators -------------------------------------------------------------------------------------------------------------------------------------
def _shared_path(key, v):
    """An absolute path under /srv/aicc/shared/ naming ONE regular file (the renderer never reads it): no traversal, no hidden segment, no trailing slash, not in the public uploads tree or the private release store, not wp-config itself."""
    if len(v) > 200 or not re.fullmatch(re.escape(SHARED_DIR) + SHARED_SEGMENT + "(?:/" + SHARED_SEGMENT + "){0,3}", v):
        raise OwnerFactsError("%s must be an absolute path under %s naming one file (letters, digits, . _ - only; no '..', no hidden segment, no trailing slash, at most 4 segments)" % (key, SHARED_DIR))
    first = v[len(SHARED_DIR):].split("/")[0]
    if first in SHARED_FORBIDDEN_FIRST or first.startswith("wp-config"):
        raise OwnerFactsError("%s must not point into %s (the public uploads tree, the private release store) or at wp-config" % (key, first))
    return v


def _owner_metrics_base(key, v):
    if v != OWNER_METRICS_BASE:
        raise OwnerFactsError("%s must be exactly %s (an https origin: no path, no port, no trailing slash; the Control Plane accepts no other Backend host in production)" % (key, OWNER_METRICS_BASE))
    return v


def _offer_mode(key, v):
    if v not in EA_OFFER_MODES:
        raise OwnerFactsError("%s must be exactly 'announce' (the Control Plane's `open` needs the request intake and the mail-provider constant and is a separate reviewed step; to turn the offer off, unset it)" % key)
    return v


# ---- P38 validators -------------------------------------------------------------------------------------------------------------------------------------
def _mail_provider(key, v):
    if v not in MAIL_PROVIDERS:
        raise OwnerFactsError("%s must be exactly brevo_api or smtp (to turn mail off again, unset it; the SMTP layer is selected by placing smtp.env, the Brevo API by this fact)" % key)
    return v


def _brevo_from_address(key, v):
    v = _email(key, v)
    local, domain = v.rsplit("@", 1)
    if domain.lower() not in MAIL_FROM_DOMAINS:
        raise OwnerFactsError("%s must be an address @%s (the domain Brevo authenticated; any other sender would fail SPF/DKIM/DMARC alignment)" % (key, " or @".join(MAIL_FROM_DOMAINS)))
    return local + "@" + domain.lower()


def _from_name(key, v):
    v = _text(key, v)
    if '"' in v:
        raise OwnerFactsError("%s contains a double quote: not allowed (it is placed into a From header)" % key)
    return v


def _daily_budget(key, v):
    if not re.fullmatch(r"[1-9][0-9]{0,2}", v) or int(v) > BREVO_DAY_CEILING:
        raise OwnerFactsError("%s must be a whole number from 1 to %d (Brevo Free sends at most %d e-mails per day; the default is %d)" % (key, BREVO_DAY_CEILING, BREVO_DAY_CEILING, BREVO_BUDGET_DEFAULT))
    return str(int(v))


def parse_test_recipients(key, v):
    """1-5 exact plain addresses, comma separated. Personal data: no message in this module ever repeats a value."""
    out, seen = [], set()
    for raw in v.split(","):
        a = raw.strip()
        if not a:
            raise OwnerFactsError("%s has an empty entry (stray comma)" % key)
        _email(key, a)
        if a.lower() in seen:
            raise OwnerFactsError("%s lists the same address twice" % key)
        seen.add(a.lower())
        out.append(a)
    if len(out) > MAX_TEST_RECIPIENTS:
        raise OwnerFactsError("%s lists more than %d addresses" % (key, MAX_TEST_RECIPIENTS))
    return out


def mask_address(a):
    """first character of the local part + *** + the domain: what `list` shows of a test recipient."""
    local, _, domain = a.partition("@")
    return (local[:1] + "***@" + domain) if domain else "***"


def check_brevo_key_file(path):
    """The Brevo API key FILE, judged the way the Control Plane reads it (AICC_LM_Mail_Secret): a regular file, not a symlink, the FIRST line matches [A-Za-z0-9_-]{20,200} (anything else on the file is refused: a second line could
    be another secret), and it is not an SMTP key (`xsmtpsib-`). Reads at most BREVO_KEY_MAX_FILE_BYTES + 1 bytes and returns NOTHING derived from the content: the caller gets True or an OwnerFactsError whose text never contains
    a character of the file. Permissions and ownership are checked by the renderer (stat), not here."""
    if os.path.islink(path) or not os.path.isfile(path):
        raise OwnerFactsError("%s is not a regular file" % path)
    size = os.path.getsize(path)
    if size < 20 or size > BREVO_KEY_MAX_FILE_BYTES:
        raise OwnerFactsError("%s must be 20-%d bytes (is %d)" % (path, BREVO_KEY_MAX_FILE_BYTES, size))
    with open(path, "rb") as f:
        raw = f.read(BREVO_KEY_MAX_FILE_BYTES + 1)
    lines = raw.split(b"\n")
    if lines and lines[-1] == b"":
        lines = lines[:-1]
    if len(lines) != 1 or not BREVO_KEY_SHAPE.fullmatch(lines[0]):
        raise OwnerFactsError("%s: the file must hold exactly one line, the Brevo API key: 20-200 characters from [A-Za-z0-9_-] (the Control Plane would read it as 'no key')" % path)
    if lines[0].startswith(b"xsmtpsib-"):
        raise OwnerFactsError("%s holds an SMTP key (xsmtpsib-...): an API key is needed (Brevo: SMTP & API -> API Keys)" % path)
    return True


def mail_mode(facts, ctx):
    """Which mail transport the render uses: (mode, notes, problems). mode in none | smtp | brevo_api | unknown (ctx None: the host state is not known).
    ctx: {"mail": a SAFE /etc/aicc-mail/smtp.env exists, "brevo_key": a VALID /etc/aicc-mail/brevo-api.key exists}. The explicit fact AICC_MAIL_PROVIDER decides; without it only one of the two files may exist.
    A fact that names a transport whose file is absent yields mode none (mail OFF, never half-enabled) plus a note: a rebuilt host with the facts but without the secret must still be able to render."""
    notes, problems = [], []
    if ctx is None:
        return "unknown", notes, problems
    smtp, key = bool(ctx.get("mail")), bool(ctx.get("brevo_key"))
    prov = facts.get("AICC_MAIL_PROVIDER")
    if prov != "brevo_api":
        inert = [k for k in P38_KEYS if k in facts and k != "AICC_MAIL_PROVIDER"]
        if inert:
            notes.append("%s set but AICC_MAIL_PROVIDER is not brevo_api: ignored (the Brevo API region is not rendered)" % ", ".join(inert))
    if prov == "brevo_api":
        if key:
            return "brevo_api", notes, problems
        notes.append("AICC_MAIL_PROVIDER=brevo_api but %s is absent: the Brevo region is NOT rendered and the site sends NO mail (place the key with set-brevo-key.sh, then re-render)" % BREVO_KEY_FILE)
        return "none", notes, problems
    if prov == "smtp":
        if smtp:
            return "smtp", notes, problems
        notes.append("AICC_MAIL_PROVIDER=smtp but there is no safe /etc/aicc-mail/smtp.env: the SMTP region is NOT rendered and the site sends NO mail")
        return "none", notes, problems
    if smtp and key:
        problems.append("both /etc/aicc-mail/smtp.env and %s exist and AICC_MAIL_PROVIDER is not set: the render will not guess. `aicc-owner-facts set AICC_MAIL_PROVIDER brevo_api` (or smtp), or remove the file you do not use" % BREVO_KEY_FILE)
        return "none", notes, problems
    if key:
        notes.append("%s exists but AICC_MAIL_PROVIDER is not set to brevo_api: the key is ignored (no Brevo region, no mail through Brevo)" % BREVO_KEY_FILE)
        return "none", notes, problems
    return ("smtp" if smtp else "none"), notes, problems


def p38_problems(facts, env, ctx=None):
    """The P38 readiness rules (empty list = consistent). ctx as in mail_mode (None = host state unknown: only the rules decidable from the facts alone run)."""
    if env != "production":
        return []
    out = []
    if ctx is not None:
        out += mail_mode(facts, ctx)[2]
    keys_set = [k for k in P38_KEYS if k in facts]
    day = int(facts["AICC_MAIL_MAX_PER_DAY"]) if "AICC_MAIL_MAX_PER_DAY" in facts else None
    hour = int(facts["AICC_MAIL_MAX_PER_HOUR"]) if "AICC_MAIL_MAX_PER_HOUR" in facts else None
    prov = facts.get("AICC_MAIL_PROVIDER")
    if prov == "brevo_api":
        if day is not None and day > BREVO_DAY_CEILING:
            out.append("AICC_MAIL_MAX_PER_DAY (%d) is above %d, the Brevo Free daily limit: the provider would refuse what the site thinks it may send" % (day, BREVO_DAY_CEILING))
        if hour is not None and hour > BREVO_DAY_CEILING:
            out.append("AICC_MAIL_MAX_PER_HOUR (%d) is above %d, the Brevo Free daily limit" % (hour, BREVO_DAY_CEILING))
    if not keys_set:
        return out
    if prov != "brevo_api":
        # sender / name / reply-to / budget / test recipients without the provider fact are INERT (the region is not rendered; mail_mode notes them): that is what makes `unset AICC_MAIL_PROVIDER` a one-command way to turn Brevo mail off.
        # The status poll is the exception: it is a switch that registers a WP-Cron event, so it may never stay on without the provider (unset it first, or in the same command line).
        if "AICC_MAIL_STATUS_POLL_ENABLED" in facts:
            out.append("AICC_MAIL_STATUS_POLL_ENABLED set but AICC_MAIL_PROVIDER is not brevo_api: the status poll exists only with the Brevo API transport (`aicc-owner-facts unset AICC_MAIL_STATUS_POLL_ENABLED` first)")
        return out
    if "AICC_MAIL_FROM_ADDRESS" not in facts:
        out.append("AICC_MAIL_PROVIDER=brevo_api needs AICC_MAIL_FROM_ADDRESS (the verified sender, an address @copilt.org): no sender is guessed")
    budget = int(facts["AICC_MAIL_DAILY_BUDGET"]) if "AICC_MAIL_DAILY_BUDGET" in facts else BREVO_BUDGET_DEFAULT
    if day is not None and budget > day:
        if "AICC_MAIL_DAILY_BUDGET" in facts:
            out.append("AICC_MAIL_DAILY_BUDGET (%d) is above AICC_MAIL_MAX_PER_DAY (%d): the day cap would always stop the budget first" % (budget, day))
        else:
            out.append("AICC_MAIL_MAX_PER_DAY (%d) is below the default daily budget %d: set AICC_MAIL_DAILY_BUDGET to %d or less explicitly" % (day, BREVO_BUDGET_DEFAULT, day))
    return out


def render_p38(facts, env, ctx):
    """(lines, hosts) of the Brevo API region: ([], []) unless the transport is brevo_api (provider fact + a valid key file). The key itself is never read here; only the PATH constant is written.
    api.brevo.com is added to the outbound allow-list ONLY here, so it exists in the render exactly when (and once) the region does."""
    if env != "production":
        return [], []
    problems = p38_problems(facts, env, ctx)
    if problems:
        raise OwnerFactsError("P38 Brevo mail region REFUSED (nothing is rendered): " + " | ".join(problems))
    if mail_mode(facts, ctx)[0] != "brevo_api":
        return [], []
    lines = [
        "define( 'AICC_MAIL_ENABLED', true );",
        "define( 'AICC_MAIL_PROVIDER', 'brevo_api' );",
        "define( 'AICC_MAIL_API_KEY_FILE', %s );" % php_str(BREVO_KEY_FILE),
        "define( 'AICC_MAIL_FROM_ADDRESS', %s );" % php_str(facts["AICC_MAIL_FROM_ADDRESS"]),
        "define( 'AICC_MAIL_FROM_NAME', %s );" % php_str(facts.get("AICC_MAIL_FROM_NAME", BREVO_FROM_NAME_DEFAULT)),
        "define( 'AICC_MAIL_REPLY_TO', %s );" % php_str(facts.get("AICC_MAIL_REPLY_TO", BREVO_REPLY_TO_DEFAULT)),
        "define( 'AICC_MAIL_ALLOWED_FROM_DOMAINS', array( %s ) );" % ", ".join(php_str(d) for d in MAIL_FROM_DOMAINS),
        "define( 'AICC_MAIL_DAILY_BUDGET', %d );" % (int(facts["AICC_MAIL_DAILY_BUDGET"]) if "AICC_MAIL_DAILY_BUDGET" in facts else BREVO_BUDGET_DEFAULT),
    ]
    if "AICC_MAIL_TEST_RECIPIENTS" in facts:
        lines.append("define( 'AICC_MAIL_TEST_RECIPIENTS', %s );" % php_str(facts["AICC_MAIL_TEST_RECIPIENTS"]))
    if "AICC_MAIL_STATUS_POLL_ENABLED" in facts:
        lines.append("define( 'AICC_MAIL_STATUS_POLL_ENABLED', true );")
    return lines, [BREVO_HOST]


def check_turnstile_secret_file(path):
    """The Turnstile secret FILE, judged exactly as the Control Plane reads it (AICC_LM_EA_Requests_Turnstile::read_secret): regular file, not a symlink, 8-1024 bytes, first line trimmed = 8-256 printable ASCII characters (0x21-0x7E).
    Returns the secret for an IN-MEMORY comparison only; callers must never print or write it. Permissions and ownership are checked by the renderer (stat), not here."""
    if os.path.islink(path) or not os.path.isfile(path):
        raise OwnerFactsError("%s is not a regular file" % path)
    size = os.path.getsize(path)
    if size < 8 or size > 1024:
        raise OwnerFactsError("%s must be 8-1024 bytes (is %d)" % (path, size))
    with open(path, "rb") as f:
        raw = f.read()
    first = re.split(rb"\r\n|\n|\r", raw)[0].strip(b" \t\n\r\0\x0b")
    if not re.fullmatch(rb"[\x21-\x7e]{8,256}", first):
        raise OwnerFactsError("%s: the first line must be the Turnstile secret key, 8-256 printable characters with no space (the Control Plane would read it as 'no secret')" % path)
    if CF_TEST_CREDENTIAL.match(first.decode("ascii")):
        raise OwnerFactsError("%s: %s (the secret file holds one of Cloudflare's public dummy secrets)" % (path, CF_TEST_MSG))
    return first.decode("ascii")


def validate_value(key, value, env):
    """Returns the normalised value (a str); raises OwnerFactsError."""
    if env not in KEYS_FOR:
        raise OwnerFactsError("unknown environment '%s'" % env)
    if key not in ORDER:
        raise OwnerFactsError("unknown key '%s' (allowed: %s)" % (key, ", ".join(KEYS_FOR[env])))
    if key not in KEYS_FOR[env]:
        raise OwnerFactsError("%s is not allowed for %s (allowed: %s)" % (key, env, ", ".join(KEYS_FOR[env])))
    v = value.strip()
    if v == "":
        raise OwnerFactsError("%s has an empty value (use `unset` to remove it)" % key)
    if key in ("AICC_OWNER_METRICS_TOKEN_FILE", "AICC_OWNER_OPS_SNAPSHOT_FILE"):
        return _shared_path(key, v)
    if key == "AICC_OWNER_METRICS_BASE":
        return _owner_metrics_base(key, v)
    if key == "AICC_OWNER_DASHBOARD_USER_IDS":
        return ",".join(str(i) for i in parse_user_ids(key, v))
    if key == "AICC_EA_LAUNCH_OFFER_MODE":
        return _offer_mode(key, v)
    if key == "AICC_MAIL_FROM_NAME":
        return _from_name(key, v)
    if key in FREE_TEXT:
        return _text(key, v)
    if key == "AICC_LEGAL_SUPPORT_EMAIL":
        return _email(key, v)
    if key == "AICC_MAIL_REPLY_TO":
        return _brevo_from_address(key, v)   # the same allowed-domain rule as the sender: replies must land in a mailbox on our own domain
    if key == "AICC_MAIL_PROVIDER":
        return _mail_provider(key, v)
    if key == "AICC_MAIL_FROM_ADDRESS":
        return _brevo_from_address(key, v)
    if key == "AICC_MAIL_DAILY_BUDGET":
        return _daily_budget(key, v)
    if key == "AICC_MAIL_TEST_RECIPIENTS":
        return ",".join(parse_test_recipients(key, v))
    if key == "AICC_ACTIVATION_PROOF_KID":
        return _kid(key, v)
    if key in TRUE_ONLY:
        return _true(key, v)
    if key == "AICC_TRIAL_SELF_SERVICE_CAP":
        return _p37_cap(key, v)
    if key == "AICC_TURNSTILE_SITE_KEY":
        return _p37_site_key(key, v)
    if key in ("AICC_MAIL_MAX_PER_HOUR", "AICC_MAIL_MAX_PER_DAY"):
        return _p37_mail_cap(key, v)
    if key == "AICC_FUNNEL_ALLOWED_ORIGINS":
        return ",".join(parse_origins(key, v))
    if key == "AICC_NOTIFY_EXCLUDED_CUSTOMERS":
        return ",".join(str(i) for i in parse_user_ids(key, v))
    if key == "AICC_LEGAL_SUBPROCESSORS_VERIFIED":
        return _date(key, v)
    if key == "AICC_LM_PAID_GATEWAYS":
        return ",".join(g + "".join(":" + m for m in metas) for g, metas in parse_paid_gateways(key, v))
    if key == "AICC_LM_PAYMENT_EVIDENCE_PROVIDER":
        return _provider(key, v)
    if key == "AICC_LAUNCH_REAL_GATEWAYS":
        return ",".join(parse_gateway_list(key, v))
    if key == "AICC_EXTRA_ACCESSIBLE_HOSTS":
        hosts = parse_hosts(key, v, env)
        for h in hosts:
            if h == OWN_BREVO_SUFFIX or h.endswith("." + OWN_BREVO_SUFFIX):
                raise OwnerFactsError("%s: '%s' is a Brevo host: %s is added to WP_ACCESSIBLE_HOSTS only by AICC_MAIL_PROVIDER=brevo_api (with a valid key file), never as an extra host" % (key, h, BREVO_HOST))
        return ",".join(hosts)
    if key == "AICC_LM_PLUGIN_SIGNING_PUBKEYS":
        return ",".join(parse_signing_pubkeys(key, v))
    raise OwnerFactsError("no validator for %s" % key)  # unreachable: keeps a new key from being added without one


def validate_all(facts, env):
    """facts: {key: raw value}. Returns the normalised dict; checks the cross-key rules."""
    out = {k: validate_value(k, v, env) for k, v in facts.items()}
    if "AICC_COMMERCE_OPEN" in out:
        missing = [k for k in COMMERCE_OPEN_REQUIRES if k not in out]
        if missing:
            raise OwnerFactsError("AICC_COMMERCE_OPEN=true is refused while these owner facts are missing (the launch gate would report each as a blocker, and a clean gate run is what lets commerce open): %s. Set them first and set AICC_COMMERCE_OPEN last; to close commerce again, `unset AICC_COMMERCE_OPEN`. There is no override." % ", ".join(missing))
    if "AICC_LAUNCH_REAL_GATEWAYS" in out:
        paid = {g for g, _ in parse_paid_gateways("AICC_LM_PAID_GATEWAYS", out["AICC_LM_PAID_GATEWAYS"])} if "AICC_LM_PAID_GATEWAYS" in out else set()
        for g in parse_gateway_list("AICC_LAUNCH_REAL_GATEWAYS", out["AICC_LAUNCH_REAL_GATEWAYS"]):
            if g not in paid:
                raise OwnerFactsError("AICC_LAUNCH_REAL_GATEWAYS names '%s' which is not in AICC_LM_PAID_GATEWAYS: customers would pay and the payment gate would refuse their license. Set AICC_LM_PAID_GATEWAYS first (it may list more ids than the launch list, e.g. wallet ids)" % g)
    return out


# ---- file ------------------------------------------------------------------------------------------------------------------------------------------------
def parse_file(path, env):
    """Strictly parses the file. A missing file is {} ; anything unexpected raises."""
    if not os.path.lexists(path):
        return {}
    st = os.lstat(path)
    if not stat.S_ISREG(st.st_mode):
        raise OwnerFactsError("%s is not a regular file (a symbolic link or special file is refused)" % path)
    if st.st_size > MAX_FILE_BYTES:
        raise OwnerFactsError("%s is larger than %d bytes" % (path, MAX_FILE_BYTES))
    try:
        text = open(path, "rb").read().decode("utf-8")
    except UnicodeDecodeError:
        raise OwnerFactsError("%s is not valid UTF-8" % path)
    if "\x00" in text or "\r" in text:
        raise OwnerFactsError("%s contains a NUL or carriage-return character (use Unix line endings)" % path)
    raw = {}
    for n, line in enumerate(text.split("\n"), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if not m:
            raise OwnerFactsError("%s line %d is not KEY=value" % (path, n))
        if m.group(1) in raw:
            raise OwnerFactsError("%s line %d repeats key %s" % (path, n, m.group(1)))
        raw[m.group(1)] = m.group(2)
    return validate_all(raw, env)


def file_text(facts):
    """The exact text of the facts file for validated `facts` (also what `export` prints)."""
    lines = ["# AICC owner facts for the Control Plane wp-config.php. Managed by owner-facts.sh (set / unset / list); read by render-wp-config.sh. NOT secrets, never committed.",
             "# One KEY=value per line, value = the rest of the line. Edit with `sudo aicc-owner-facts set KEY VALUE`, then re-render."]
    lines += ["%s=%s" % (k, facts[k]) for k in ORDER if k in facts]
    return "\n".join(lines) + "\n"


def write_file(path, facts, env):
    """Atomic replace, mode 0600. `facts` must already be validated."""
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".owner-facts.", dir=d)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(file_text(facts))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---- rendering --------------------------------------------------------------------------------------------------------------------------------------------
def php_str(v):
    return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"


def render_problems(facts, env, ctx=None):
    """The same rules as require_render_ready, as a list of plain problems (empty = renderable)."""
    out = ["P38: " + p for p in p38_problems(facts, env, ctx)] + ["P37: " + p for p in p37_problems(facts, env, ctx)]
    if env == "production" and "AICC_LM_PAID_GATEWAYS" in facts and "AICC_LM_PAYMENT_EVIDENCE_PROVIDER" not in facts:
        out.append("COM-GATE-01: AICC_LM_PAID_GATEWAYS is set but AICC_LM_PAYMENT_EVIDENCE_PROVIDER is not")
    return out


def require_render_ready(facts, env, ctx=None):
    """Cross-key rules that decide whether a file may be RENDERED (not whether it may be edited: the keys can be set in any order). Production 17 (COM-GATE-01 / residual R-3):
    a production render that lists paid gateways but names no evidence provider would produce gateways without `require_provider_evidence`, i.e. the payment gate would accept a
    completed order on the strength of a transaction id alone. That is the unverified path COM-GATE-01 forbids, so the render (and `check`, which the renderer and the promotion
    preflight both run first) refuses it. Dark production (no gateways listed) stays renderable."""
    problems38 = p38_problems(facts, env, ctx)
    if problems38:
        raise OwnerFactsError("P38 Brevo mail region REFUSED (nothing is rendered): " + " | ".join(problems38))
    problems = p37_problems(facts, env, ctx)
    if problems:
        raise OwnerFactsError("P37 self-service region REFUSED (nothing is rendered): " + " | ".join(problems))
    if env == "production" and "AICC_LM_PAID_GATEWAYS" in facts and "AICC_LM_PAYMENT_EVIDENCE_PROVIDER" not in facts:
        raise OwnerFactsError("AICC_LM_PAID_GATEWAYS is set but AICC_LM_PAYMENT_EVIDENCE_PROVIDER is not: a production render would accept a paid order on a transaction id alone, with no provider-side verification (COM-GATE-01). Set the provider (e.g. `set AICC_LM_PAYMENT_EVIDENCE_PROVIDER <tag>`) or `unset AICC_LM_PAID_GATEWAYS`. There is no override.")


def p37_problems(facts, env, ctx=None):
    """The P37 readiness rules, mirroring the Control Plane's own (AICC_LM_Signup::blockers(): `turnstile` = site key + secret file, `mail` = the SMTP layer active, `turnstile_blocked` = challenges.cloudflare.com not on WP_ACCESSIBLE_HOSTS;
    AICC_LM_Trial::mode(): the switch AND a cap >= 1, else `off`) plus the notification rule (self-service promises verification, welcome, reminder and expiry mail: they exist only with AICC_NOTIFY_ENABLED and a working transport).
    Returns a list of plain-language problems (empty = consistent). `ctx` is the HOST STATE the renderer verified: {"mail": bool (a safe /etc/aicc-mail/smtp.env exists), "turnstile_secret": bool (a safe Turnstile secret file exists)};
    None = host state unknown (a bare `check` or the promotion preflight): only the rules decidable from the facts alone run, the renderer repeats the check with the host state before it writes anything."""
    if env != "production" or not any(k in facts for k in P37_KEYS):
        return []
    out = []
    on = "AICC_TRIAL_SELF_SERVICE_ENABLED" in facts
    notify = "AICC_NOTIFY_ENABLED" in facts
    if ctx is not None:   # P38: the mail layer is "ready" when EITHER transport is the one the render uses (smtp.env, or the Brevo API with a valid key file); the P37 rules below read this
        ctx = dict(ctx)
        ctx["mail"] = mail_mode(facts, ctx)[0] in ("smtp", "brevo_api")
    if on:
        if "AICC_TRIAL_SELF_SERVICE_CAP" not in facts:
            out.append("AICC_TRIAL_SELF_SERVICE_ENABLED needs AICC_TRIAL_SELF_SERVICE_CAP (25, 50 or 100): without a cap the Control Plane reads the switch as OFF, so the file would claim an open signup that is closed")
        if "AICC_TURNSTILE_SITE_KEY" not in facts:
            out.append("AICC_TRIAL_SELF_SERVICE_ENABLED needs AICC_TURNSTILE_SITE_KEY: without the Turnstile site key the signup reads `paused` (blocker `turnstile`)")
        if "AICC_TURNSTILE_ENABLED" not in facts:
            out.append("AICC_TRIAL_SELF_SERVICE_ENABLED needs AICC_TURNSTILE_ENABLED=true: it puts challenges.cloudflare.com on WP_ACCESSIBLE_HOSTS; without it every submission is refused by WordPress itself (blocker `turnstile_blocked`)")
        if "AICC_LEGAL_REVIEW_APPROVED" not in facts:
            out.append("AICC_TRIAL_SELF_SERVICE_ENABLED needs AICC_LEGAL_REVIEW_APPROVED=true (P42): the Control Plane keeps the public signup `paused` (blocker `legal_review`) unless that constant is the boolean true. Set it ONLY after counsel has approved and the documents were re-published; it also removes the `Being finalized` banners from the Control Plane legal pages")
        if not notify:
            out.append("AICC_TRIAL_SELF_SERVICE_ENABLED needs AICC_NOTIFY_ENABLED=true: a self-service trial is promised its welcome, reminder and expiry mail, and the notification center that sends them is OFF while that switch is unset")
        if ctx is not None and not ctx.get("turnstile_secret"):
            out.append("AICC_TRIAL_SELF_SERVICE_ENABLED needs the Turnstile secret file (%s, root:aicc-cp 0640): none was found, so the signup would read `paused` (blocker `turnstile`)" % TURNSTILE_SECRET_FILE)
        if ctx is not None and not ctx.get("mail"):
            out.append("AICC_TRIAL_SELF_SERVICE_ENABLED needs the mail layer: no safe /etc/aicc-mail/smtp.env and no Brevo API key (AICC_MAIL_PROVIDER=brevo_api + /etc/aicc-mail/brevo-api.key), so AICC_MAIL_ENABLED is not rendered and the signup reads `paused` (blocker `mail`)")
    if notify and ctx is not None and not ctx.get("mail"):
        out.append("AICC_NOTIFY_ENABLED needs the mail layer (a safe /etc/aicc-mail/smtp.env): the notification center would queue mail it can never send")
    if "AICC_TURNSTILE_SITE_KEY" in facts and ctx is not None and not ctx.get("turnstile_secret"):
        out.append("AICC_TURNSTILE_SITE_KEY is set but there is no Turnstile secret file (%s): the widget would render and every verification would fail" % TURNSTILE_SECRET_FILE)
    caps = [k for k in ("AICC_MAIL_MAX_PER_HOUR", "AICC_MAIL_MAX_PER_DAY") if k in facts]
    if caps and ctx is not None and not ctx.get("mail"):
        out.append("%s set but the mail layer is not enabled (no safe /etc/aicc-mail/smtp.env): a cap for a layer that is not running" % " and ".join(caps))
    if len(caps) == 2 and int(facts["AICC_MAIL_MAX_PER_HOUR"]) > int(facts["AICC_MAIL_MAX_PER_DAY"]):
        out.append("AICC_MAIL_MAX_PER_HOUR (%s) is above AICC_MAIL_MAX_PER_DAY (%s): the day cap would always stop the hour first" % (facts["AICC_MAIL_MAX_PER_HOUR"], facts["AICC_MAIL_MAX_PER_DAY"]))
    if "AICC_FUNNEL_ALLOWED_ORIGINS" in facts and "AICC_FUNNEL_COUNTERS_ENABLED" not in facts:
        out.append("AICC_FUNNEL_ALLOWED_ORIGINS is set but AICC_FUNNEL_COUNTERS_ENABLED is not: the origins would configure a route that does not exist")
    if "AICC_PAY_RECONCILE_ENABLED" in facts and "AICC_LM_PAID_GATEWAYS" not in facts:
        out.append("AICC_PAY_RECONCILE_ENABLED needs a configured payment path (AICC_LM_PAID_GATEWAYS): the reconcile runs only when a provider is enabled, and no provider is configured while Commerce is closed")
    return out


def render_p37(facts, env, ctx):
    """The lines of the delimited P37 region (each define on ONE line), in a fixed order; [] when nothing is set (the region is then removed from the output and the render equals the pre-P37 render byte for byte).
    The Turnstile SECRET FILE constant is defined here only when the renderer verified the file (ctx["turnstile_secret"]); the file's content is never read into the output."""
    if env != "production":
        return []
    problems = p37_problems(facts, env, ctx)
    if problems:
        raise OwnerFactsError("P37 self-service region REFUSED (nothing is rendered): " + " | ".join(problems))
    out = []
    for k in P37_KEYS:
        if k not in facts:
            continue
        v = facts[k]
        if k in TRUE_ONLY:
            out.append("define( '%s', true );" % k)
        elif k in ("AICC_TRIAL_SELF_SERVICE_CAP", "AICC_MAIL_MAX_PER_HOUR", "AICC_MAIL_MAX_PER_DAY"):
            out.append("define( '%s', %d );" % (k, int(v)))   # an INTEGER literal: the Control Plane reads a string such as "25" as 0
        else:
            out.append("define( '%s', %s );" % (k, php_str(v)))
    if ctx is not None and ctx.get("turnstile_secret"):
        out.append("define( 'AICC_TURNSTILE_SECRET_FILE', %s );" % php_str(TURNSTILE_SECRET_FILE))
    return out


def render_p35(facts, env):
    """The text that replaces the P35 region of the template: for each block (B2, OFFER, SNAP, in the order the P35 script applied them) that has at least one fact, its comment line, its define() lines and ONE blank line; '' when no fact is set (the region
    disappears and the render is the golden file byte for byte). The files named are never read."""
    if env != "production":
        return ""
    out = []
    for _bid, keys, comment in P35_BLOCKS:
        have = [k for k in keys if k in facts]
        if not have:
            continue
        out.append(comment + "\n" + "".join("define( '%s', %s );\n" % (k, php_str(facts[k])) for k in have) + "\n")
    return "".join(out)


def render(facts, env):
    """facts: validated dict. Returns (region_lines, extra_hosts): the PHP define() lines (each on ONE line) and the validated extra host list."""
    require_render_ready(facts, env)
    out = []
    for k in ORDER:
        if k not in facts or k in ("AICC_EXTRA_ACCESSIBLE_HOSTS", "AICC_TURNSTILE_ENABLED") or k in P37_KEYS or k in P38_KEYS or k in P35_KEYS:
            continue
        v = facts[k]
        if k in TRUE_ONLY:
            out.append("define( '%s', true );" % k)
        elif k == "AICC_LM_PAID_GATEWAYS":
            ents = []
            prov = facts.get("AICC_LM_PAYMENT_EVIDENCE_PROVIDER")
            for gid, metas in parse_paid_gateways(k, v):
                inner = "'require_transaction_id' => true"
                if metas:
                    inner += ", 'proof_meta' => array( %s )" % ", ".join(php_str(m) for m in metas)
                if prov:
                    # every id (wallet ids included) requires provider-side evidence; the environment comes from the render target, never from a fact
                    inner += ", 'require_provider_evidence' => true, 'evidence_provider' => %s, 'evidence_environment' => %s" % (php_str(prov), php_str("live" if env == "production" else "sandbox"))
                ents.append("%s => array( %s )" % (php_str(gid), inner))
            out.append("define( '%s', array( %s ) );" % (k, ", ".join(ents)))
        elif k == "AICC_LAUNCH_REAL_GATEWAYS":
            out.append("define( '%s', array( %s ) );" % (k, ", ".join(php_str(g) for g in parse_gateway_list(k, v))))
        else:
            out.append("define( '%s', %s );" % (k, php_str(v)))
    hosts = parse_hosts("AICC_EXTRA_ACCESSIBLE_HOSTS", facts["AICC_EXTRA_ACCESSIBLE_HOSTS"], env) if "AICC_EXTRA_ACCESSIBLE_HOSTS" in facts else []
    if facts.get("AICC_TURNSTILE_ENABLED") == "true" and TURNSTILE_HOST not in hosts:
        hosts = hosts + [TURNSTILE_HOST]  # appended after the owner's own hosts, never counted against their limit
    return out, hosts


# ---- command line (owner-facts.sh) ------------------------------------------------------------------------------------------------------------------------
def main(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="owner_facts.py")
    ap.add_argument("cmd", choices=["list", "check", "set", "unset", "keys", "export", "import", "check-turnstile-secret", "check-brevo-key", "mail-mode", "set-stdin"])
    ap.add_argument("key", nargs="?")
    ap.add_argument("value", nargs="?")
    ap.add_argument("--file", required=True)
    ap.add_argument("--env", required=True, choices=["stage", "production"])
    ap.add_argument("--context", action="store_true", help="check only: also apply the rules that need the host state (given by --mail-ready and --turnstile-secret-file)")
    ap.add_argument("--mail-ready", action="store_true", help="a SAFE /etc/aicc-mail/smtp.env exists (the SMTP layer)")
    ap.add_argument("--brevo-key-ready", action="store_true", help="a VALID /etc/aicc-mail/brevo-api.key exists (the Brevo API layer)")
    ap.add_argument("--turnstile-secret-file")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "check-turnstile-secret":
            # --file is the SECRET FILE here. Prints only a verdict, never a character of the secret.
            check_turnstile_secret_file(a.file)
            print("ok: turnstile secret file readable as the Control Plane reads it (content not shown)")
            return 0
        if a.cmd == "check-brevo-key":
            # --file is the KEY FILE here. Prints only a verdict, never a character of the key.
            try:
                check_brevo_key_file(a.file)
            except OwnerFactsError:
                raise
            except Exception as e:  # never a traceback next to a secret file: only the class of the problem
                raise OwnerFactsError("%s could not be read (%s)" % (a.file, type(e).__name__))
            print("ok: brevo api key file readable as the Control Plane reads it (content not shown)")
            return 0
        if a.cmd == "keys":
            print("\n".join(KEYS_FOR[a.env]))
            return 0
        facts = parse_file(a.file, a.env)
        if a.cmd == "mail-mode":
            # stdout: none | smtp | brevo_api. Notes go to stderr (NOTE: ...). A contradiction (both secret files, no provider fact) is a refusal.
            mode, notes, probs = mail_mode(facts, {"mail": bool(a.mail_ready), "brevo_key": bool(a.brevo_key_ready)} if a.env == "production" else {})
            if probs:
                raise OwnerFactsError(" | ".join(probs))
            for n in notes:
                print("NOTE: %s" % n, file=sys.stderr)
            print(mode)
            return 0
        if a.cmd == "list":
            for k in ORDER:
                if k in facts:
                    # personal data is masked: the test recipients show only the first character of each local part and the domain (the file keeps the full value; `export` is the explicit full copy)
                    print("%s=%s" % (k, ",".join(mask_address(x) for x in facts[k].split(",")) if k == "AICC_MAIL_TEST_RECIPIENTS" else facts[k]))
            return 0
        if a.cmd == "check":
            ctx = None
            if a.context:
                ctx = {"mail": bool(a.mail_ready), "brevo_key": bool(a.brevo_key_ready), "turnstile_secret": False}
                if a.turnstile_secret_file:
                    sec = check_turnstile_secret_file(a.turnstile_secret_file)
                    if facts.get("AICC_TURNSTILE_SITE_KEY") == sec:
                        raise OwnerFactsError("AICC_TURNSTILE_SITE_KEY equals the Turnstile secret: the SECRET was entered as the site key. Nothing is rendered. Unset the fact, and rotate the secret in the Cloudflare dashboard (it has been written into the owner-facts file)")
                    ctx["turnstile_secret"] = True
            require_render_ready(facts, a.env, ctx)
            print("ok: %d value(s) valid for %s" % (len(facts), a.env))
            return 0
        if a.cmd == "export":
            # Disaster-recovery copy: the validated file text on stdout (non-secret). Keep it with the owner's records; `import` re-enters it on a rebuilt host.
            sys.stdout.write(file_text(facts))
            return 0
        if a.cmd == "import":
            if a.key is None or a.value is not None:
                raise OwnerFactsError("import needs exactly one argument: the path of an exported facts file")
            if not os.path.isabs(a.key):
                raise OwnerFactsError("import: the path must be absolute")
            new = parse_file(a.key, a.env)  # strict: regular file, size, UTF-8, every value validated FOR THIS ENVIRONMENT
            if not os.path.lexists(a.key):
                raise OwnerFactsError("import: %s does not exist" % a.key)
            if facts and facts != new:
                raise OwnerFactsError("import: %s already holds %d value(s) that differ from the import file: it never merges or overwrites (use `set` / `unset`, or move the current file away on purpose)" % (a.file, len(facts)))
            write_file(a.file, new, a.env)
            print("imported %d value(s) into %s (mode 0600). Now re-render: sudo aicc-render-wp-config --env %s%s" % (len(new), a.file, a.env, " --confirm-production" if a.env == "production" else ""))
            return 0
        if a.key is None:
            raise OwnerFactsError("%s needs a KEY" % a.cmd)
        if a.key not in ORDER:
            raise OwnerFactsError("unknown key '%s' (allowed: %s)" % (a.key, ", ".join(KEYS_FOR[a.env])))
        old_facts = dict(facts)
        if a.cmd == "set-stdin":
            if a.value is not None:
                raise OwnerFactsError("set-stdin needs KEY only: the value is read from stdin")
            line = sys.stdin.buffer.readline(4097)
            if len(line) > 4096:
                raise OwnerFactsError("set-stdin: the value is longer than 4096 bytes")
            try:
                facts[a.key] = line.decode("utf-8").rstrip("\n")
            except UnicodeDecodeError:
                raise OwnerFactsError("set-stdin: the value is not valid UTF-8")
        elif a.cmd == "set":
            if a.value is None:
                raise OwnerFactsError("set needs KEY and VALUE")
            facts[a.key] = a.value
        else:
            if a.key not in facts:
                print("%s was not set: nothing to do" % a.key)
                return 0
            del facts[a.key]
        facts = validate_all(facts, a.env)
        # P42 review: a change must not BREAK the signup-switch rules the renderer enforces (e.g. `unset AICC_LEGAL_REVIEW_APPROVED` while AICC_TRIAL_SELF_SERVICE_ENABLED is set, or setting the switch before its prerequisites: the next render would
        # refuse it). Only the rules decidable from the facts alone run here (the host state is the renderer's business), and only the SIGNUP-SWITCH family: the other render rules (e.g. the Brevo provider before its sender) keep the documented
        # "any order" editing. A problem that was ALREADY there is tolerated, so an inconsistent file can still be repaired; only a NEW problem refuses the change, and nothing is written.
        before = {k: v for k, v in old_facts.items()}
        try:
            old_set = set(render_problems(validate_all(before, a.env), a.env))
        except OwnerFactsError:
            old_set = set()
        new_probs = [p[5:] for p in render_problems(facts, a.env) if p not in old_set and p.startswith("P37: AICC_TRIAL_SELF_SERVICE_ENABLED needs")]
        if new_probs:
            raise OwnerFactsError("this change would break the render rules (nothing was written): " + " | ".join(new_probs) + ". Change the facts in the order the activation steps give (to back out: the signup switch first, then the cap, the legal approval and the site key)")
        write_file(a.file, facts, a.env)
        print("%s %s in %s (mode 0600). Now re-render: sudo aicc-render-wp-config --env %s%s" % (a.key, "set" if a.cmd in ("set", "set-stdin") else "unset", a.file, a.env, " --confirm-production" if a.env == "production" else ""))
        return 0
    except OwnerFactsError as e:
        print("REFUSED: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
