"""bin/aicc-ops-secrets (the host-side helper that stores the Telegram credentials).

What these tests DO prove: against a temp dir (AICC_OPS_TEST_HARNESS=1 seams: AICC_OPS_ETC / AICC_OPS_CLI) the script validates input, writes the file
atomically with mode 0640, preserves other keys, never writes on invalid input, reads the token from a pty (no echo) or from stdin, and that neither
the external commands it spawns (PATH shims log every argv), nor the CLI it calls (argv, environment and a `ps` snapshot taken while it runs), nor its own
output ever contain the token.
What they do NOT prove: the real root/chown/runuser path on the host (needs root; the chown, the aicc-ops group and runuser are skipped under the harness),
or that bash on the host behaves exactly like the bash that ran the test."""
import os
import pty
import select
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

from tests.helpers import TmpCase, BodyServer, put, read_text, write_exe
from tests.test_telegram import TOKEN, CHAT

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT = os.path.join(ROOT, "bin", "aicc-ops-secrets")
TOKEN2 = "987654321" + ":" + "Z" * 8 + "y" * 27          # built from pieces so the repo-wide token-shaped-string scan stays meaningful
SHIMMED = ("mktemp", "chmod", "chown", "mv", "rm", "id", "stat", "getent", "env", "runuser", "sed", "cat", "ps")


def mode(path):
    return oct(os.stat(path).st_mode & 0o777)


_SHARED = {}


def setUpModule():
    """Shims and the stub CLI are created once: macOS scans every freshly written executable on its first exec (~0.3 s each)."""
    d = tempfile.mkdtemp(prefix="aicc-ops-shims-")
    _SHARED["dir"] = d
    shims = os.path.join(d, "shims"); os.mkdir(shims)
    for name in SHIMMED:
        real = shutil.which(name)
        if real:
            write_exe(os.path.join(shims, name), f'printf "%s " "{name}" "$@" >> "$AICC_TEST_ARGV_LOG"; printf "\\n" >> "$AICC_TEST_ARGV_LOG"\nexec {real} "$@"\n')
    _SHARED["shims"] = shims
    _SHARED["stub"] = write_exe(os.path.join(d, "stub-cli"),
                                '{ echo "ARGV:$*"; env | sort; ps -ax -o command= 2>/dev/null; } > "$STUB_DUMP"\n'
                                'echo "getMe: ok  bot @stub_bot"\nexit "${STUB_RC:-0}"\n')
    _SHARED["real_cli"] = write_exe(os.path.join(d, "real-cli"), f'exec "{sys.executable}" -B "{ROOT}/bin/aicc-ops" "$@"\n')


def tearDownModule():
    shutil.rmtree(_SHARED.get("dir", ""), ignore_errors=True)


class ScriptBase(TmpCase):
    def setUp(self):
        super().setUp()
        self.etc = os.path.join(self.tmp, "etc"); os.mkdir(self.etc)
        self.secrets = os.path.join(self.etc, "secrets.env")
        self.dump = os.path.join(self.tmp, "stub-dump.txt")
        self.argv_log = os.path.join(self.tmp, "argv.log")
        self.shims, self.stub = _SHARED["shims"], _SHARED["stub"]
        self.rc_for_check = 0

    def env(self, **extra):
        e = {"PATH": self.shims + os.pathsep + os.environ["PATH"], "HOME": self.tmp, "TMPDIR": self.tmp,
             "AICC_OPS_TEST_HARNESS": "1", "AICC_OPS_ETC": self.etc, "AICC_OPS_CLI": self.stub,
             "STUB_DUMP": self.dump, "STUB_RC": str(self.rc_for_check), "AICC_TEST_ARGV_LOG": self.argv_log}
        e.update(extra)
        return e

    def run_script(self, *args, stdin=None, env=None):
        return subprocess.run(["bash", SCRIPT, *args], input=stdin if stdin is not None else "", capture_output=True, text=True,
                              env=env or self.env(), timeout=60)

    def seed(self, body, m=0o640):
        put(self.secrets, body)
        os.chmod(self.secrets, m)

    def parsed(self):
        out = {}
        for l in read_text(self.secrets).splitlines():
            if "=" in l and not l.startswith("#"):
                k, _, v = l.partition("=")
                out.setdefault(k, []).append(v)
        return out

    def assert_token_nowhere(self, p, token=TOKEN):
        frag = token.split(":")[1][:12]
        for label, text in (("stdout", p.stdout), ("stderr", p.stderr),
                            ("argv.log", read_text(self.argv_log) if os.path.exists(self.argv_log) else ""),
                            ("stub dump (cli argv + env + ps)", read_text(self.dump) if os.path.exists(self.dump) else "")):
            self.assertNotIn(token, text, label)
            self.assertNotIn(frag, text, label)


