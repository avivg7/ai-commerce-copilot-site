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
    "AICC_LM_PLUGIN_SIGNING_PUBKEYS",
]
FREE_TEXT = {  # key -> maximum length in characters
    "AICC_LEGAL_ENTITY_NAME": 200, "AICC_LEGAL_ENTITY_ADDRESS": 300, "AICC_LEGAL_GOVERNING_LAW": 300, "AICC_LEGAL_JURISDICTION": 300,
    "AICC_LEGAL_PAYMENT_PROCESSOR": 80, "AICC_LEGAL_VAT_DETAILS": 300,
}
TRUE_ONLY = ("AICC_LEGAL_REVIEW_APPROVED", "AICC_STRUCTURED_DATA_OFFERS", "AICC_LM_PAYMENT_GATE_STRICT", "AICC_COMMERCE_OPEN")
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
    "stage": ["AICC_ACTIVATION_PROOF_KID", "AICC_LM_PAID_GATEWAYS", "AICC_LM_PAYMENT_EVIDENCE_PROVIDER", "AICC_LM_PAYMENT_GATE_STRICT", "AICC_EXTRA_ACCESSIBLE_HOSTS"],
}
BASE_HOST = {"production": "api.copilt.org", "stage": "stage.copilt.org"}
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


def parse_hosts(key, v, env):
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
        if h == "copilt.org" or h.endswith(".copilt.org"):
            raise OwnerFactsError("%s: '%s' is one of this project's own hosts: the API host is built in and nothing else of ours may be added" % (key, h))
        if h in out:
            raise OwnerFactsError("%s lists '%s' twice" % (key, h))
        out.append(h)
    if len(out) > MAX_EXTRA_HOSTS:
        raise OwnerFactsError("%s lists more than %d hosts" % (key, MAX_EXTRA_HOSTS))
    return out


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
    if key in FREE_TEXT:
        return _text(key, v)
    if key == "AICC_LEGAL_SUPPORT_EMAIL":
        return _email(key, v)
    if key == "AICC_ACTIVATION_PROOF_KID":
        return _kid(key, v)
    if key in TRUE_ONLY:
        return _true(key, v)
    if key == "AICC_LEGAL_SUBPROCESSORS_VERIFIED":
        return _date(key, v)
    if key == "AICC_LM_PAID_GATEWAYS":
        return ",".join(g + "".join(":" + m for m in metas) for g, metas in parse_paid_gateways(key, v))
    if key == "AICC_LM_PAYMENT_EVIDENCE_PROVIDER":
        return _provider(key, v)
    if key == "AICC_LAUNCH_REAL_GATEWAYS":
        return ",".join(parse_gateway_list(key, v))
    if key == "AICC_EXTRA_ACCESSIBLE_HOSTS":
        return ",".join(parse_hosts(key, v, env))
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


def render(facts, env):
    """facts: validated dict. Returns (region_lines, extra_hosts): the PHP define() lines (each on ONE line) and the validated extra host list."""
    out = []
    for k in ORDER:
        if k not in facts or k == "AICC_EXTRA_ACCESSIBLE_HOSTS":
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
    return out, hosts


# ---- command line (owner-facts.sh) ------------------------------------------------------------------------------------------------------------------------
def main(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="owner_facts.py")
    ap.add_argument("cmd", choices=["list", "check", "set", "unset", "keys", "export", "import"])
    ap.add_argument("key", nargs="?")
    ap.add_argument("value", nargs="?")
    ap.add_argument("--file", required=True)
    ap.add_argument("--env", required=True, choices=["stage", "production"])
    a = ap.parse_args(argv)
    try:
        if a.cmd == "keys":
            print("\n".join(KEYS_FOR[a.env]))
            return 0
        facts = parse_file(a.file, a.env)
        if a.cmd == "list":
            for k in ORDER:
                if k in facts:
                    print("%s=%s" % (k, facts[k]))
            return 0
        if a.cmd == "check":
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
        if a.cmd == "set":
            if a.value is None:
                raise OwnerFactsError("set needs KEY and VALUE")
            facts[a.key] = a.value
        else:
            if a.key not in facts:
                print("%s was not set: nothing to do" % a.key)
                return 0
            del facts[a.key]
        facts = validate_all(facts, a.env)
        write_file(a.file, facts, a.env)
        print("%s %s in %s (mode 0600). Now re-render: sudo aicc-render-wp-config --env %s%s" % (a.key, "set" if a.cmd == "set" else "unset", a.file, a.env, " --confirm-production" if a.env == "production" else ""))
        return 0
    except OwnerFactsError as e:
        print("REFUSED: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
