"""tools/secret_leak_audit.py: finds a planted token in files (also gzip and across chunk borders), never prints the value, reports a clean tree as clean, exits 2 without a secrets file."""
import gzip
import os
import subprocess
import sys
import tempfile
import unittest

TOOL = os.path.join(os.path.dirname(__file__), "..", "tools", "secret_leak_audit.py")
TOKEN = "123456789" + ":" + "AAFakeTokenForTestsOnly_0123456789abcdefghij"      # assembled at run time: the repo scan rejects token-shaped literals


def run(secrets, roots, extra=None):
    env = {"PATH": os.environ.get("PATH", ""), "AUDIT_TEST_HARNESS": "1", "AUDIT_SECRETS_FILE": secrets, "AUDIT_ROOTS": ":".join(roots), "AUDIT_NO_JOURNAL": "1", "AUDIT_NO_PROC": "1"}
    env.update(extra or {})
    return subprocess.run([sys.executable, "-I", TOOL], capture_output=True, text=True, env=env)


class SecretAudit(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.sec = os.path.join(self.d, "secrets.env")
        with open(self.sec, "w") as fh:
            fh.write("TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=-1001234567890\n" % TOKEN)
        os.chmod(self.sec, 0o640)
        self.tree = os.path.join(self.d, "tree")
        os.makedirs(self.tree)

    def test_clean_tree(self):
        open(os.path.join(self.tree, "a.log"), "w").write("nothing to see\n")
        r = run(self.sec, [self.tree, self.d])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("RESULT: CLEAN", r.stdout)
        self.assertNotIn(TOKEN, r.stdout + r.stderr)
        self.assertNotIn("AAFakeToken", r.stdout + r.stderr)

    def test_plain_gzip_and_chunk_border(self):
        open(os.path.join(self.tree, "plain.log"), "w").write("x " + TOKEN + " y\n")
        with gzip.open(os.path.join(self.tree, "old.log.1.gz"), "wt") as fh:
            fh.write("a\n" + TOKEN + "\n")
        big = os.path.join(self.tree, "border.bin")
        with open(big, "wb") as fh:
            fh.write(b"A" * ((1 << 20) - 10) + TOKEN.encode() + b"B" * 100)      # the match straddles the 1 MiB chunk border
        r = run(self.sec, [self.tree])
        self.assertEqual(r.returncode, 1, r.stdout)
        for name in ("plain.log", "old.log.1.gz", "border.bin"):
            self.assertIn(name, r.stdout)
        self.assertNotIn(TOKEN, r.stdout + r.stderr)
        self.assertIn("burned", r.stdout)

    def test_the_secrets_file_itself_is_not_a_finding_and_its_content_is_not_printed(self):
        r = run(self.sec, [self.d])
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("mode 640", r.stdout)
        self.assertNotIn("1234567890", r.stdout)

    def test_no_secrets_file(self):
        r = run(os.path.join(self.d, "absent.env"), [self.tree])
        self.assertEqual(r.returncode, 2)
        self.assertIn("nothing to audit", r.stdout)

    def test_unusable_token(self):
        open(self.sec, "w").write("TELEGRAM_BOT_TOKEN=short\n")
        self.assertEqual(run(self.sec, [self.tree]).returncode, 2)

    def test_test_seams_are_ignored_without_the_harness_flag(self):
        env = {"PATH": os.environ.get("PATH", ""), "AUDIT_SECRETS_FILE": self.sec, "AUDIT_ROOTS": self.tree}
        r = subprocess.run([sys.executable, "-I", TOOL], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 2)         # the real /etc/aicc-ops/secrets.env does not exist here: the seams were not honoured


if __name__ == "__main__":
    unittest.main()