class SetTelegramStdin(ScriptBase):
    def test_writes_0640_file_with_both_keys(self):
        p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN + "\n")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(mode(self.secrets), "0o640")
        self.assertEqual(self.parsed(), {"TELEGRAM_BOT_TOKEN": [TOKEN], "TELEGRAM_CHAT_ID": [CHAT]})
        self.assertEqual(sorted(os.listdir(self.etc)), ["secrets.env"])          # temp file gone
        self.assertIn("telegram-check: ok", p.stdout)
        self.assertIn("systemctl restart aicc-ops", p.stdout)
        self.assertIn("Nothing was restarted", p.stdout)
        self.assert_token_nowhere(p)

    def test_chat_id_can_be_the_second_stdin_line_and_crlf_or_spaces_are_trimmed(self):
        p = self.run_script("set-telegram", "--stdin", stdin=f"  {TOKEN}\r\n{CHAT}\n")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.parsed(), {"TELEGRAM_BOT_TOKEN": [TOKEN], "TELEGRAM_CHAT_ID": [CHAT]})

    def test_token_without_trailing_newline(self):
        p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_other_keys_and_comments_preserved_and_old_values_replaced(self):
        self.seed(f"# managed by hand\nOTHER_KEY=keep me\nexport TELEGRAM_BOT_TOKEN=old\nTELEGRAM_CHAT_ID=11111\nMETRICS_TOKEN=abc\n", 0o600)
        p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN2 + "\n")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        text = read_text(self.secrets)
        self.assertIn("# managed by hand\n", text)
        self.assertEqual(self.parsed(), {"OTHER_KEY": ["keep me"], "METRICS_TOKEN": ["abc"], "TELEGRAM_BOT_TOKEN": [TOKEN2], "TELEGRAM_CHAT_ID": [CHAT]})
        self.assertNotIn("old", text)
        self.assertEqual(mode(self.secrets), "0o640")                              # 0600 -> 0640
        self.assert_token_nowhere(p, TOKEN2)

    def test_world_writable_previous_file_ends_up_0640(self):
        self.seed("OTHER=1\n", 0o666)
        self.assertEqual(self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN + "\n").returncode, 0)
        self.assertEqual(mode(self.secrets), "0o640")

    def test_invalid_tokens_are_rejected_without_writing(self):
        bad = ["", "abc", "123456789", "123456789:short", "notdigits:" + "A" * 35, "12345:" + "A" * 35, "1234567890123:" + "A" * 35,
               "123456789:" + "A" * 20 + " " + "B" * 20, "123456789:" + "A" * 35 + ":extra", "123456789:" + "A" * 34 + "!"]
        for t in bad:
            self.seed("OTHER=1\n")
            before = read_text(self.secrets)
            p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=t + "\n")
            self.assertEqual(p.returncode, 2, (t, p.stdout, p.stderr))
            self.assertEqual(read_text(self.secrets), before, t)
            self.assertEqual(sorted(os.listdir(self.etc)), ["secrets.env"], t)
            if len(t) > 12:
                self.assertNotIn(t, p.stdout + p.stderr)                          # the rejected text is not echoed back
            self.assertFalse(os.path.exists(self.dump))                            # telegram-check was never run
            os.unlink(self.secrets)

    def test_invalid_chat_ids_rejected_without_writing(self):
        for c in ("1234", "abc12345", "--1234567", "12345678901234x", "+1234567"):
            p = self.run_script("set-telegram", "--stdin", "--chat-id", c, stdin=TOKEN + "\n")
            self.assertEqual(p.returncode, 2, (c, p.stderr))
            self.assertFalse(os.path.exists(self.secrets))
        for c in ("12345", "-1001234567890"):
            self.assertEqual(self.run_script("set-telegram", "--stdin", "--chat-id", c, stdin=TOKEN + "\n").returncode, 0, c)

    def test_token_is_never_accepted_as_an_argument(self):
        p = self.run_script("set-telegram", TOKEN, stdin="")
        self.assertEqual(p.returncode, 2)
        self.assertFalse(os.path.exists(self.secrets))
        p = self.run_script("set-telegram", "--token", TOKEN)
        self.assertEqual(p.returncode, 2)

    def test_failed_check_reports_failure_and_exit_1(self):
        self.rc_for_check = 1
        p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN + "\n")
        self.assertEqual(p.returncode, 1)
        self.assertIn("telegram-check FAILED", p.stderr)
        self.assertNotIn("telegram-check: ok", p.stdout)
        self.assertTrue(os.path.exists(self.secrets))
        self.assert_token_nowhere(p)

    def test_missing_etc_dir_fails_cleanly(self):
        p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN + "\n", env=self.env(AICC_OPS_ETC=os.path.join(self.tmp, "nope")))
        self.assertEqual(p.returncode, 1)
        self.assertIn("does not exist", p.stderr)


