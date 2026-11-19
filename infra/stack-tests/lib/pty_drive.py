#!/usr/bin/env python3
"""Test driver for the owner-run scripts that read from /dev/tty (infra/stack-tests only; standard library).

    python3 -I pty_drive.py CONFIG.json

CONFIG.json: {"argv": [...], "env": {...}, "cwd": "...", "steps": [{"expect": "<text the terminal shows>", "send": "<keystrokes>", "hidden": true|false}], "secrets": ["..."], "timeout": 60, "out": "RESULT.json"}

A step with "hidden": true waits until the terminal's ECHO flag is OFF (the child has started `read -s`) before it types, exactly as a human would not type before the prompt: typing earlier would be echoed by the line discipline.
The child runs on a real pseudo terminal (so /dev/tty exists, `[ -t 0 ]` is true and `read -s` switches the echo off). Each step waits for its `expect` text in the terminal output and then types `send`.
A poller samples the process list (`ps -axwwE`: arguments AND environment of the user's processes) every few milliseconds while the child runs and records every sample that contains one of the
`secrets` (the sample is stored with the secret replaced, never in clear). The result file holds the exit code, the terminal output as the user saw it, and the leak list. The secrets never leave this process.
"""
import json
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import threading
import time


def main():
    cfg = json.load(open(sys.argv[1]))
    secrets = [s for s in cfg.get("secrets", []) if s]
    leaks, done = [], threading.Event()

    def poll():
        while not done.is_set():
            try:
                out = subprocess.run(["ps", "-axwwE", "-o", "pid=,command="], capture_output=True, timeout=5).stdout.decode("utf-8", "replace")
            except Exception:
                out = ""
            for line in out.splitlines():
                for s in secrets:
                    if s in line and "pty_drive" not in line:
                        leaks.append(line.replace(s, "<SECRET>")[:300])
            time.sleep(0.003)

    pid, master = pty.fork()
    if pid == 0:
        os.chdir(cfg.get("cwd") or ".")
        os.execvpe(cfg["argv"][0], cfg["argv"], cfg["env"])
    th = threading.Thread(target=poll, daemon=True)
    th.start()
    buf, pos, steps, i = b"", 0, cfg.get("steps", []), 0
    deadline = time.time() + cfg.get("timeout", 60)
    status = None
    while True:
        if time.time() > deadline:
            os.kill(pid, signal.SIGKILL)
            status = "timeout"
        r, _, _ = select.select([master], [], [], 0.05)
        if r:
            try:
                data = os.read(master, 4096)
            except OSError:
                data = b""
            if data:
                buf += data
            else:
                break
        if i < len(steps) and steps[i]["expect"].encode() in buf[pos:]:
            pos = buf.index(steps[i]["expect"].encode(), pos) + len(steps[i]["expect"])
            if steps[i].get("hidden"):
                t0 = time.time()
                while time.time() - t0 < 10:
                    try:
                        if not (termios.tcgetattr(master)[3] & termios.ECHO):
                            break
                    except termios.error:
                        break
                    time.sleep(0.005)
            os.write(master, steps[i]["send"].encode())
            i += 1
        if status == "timeout":
            break
    try:
        _, st = os.waitpid(pid, 0)
        code = os.waitstatus_to_exitcode(st) if hasattr(os, "waitstatus_to_exitcode") else (st >> 8)
    except ChildProcessError:
        code = -1
    done.set()
    th.join(timeout=2)
    text = buf.decode("utf-8", "replace")
    for s in secrets:
        text_leaked = s in text
        if text_leaked:
            leaks.append("TERMINAL OUTPUT contained the secret")
            text = text.replace(s, "<SECRET>")
    json.dump({"exit": code, "status": status, "steps_done": i, "output": text, "leaks": leaks}, open(cfg["out"], "w"))


main()
