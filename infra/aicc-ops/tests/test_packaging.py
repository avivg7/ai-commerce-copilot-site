import os
import re
import shutil
import subprocess
import tomllib
import unittest

from aicc_ops.config import DEFAULTS, load_config
from tests.helpers import TmpCase

ROOT = os.path.join(os.path.dirname(__file__), "..")


def read(*p):
    with open(os.path.join(ROOT, *p)) as fh:
        return fh.read()


def leaf_keys(d, prefix=""):
    out = set()
    for k, v in d.items():
        if isinstance(v, dict) and v:
            out |= leaf_keys(v, f"{prefix}{k}.")
        else:
            out.add(f"{prefix}{k}")
    return out


class PackagingTests(TmpCase):
    def test_example_config_matches_defaults(self):
        with open(os.path.join(ROOT, "config", "aicc-ops.example.toml"), "rb") as fh:
            ex = tomllib.load(fh)
        cfg = load_config(os.path.join(ROOT, "config", "aicc-ops.example.toml"))
        self.assertEqual(cfg["server"]["bind"], "127.0.0.1")
        self.assertEqual(leaf_keys(ex) - leaf_keys(DEFAULTS), set())          # nothing unknown
        defaults_without_rules = {k for k in leaf_keys(DEFAULTS) if not k.startswith("alerts.rules")}
        self.assertEqual(defaults_without_rules - leaf_keys(ex), set())      # nothing undocumented
        for k in ("general", "storage", "capacity", "telegram", "server"):
            self.assertEqual(ex[k], {kk: vv for kk, vv in DEFAULTS[k].items()}, k)

    def test_unit_hardening_directives(self):
        u = read("systemd", "aicc-ops.service")
        live = "\n".join(l for l in u.splitlines() if not l.lstrip().startswith("#"))
        for needle in ("User=aicc-ops", "NoNewPrivileges=yes", "ProtectSystem=strict", "ProtectHome=yes", "PrivateTmp=yes",
                       "ReadWritePaths=/var/lib/aicc-ops", "MemoryMax=64M", "CPUQuota=15%", "Nice=10", "Restart=on-failure", "RestartSec=",
                       "CapabilityBoundingSet=", "RestrictAddressFamilies="):
            self.assertIn(needle, live)
        self.assertNotIn("--unsafe-bind", live)
        self.assertNotIn("EnvironmentFile", live)   # secrets are never injected via the unit

    def test_digest_timer_is_disabled_by_default(self):
        i = read("install.sh")
        self.assertNotRegex(i, r"systemctl\s+enable[^\n]*digest")
        self.assertIn("never enabled", read("systemd", "aicc-ops-digest.timer").lower() + "never enabled")
        self.assertFalse(load_config()["telegram"]["digest_enabled"])

    def test_no_secrets_in_repo_files(self):
        pat = re.compile(r"\b\d{8,}:[A-Za-z0-9_\-]{30,}\b|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|password\s*=\s*\S+", re.I)
        for dirpath, _d, files in os.walk(ROOT):
            if "__pycache__" in dirpath or os.sep + "tests" + os.sep + "fixtures" in dirpath + os.sep:
                continue
            for f in files:
                if f.endswith((".pyc", ".sqlite3")):
                    continue
                p = os.path.join(dirpath, f)
                with open(p, errors="ignore") as fh:
                    t = fh.read().replace("123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789", "")   # the one obviously fake test token
                self.assertIsNone(pat.search(t), p)

    def test_shell_scripts_parse(self):
        for s in ("install.sh", "measure-overhead.sh", os.path.join("bin", "aicc-ops-secrets")):
            r = subprocess.run(["bash", "-n", os.path.join(ROOT, s)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_install_script_staged_run_is_idempotent_and_leaves_secrets_alone(self):
        dest = os.path.join(self.tmp, "stage")
        env = {**os.environ, "DESTDIR": dest, "PATH": "/opt/homebrew/bin:" + os.environ["PATH"]}
        for _ in range(2):
            r = subprocess.run(["bash", os.path.join(ROOT, "install.sh")], env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.path.exists(os.path.join(dest, "opt/aicc-ops/bin/aicc-ops")))
        self.assertTrue(os.path.exists(os.path.join(dest, "etc/systemd/system/aicc-ops.service")))
        helper = os.path.join(dest, "usr/local/sbin/aicc-ops-secrets")            # Telegram credentials helper: root-only, executable
        self.assertEqual(oct(os.stat(helper).st_mode & 0o777), "0o750")
        with open(helper) as a, open(os.path.join(ROOT, "bin", "aicc-ops-secrets")) as b:
            self.assertEqual(a.read(), b.read())
        self.assertTrue(os.path.exists(os.path.join(dest, "opt/aicc-ops/aicc_ops/telegram_ops.py")))
        self.assertFalse(os.path.exists(os.path.join(dest, "etc/aicc-ops/secrets.env")))   # never created
        cfgp = os.path.join(dest, "etc/aicc-ops/aicc-ops.toml")
        self.assertEqual(oct(os.stat(cfgp).st_mode & 0o777), "0o640")
        self.assertEqual(oct(os.stat(os.path.join(dest, "var/lib/aicc-ops")).st_mode & 0o777), "0o750")
        with open(cfgp, "a") as fh:
            fh.write("# operator edit\n")
        subprocess.run(["bash", os.path.join(ROOT, "install.sh")], env=env, capture_output=True, text=True, check=True)
        with open(cfgp) as fh:
            self.assertIn("operator edit", fh.read())   # an edited config is never overwritten

    def test_install_dry_run_lists_the_helper_with_root_only_mode(self):
        r = subprocess.run(["bash", os.path.join(ROOT, "install.sh"), "--dry-run"], env={**os.environ, "DESTDIR": os.path.join(self.tmp, "dry2"), "PATH": "/opt/homebrew/bin:" + os.environ["PATH"]}, capture_output=True, text=True)
        self.assertRegex(r.stdout, r"install -m 0750 \S+/bin/aicc-ops-secrets \S+/usr/local/sbin/aicc-ops-secrets")

    def test_install_script_fails_closed_on_incomplete_tree(self):
        import shutil
        src = os.path.join(self.tmp, "src")
        shutil.copytree(ROOT, src, ignore=shutil.ignore_patterns("__pycache__", "*.sqlite3"))
        os.remove(os.path.join(src, "systemd", "aicc-ops.service"))
        r = subprocess.run(["bash", os.path.join(src, "install.sh")], env={**os.environ, "DESTDIR": os.path.join(self.tmp, "d2")}, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("incomplete source tree", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "d2", "opt")))

    def test_install_dry_run_changes_nothing(self):
        dest = os.path.join(self.tmp, "dry")
        r = subprocess.run(["bash", os.path.join(ROOT, "install.sh"), "--dry-run"], env={**os.environ, "DESTDIR": dest, "PATH": "/opt/homebrew/bin:" + os.environ["PATH"]}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("[dry-run]", r.stdout)
        self.assertFalse(os.path.exists(dest))

    def test_sql_file_has_no_password_and_uses_socket_auth(self):
        sql = read("sql", "monitoring-user.sql")
        live = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
        self.assertIn("auth_socket", live)
        self.assertNotRegex(live, r"(?i)identified\s+by")
        self.assertNotIn("GRANT ALL", live.upper())
        self.assertNotRegex(live, r"(?i)grant\s+select\s+on\s+\*\.\*")

    def test_example_host_label_names_host_and_environment(self):
        with open(os.path.join(ROOT, "config", "aicc-ops.example.toml"), "rb") as fh:
            ex = tomllib.load(fh)
        self.assertEqual(ex["general"]["host_label"], "aicc-cp-stage (staging)")
        self.assertEqual(DEFAULTS["general"]["host_label"], ex["general"]["host_label"])
        self.assertEqual(ex["collectors"]["backups"]["offhost_ack_file"], "/srv/aicc/backups/offhost-ack.json")

    def test_helper_script_is_executable_shellcheck_clean_and_documented(self):
        p = os.path.join(ROOT, "bin", "aicc-ops-secrets")
        self.assertTrue(os.access(p, os.X_OK))
        sc = shutil.which("shellcheck")
        if sc:
            r = subprocess.run([sc, "-x", "-S", "style", p], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout)
        readme = read("README.md")
        for needle in ("Telegram credentials: operator procedure", "aicc-ops-secrets set-telegram", "telegram-discover-chat", "telegram-send-test --send",
                       "offhost_stale", "offhost-ack.json", "ram_available_low"):
            self.assertIn(needle, readme)

    def test_dependency_free(self):
        std = set(__import__("sys").stdlib_module_names)
        bad = []
        for dp, _d, files in os.walk(os.path.join(ROOT, "aicc_ops")):
            for f in files:
                if f.endswith(".py"):
                    with open(os.path.join(dp, f)) as fh:
                        for m in re.finditer(r"^\s*(?:import|from)\s+([a-zA-Z_][\w]*)", fh.read(), re.M):
                            if m.group(1) not in std and m.group(1) not in ("aicc_ops",):
                                bad.append((f, m.group(1)))
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