class NoSecretLeak(ScriptBase):
    def test_token_never_in_any_spawned_argv_env_or_ps_snapshot(self):
        put(os.path.join(self.etc, "aicc-ops.toml"), "")
        p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN + "\n")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assert_token_nowhere(p)
        argv_log = read_text(self.argv_log)
        self.assertIn("mktemp", argv_log); self.assertIn("chmod 0640", argv_log); self.assertIn("mv -f", argv_log)   # the shims really saw the commands
        dump = read_text(self.dump)
        self.assertIn(f"ARGV:--config {self.etc}/aicc-ops.toml telegram-check", dump)           # the CLI got a config path and a subcommand, nothing else
        self.assertGreater(len(dump.splitlines()), 5)
        self.assertNotIn("TELEGRAM", dump.split("ARGV:")[1].splitlines()[0])
        self.assertNotRegex(dump, r"(?m)^(TELEGRAM_\w+|\w*TOKEN\w*)=")                           # not in the CLI's environment either
        self.assertNotIn(CHAT, dump.split("ARGV:")[1].splitlines()[0])

    def test_script_has_no_xtrace_and_disables_history(self):
        src = read_text(SCRIPT)
        live = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
        self.assertIn("unset HISTFILE", live)
        self.assertIn("set +o history", live)
        self.assertIn("umask 077", live)
        self.assertRegex(live, r"(?m)^set \+x$")
        for bad in ("set -x", "set -o xtrace", "set -euxo", "bash -x"):
            self.assertNotIn(bad, live)

    def test_token_variable_is_only_used_by_builtins(self):
        """Static guard (not a proof): no line hands $token to an external command; the runtime proof is the argv log above."""
        for n, l in enumerate(read_text(SCRIPT).splitlines(), 1):
            if l.lstrip().startswith("#") or not ("$token" in l or "${token" in l):
                continue
            self.assertNotRegex(l, r"\b(echo|curl|python3?|env|sh|bash|runuser|ps|cat)\b[^#]*\$\{?token", f"line {n}: {l}")

    def test_shellcheck_clean(self):
        sc = shutil.which("shellcheck")
        if not sc:
            self.skipTest("shellcheck not installed")
        r = subprocess.run([sc, "-x", "-S", "style", SCRIPT], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)


