#!/usr/bin/env python3
"""Cargo runner for macOS dev builds (`npm run dev` -> `cargo run`).

Accessibility (and Microphone) grants are keyed on the binary's code signature and
attributed to the *responsible* process. A raw `cargo build` binary is linker-signed
adhoc, so every rebuild gets a new identity and the grant silently goes stale, and when
launched from a terminal macOS attributes the request to the terminal app instead.

This runner fixes both for the app binary only:
  1. re-signs it with a real local identity and the stable id `com.harness.app.dev`,
     so one "Harness Dev" grant survives rebuilds;
  2. spawns it with responsibility disclaimed, so TCC checks Harness Dev itself.

Anything else cargo runs (test binaries, other targets) is exec'd untouched.
Opt out with HARNESS_DEV_SIGN=0; pick an identity with HARNESS_DEV_SIGNING_IDENTITY.
"""

import ctypes
import os
import re
import signal
import subprocess
import sys

APP_BIN = "harness"
DEV_IDENTIFIER = "com.harness.app.dev"
LOG_PREFIX = "[Harness:dev-runner]"


def signing_identity():
    explicit = os.environ.get("HARNESS_DEV_SIGNING_IDENTITY")
    if explicit:
        return explicit
    out = subprocess.run(
        ["security", "find-identity", "-v", "-p", "codesigning"],
        capture_output=True,
        text=True,
    ).stdout
    names = re.findall(r'"([^"]+)"', out)
    for prefix in ("Apple Development:", "Developer ID Application:"):
        for name in names:
            if name.startswith(prefix):
                return name
    return None


def ensure_signed(exe):
    info = subprocess.run(["codesign", "-dv", exe], capture_output=True, text=True).stderr
    if f"Identifier={DEV_IDENTIFIER}" in info and "Signature=adhoc" not in info:
        return
    identity = signing_identity()
    if not identity:
        print(f"{LOG_PREFIX} no codesigning identity; Accessibility will reset on every rebuild", file=sys.stderr)
        return
    result = subprocess.run(
        ["codesign", "--force", "--sign", identity, "--identifier", DEV_IDENTIFIER, exe],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"{LOG_PREFIX} codesign failed: {result.stderr.strip()}", file=sys.stderr)


def spawn_disclaimed(argv):
    """posix_spawn with responsibility disclaimed; returns the child pid or None."""
    libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    if not hasattr(libc, "responsibility_spawnattrs_setdisclaim"):
        return None
    attr = ctypes.c_void_p()
    if libc.posix_spawnattr_init(ctypes.byref(attr)) != 0:
        return None
    try:
        if libc.responsibility_spawnattrs_setdisclaim(ctypes.byref(attr), 1) != 0:
            return None
        c_argv = (ctypes.c_char_p * (len(argv) + 1))(*[a.encode() for a in argv], None)
        env = [f"{k}={v}".encode() for k, v in os.environ.items()]
        c_env = (ctypes.c_char_p * (len(env) + 1))(*env, None)
        pid = ctypes.c_int()
        rc = libc.posix_spawn(ctypes.byref(pid), argv[0].encode(), None, ctypes.byref(attr), c_argv, c_env)
        return pid.value if rc == 0 else None
    finally:
        libc.posix_spawnattr_destroy(ctypes.byref(attr))


def main():
    argv = sys.argv[1:]
    if not argv:
        sys.exit("usage: macos-dev-runner.py <exe> [args...]")
    exe = argv[0]
    if os.path.basename(exe) != APP_BIN or os.environ.get("HARNESS_DEV_SIGN") == "0":
        os.execv(exe, argv)

    ensure_signed(exe)
    # The app exits when this pid goes away, since tauri dev may SIGKILL us on rebuild.
    os.environ["HARNESS_DEV_RUNNER_PID"] = str(os.getpid())
    pid = spawn_disclaimed(argv)
    if pid is None:
        print(f"{LOG_PREFIX} disclaimed spawn unavailable; launching normally", file=sys.stderr)
        os.environ.pop("HARNESS_DEV_RUNNER_PID", None)
        os.execv(exe, argv)

    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda s, _f: os.kill(pid, s))
    _, status = os.waitpid(pid, 0)
    if os.WIFSIGNALED(status):
        sys.exit(128 + os.WTERMSIG(status))
    sys.exit(os.WEXITSTATUS(status))


if __name__ == "__main__":
    main()