class StdinAndTty(ScriptBase):
    def test_refuses_non_tty_stdin_without_stdin_flag(self):
        for stdin in ("", TOKEN + "\n"):
            p = self.run_script("set-telegram", stdin=stdin)
            self.assertEqual(p.returncode, 3, p.stderr)
            self.assertIn("not a terminal", p.stderr)
            self.assertFalse(os.path.exists(self.secrets))
        self.assertNotIn(TOKEN, p.stdout + p.stderr)

    def _drive_pty(self, script_args, steps, env):
        master, slave = pty.openpty()
        p = subprocess.Popen(["bash", SCRIPT, *script_args], stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True)
        os.close(slave)
        screen = ""
        deadline = time.time() + 30
        pending = list(steps)
        while time.time() < deadline:
            r, _, _ = select.select([master], [], [], 0.2)
            if r:
                try:
                    chunk = os.read(master, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                screen += chunk.decode(errors="replace")
            if pending and pending[0][0] in screen:
                os.write(master, pending.pop(0)[1].encode())
            if p.poll() is not None and not r:
                break
        p.wait(timeout=10)
        os.close(master)
        return p.returncode, screen, pending

    def test_tty_prompt_does_not_echo_the_token(self):
        rc, screen, pending = self._drive_pty(["set-telegram"], [("input hidden): ", TOKEN + "\n"), ("Enter = keep", CHAT + "\n")], self.env())
        self.assertEqual(pending, [], screen)
        self.assertEqual(rc, 0, screen)
        self.assertNotIn(TOKEN, screen)                       # the terminal never showed the token
        self.assertNotIn(TOKEN.split(":")[1][:12], screen)
        self.assertIn(CHAT, screen)                           # the chat id is echoed (allowed)
        self.assertEqual(self.parsed(), {"TELEGRAM_BOT_TOKEN": [TOKEN], "TELEGRAM_CHAT_ID": [CHAT]})
        self.assertEqual(mode(self.secrets), "0o640")
        self.assert_token_nowhere(subprocess.CompletedProcess([], 0, "", ""))

    def test_tty_blank_chat_id_keeps_the_existing_one(self):
        self.seed(f"TELEGRAM_CHAT_ID={CHAT}\nOTHER=1\n")
        rc, screen, pending = self._drive_pty(["set-telegram"], [("input hidden): ", TOKEN + "\n"), ("Enter = keep", "\n")], self.env())
        self.assertEqual((rc, pending), (0, []), screen)
        self.assertEqual(self.parsed(), {"OTHER": ["1"], "TELEGRAM_BOT_TOKEN": [TOKEN], "TELEGRAM_CHAT_ID": [CHAT]})


class KeepToken(ScriptBase):
    def test_keep_token_updates_only_the_chat_id(self):
        self.seed(f"A=1\nTELEGRAM_BOT_TOKEN={TOKEN}\n")
        p = self.run_script("set-telegram", "--keep-token", "--chat-id", CHAT)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.parsed(), {"A": ["1"], "TELEGRAM_BOT_TOKEN": [TOKEN], "TELEGRAM_CHAT_ID": [CHAT]})
        self.assert_token_nowhere(p)

    def test_keep_token_without_a_stored_token_fails(self):
        p = self.run_script("set-telegram", "--keep-token", "--chat-id", CHAT)
        self.assertEqual(p.returncode, 2)
        self.assertFalse(os.path.exists(self.secrets))

    def test_token_only_without_chat_id_is_allowed_and_explained(self):
        p = self.run_script("set-telegram", "--stdin", stdin=TOKEN + "\n")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.parsed(), {"TELEGRAM_BOT_TOKEN": [TOKEN]})
        self.assertIn("telegram-discover-chat", p.stdout)


class RootRequirement(ScriptBase):
    @unittest.skipIf(os.geteuid() == 0, "running as root")
    def test_refuses_without_root_and_ignores_test_seams_without_the_harness_flag(self):
        env = self.env(); env.pop("AICC_OPS_TEST_HARNESS")
        for args in (("set-telegram", "--stdin", "--chat-id", CHAT), ("remove-telegram", "--yes")):
            p = self.run_script(*args, stdin=TOKEN + "\n", env=env)
            self.assertEqual(p.returncode, 3, p.stderr)
            self.assertIn("must run as root", p.stderr)
        self.assertEqual(os.listdir(self.etc), [])
        self.assertFalse(os.path.exists(self.argv_log))       # nothing was even spawned before the refusal that touches the token


class Status(ScriptBase):
    def test_absent(self):
        p = self.run_script("status")
        self.assertEqual(p.returncode, 0)
        self.assertIn("absent", p.stdout)

    def test_prints_presence_owner_mode_and_key_names_only(self):
        self.seed(f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        p = self.run_script("status")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("secrets file: present", p.stdout)
        self.assertIn("mode:  640", p.stdout)
        self.assertIn("mode acceptable: yes", p.stdout)
        self.assertRegex(p.stdout, r"owner: \S+:\S+")
        self.assertIn("telegram keys: TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID", p.stdout)
        self.assertNotIn(TOKEN, p.stdout); self.assertNotIn(CHAT, p.stdout); self.assertNotIn(TOKEN.split(":")[1][:12], p.stdout)

    def test_flags_a_bad_mode_and_missing_keys(self):
        self.seed("OTHER=1\n", 0o644)
        p = self.run_script("status")
        self.assertIn("mode acceptable: NO", p.stdout)
        self.assertIn("telegram keys: none", p.stdout)

    def test_status_does_not_need_root(self):
        env = self.env(); env.pop("AICC_OPS_TEST_HARNESS"); env["AICC_OPS_ETC"] = "/definitely/not/used"
        p = self.run_script("status", env=env)
        self.assertEqual(p.returncode, 0)
        self.assertIn("/etc/aicc-ops/secrets.env", p.stdout)    # seams ignored without the flag: it looks at the real default path


class Remove(ScriptBase):
    def test_removes_only_telegram_keys(self):
        self.seed(f"# c\nA=1\nTELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        p = self.run_script("remove-telegram", "--yes")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(read_text(self.secrets), "# c\nA=1\n")
        self.assertEqual(mode(self.secrets), "0o640")
        self.assertIn("BotFather", p.stdout)
        self.assertIn("systemctl restart aicc-ops", p.stdout)

    def test_deletes_a_file_that_held_nothing_else(self):
        self.seed(f"# only telegram\nTELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        self.assertEqual(self.run_script("remove-telegram", "--yes").returncode, 0)
        self.assertFalse(os.path.exists(self.secrets))

    def test_needs_confirmation_when_not_a_tty(self):
        self.seed(f"TELEGRAM_BOT_TOKEN={TOKEN}\n")
        p = self.run_script("remove-telegram")
        self.assertEqual(p.returncode, 3)
        self.assertIn(TOKEN, read_text(self.secrets))

    def test_nothing_to_remove(self):
        self.assertEqual(self.run_script("remove-telegram", "--yes").returncode, 0)


class EndToEndWithRealCli(ScriptBase):
    def test_set_telegram_then_real_cli_check_against_loopback_fake(self):
        from tests.test_telegram_ops import reply
        put(os.path.join(self.etc, "aicc-ops.toml"), f'[telegram]\nsecrets_file = "{self.secrets}"\n')
        real = _SHARED["real_cli"]
        srv = BodyServer(handler_fn=reply({"/getMe": (200, {"ok": True, "result": {"username": "e2e_bot"}})}))
        try:
            p = self.run_script("set-telegram", "--stdin", "--chat-id", CHAT, stdin=TOKEN + "\n",
                                env=self.env(AICC_OPS_CLI=real, AICC_OPS_TEST_BASE_URL=srv.url))
        finally:
            srv.close()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("@e2e_bot", p.stdout)
        self.assertIn("telegram-check: ok", p.stdout)
        self.assertEqual([r["path"] for r in srv.requests], [f"/bot{TOKEN}/getMe"])
        self.assertNotIn(TOKEN, p.stdout + p.stderr)


if __name__ == "__main__":
    unittest.main()
