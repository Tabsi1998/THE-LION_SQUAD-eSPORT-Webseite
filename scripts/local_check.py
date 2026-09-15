#!/usr/bin/env python3
"""Run every check the CI runs, on this computer.

GitHub is the second, independent confirmation. This is the first: every job of
.github/workflows/ci.yml, run with the developer's own tools and processor, plus
the gates GitHub does not pay for.

The CI only runs the jobs whose area a pull request touched, because GitHub
bills by the minute. This machine does not, so everything runs unless a group
is deselected by hand.

Groups:
    repository  secrets, documentation links, every shell script, the public
                route contract, no CRLF stored, and Gitleaks over the history
                and over uncommitted and new files
    backend     the CI's Python 3.11 in an environment of its own, a full
                compile, the CI lint gate, pip-audit, and pytest with the
                coverage floor
    frontend    a frozen install, the dependency audit, ESLint, the production
                build, the unit suite with coverage, and the Playwright smoke
                on desktop and mobile
    mobile      Node 20, a locked install, the audit, the type check, the
                security and release regressions, the unit suite, the release
                preflight and the Expo configuration
    container   the compose contract, the nginx configuration, the hardened
                images, and the live stack answering its health probes - under
                a project name of its own, so a local development stack and its
                data are never touched
    extra       what GitHub does not run: black, isort, the whole of flake8,
                mypy, the contrast check, ShellCheck and OSV over the lockfiles

Usage:
    python scripts/local_check.py                  everything but extra
    python scripts/local_check.py --all            everything
    python scripts/local_check.py --only backend   some groups
    python scripts/local_check.py --list           the steps, without running
    python scripts/local_check.py --record         refresh the ratchet baseline

Results go to .local-testing/, which Git ignores.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".local-testing"
LOGS = STATE / "logs"
BASELINE = ROOT / "scripts" / "ci-baseline.json"
WINDOWS = platform.system() == "Windows"

GROUPS = ("repository", "backend", "frontend", "mobile", "container", "extra")
DEFAULT_GROUPS = ("repository", "backend", "frontend", "mobile", "container")

BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"
# Virtual environments live outside the repository. A repository script that
# walks the whole tree - a documentation link check, for one - would otherwise
# read thousands of third-party files as if they were the project's own.
CACHE = Path.home() / ".local-ci" / ROOT.name
VENV = CACHE / "venv"

# The versions ci.yml pins.
BACKEND_PYTHON = "3.11"
FRONTEND_NODE_MAJOR = 24
MOBILE_NODE_MAJOR = 20
COVERAGE_FLOOR = 35

BACKEND_PORT = 8001
FRONTEND_PORT = 3000

# The compose project of the local run. docker compose down --volumes deletes
# the volumes of its project; with the default project name that would be the
# developer's own local database.
COMPOSE_PROJECT = "tls-local-check"

# The environment of the CI's backend job, and nothing more: a variable the CI
# does not set can change what a test sees.
BACKEND_TEST_ENV = {
    "APP_ENV": "test",
    "MONGO_URL": "mongodb://127.0.0.1:27017",
    "DB_NAME": "tls_ci",
    "DISABLE_SCHEDULER": "true",
}

# The environment of the CI's compose validation and container smoke.
# Throwaway values; nothing here reaches a real system.
COMPOSE_ENV = {
    "APP_ENV": "production",
    "CORS_ORIGINS": "https://example.test",
    "FRONTEND_URL": "https://example.test",
    "PUBLIC_BACKEND_URL": "https://example.test",
    "JWT_SECRET": "ci-only-secret-value-with-at-least-32-characters",
    "SETTINGS_ENCRYPTION_KEY": "NQBHeGtQg5HYMo1HzvJtSQPN7X8YpJrZDvw-XMz0Bm8=",
    "MONGO_USERNAME": "tls_ci_admin",
    "MONGO_PASSWORD": "tls-ci-mongo-password",
    "FRONTEND_BIND": "127.0.0.1",
    "BACKEND_BIND": "127.0.0.1",
}


# =============================================================================
# Shared core
#
# Every repository's local_check.py carries the same copy of this part. The
# header above it names the paths and the groups, the steps below it say what
# is checked, and nothing in here knows which repository it is in. Each copy
# stands on its own, so a repository can be checked right after a fresh clone.
# =============================================================================

PASS, FAIL, SKIP = "passed", "failed", "skipped"

# The MongoDB the CI workflows run as a service.
MONGO_IMAGE = "mongo:7.0.39-jammy"
# OSV-Scanner 2.6.0 and ShellCheck 0.11.0, pinned by digest: a scanner that
# updates itself between two runs would change the findings on its own.
OSV_IMAGE = "ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa"
SHELLCHECK_IMAGE = "koalaman/shellcheck@sha256:bb596a0d169b85ddd81d8b6d3a2ff6d5baf5fca10b97f575ebc647c3dff62b3d"

# Git's well-known id of the empty tree. A diff against it covers every line.
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

TOOLCHAIN = Path.home() / ".local-toolchain"
PROGRESS = "local-check.progress.json"
REPORT = "local-check.json"

# Paths that belong to the local checks, never to the product. A snapshot of
# the repository leaves them out, so they cannot end up in a build or a scan.
LOCAL_TOOLING = (".ci-panel/", ".local-testing/")

# Variables whose names look like credentials. No check needs a real one, and a
# shell that happens to carry a live token or database password must not hand
# it to code under test. Only their names are printed.
SECRET_NAME = re.compile(
    r"TOKEN|SECRET|PASSW|CREDENTIAL|PRIVATE|API_?KEY|ENCRYPTION|_KEY$"
    r"|^(MONGO|SMTP|STRIPE|RESEND|JWT|DISCORD|ADMIN|DOLIBARR)_",
    re.IGNORECASE,
)


class StepFailed(Exception):
    """A step found a problem. The message says what, and how to fix it."""


class StepSkipped(Exception):
    """A step cannot run here. The message says why."""


@dataclass
class Step:
    group: str
    name: str
    describe: str
    action: Callable[["Context"], "str | None"]
    # Names of steps that must pass first. A bare name means the same group;
    # "group/name" reaches into another one.
    needs: tuple = ()

    @property
    def key(self) -> str:
        return f"{self.group}/{self.name}"

    def requirements(self) -> list[str]:
        return [need if "/" in need else f"{self.group}/{need}" for need in self.needs]


@dataclass
class Result:
    group: str
    name: str
    describe: str
    status: str
    detail: str = ""
    seconds: float = 0.0


@dataclass
class Context:
    env: dict
    dropped: list
    log_dir: Path
    record: bool = False
    containers: list = field(default_factory=list)
    processes: list = field(default_factory=list)
    cache: dict = field(default_factory=dict)

    def log(self, name: str, text: str) -> Path:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        path = self.log_dir / f"{name}.log"
        path.write_text(text, encoding="utf-8", errors="replace")
        return path

    def run(self, *arguments, cwd: Path | None = None, env: dict | None = None,
            check: bool = True, timeout: int = 1800,
            stdin: str | None = None) -> subprocess.CompletedProcess:
        """Run one command in the cleaned environment and capture its output."""
        merged = dict(self.env)
        if env:
            merged.update(env)
        command = [str(part) for part in arguments]
        try:
            completed = subprocess.run(
                command, cwd=str(cwd or ROOT), env=merged, input=stdin,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=timeout)
        except FileNotFoundError as error:
            raise StepSkipped(f"{command[0]} is not installed: {error}") from error
        except subprocess.TimeoutExpired as error:
            raise StepFailed(f"{Path(command[0]).name} did not finish within {timeout} s") from error
        if check and completed.returncode != 0:
            raise StepFailed(tail(completed))
        return completed


def clean_environment(source: dict) -> tuple[dict, list]:
    """Split an environment into what the steps get and the names withheld."""
    kept, withheld = {}, []
    for name, value in source.items():
        if SECRET_NAME.search(name):
            withheld.append(name)
        else:
            kept[name] = value
    return kept, sorted(withheld)


def base_context(record: bool = False) -> Context:
    env, withheld = clean_environment(dict(os.environ))
    # GitHub sets CI. Some tools behave differently with it - Create React App
    # turns lint warnings into errors - so the local run sets it too.
    env["CI"] = "true"
    env.setdefault("PYTHONUTF8", "1")
    env["npm_config_fund"] = "false"
    env["npm_config_update_notifier"] = "false"
    env["COREPACK_ENABLE_DOWNLOAD_PROMPT"] = "0"
    env["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
    STATE.mkdir(parents=True, exist_ok=True)
    return Context(env=env, dropped=withheld, log_dir=LOGS, record=record)


def tail(completed: subprocess.CompletedProcess, lines: int = 25) -> str:
    """The end of a failing command's output, which is where the reason is."""
    text = (completed.stdout or "") + (completed.stderr or "")
    kept = [line for line in text.splitlines() if line.strip()][-lines:]
    return "\n".join(kept) or f"exit code {completed.returncode}"


def tool(context: Context, name: str) -> str | None:
    return shutil.which(name, path=context.env.get("PATH"))


def require(context: Context, name: str, hint: str) -> str:
    found = tool(context, name)
    if not found:
        raise StepSkipped(f"{name} is not installed. {hint}")
    return found


def git(context: Context) -> str:
    return require(context, "git", "Install Git for Windows.")


def tracked(context: Context, *pathspecs: str, new: bool = False) -> list[str]:
    """Files Git knows, optionally with the new ones it would pick up."""
    arguments = ["ls-files", "-z", "--cached"]
    if new:
        arguments += ["--others", "--exclude-standard"]
    listed = context.run(git(context), *arguments, "--", *pathspecs).stdout.split("\0")
    return sorted({name for name in listed if name and (ROOT / name).is_file()})


def posix_bash(context: Context) -> str:
    """A real POSIX bash, never the WSL stub.

    System32\\bash.exe is the WSL launcher. It comes first on PATH in a plain
    PowerShell, it cannot read a Windows path, and it fails every script handed
    to it. A check that calls every deployment script broken teaches the
    developer to ignore it, so the stub is refused by name.
    """
    for folder in (r"C:\Program Files\Git\bin", r"C:\Program Files\Git\usr\bin"):
        candidate = Path(folder) / "bash.exe"
        if candidate.is_file():
            return str(candidate)
    found = tool(context, "bash")
    if found and "system32" not in found.lower():
        return found
    raise StepSkipped("no POSIX bash was found. Git for Windows ships one.")


def port_open(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.4)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def docker(context: Context) -> str:
    if "docker" in context.cache:
        return context.cache["docker"]
    binary = require(context, "docker", "Install Docker Desktop.")
    probe = context.run(binary, "info", "--format", "{{.ServerVersion}}", check=False, timeout=90)
    if probe.returncode != 0:
        raise StepSkipped("the Docker engine is not running. Start Docker Desktop.")
    context.cache["docker"] = binary
    return binary


# ------------------------------------------------------------------ runtimes

def python_for(context: Context, version: str) -> str:
    """The interpreter of one Python version, found through the py launcher."""
    key = f"python-{version}"
    if key in context.cache:
        return context.cache[key]
    found = None
    launcher = tool(context, "py")
    if launcher:
        probe = context.run(launcher, f"-{version}", "-c", "import sys; print(sys.executable)",
                            check=False, timeout=120)
        if probe.returncode == 0 and probe.stdout.strip():
            found = probe.stdout.strip().splitlines()[-1]
    found = found or tool(context, f"python{version}")
    if not found:
        raise StepSkipped(f"Python {version} is not installed. winget install Python.Python.{version}")
    context.cache[key] = found
    return found


def venv_executable(folder: Path) -> Path:
    return folder / ("Scripts/python.exe" if WINDOWS else "bin/python")


def make_venv(context: Context, folder: Path, interpreter: str, *pip_arguments) -> str:
    """An environment of its own, so a result cannot depend on what else is installed."""
    exe = venv_executable(folder)
    if not exe.is_file():
        context.run(interpreter, "-m", "venv", folder, timeout=900)
    completed = context.run(exe, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                            "--upgrade", "pip", *pip_arguments, timeout=3600)
    context.log(f"pip-{folder.name}", completed.stdout + completed.stderr)
    return str(exe)


def node_of(context: Context, major: int) -> str:
    """A Node of one major version: the pinned one, or the one on PATH if it matches.

    A newer Node must not quietly stand in for the one the CI uses. The runtime
    differences that break a deployment are the ones a version jump hides.
    """
    key = f"node-{major}"
    if key in context.cache:
        return context.cache[key]
    found = None
    executable = "node.exe" if WINDOWS else "node"
    if TOOLCHAIN.is_dir():
        for child in sorted(TOOLCHAIN.iterdir(), reverse=True):
            if child.is_dir() and child.name.startswith(f"node-v{major}."):
                for candidate in (child / executable, child / "bin" / executable):
                    if candidate.is_file():
                        found = str(candidate)
                        break
            if found:
                break
    if not found:
        system = tool(context, "node")
        if system:
            version = context.run(system, "--version", check=False, timeout=60).stdout.strip()
            if version.lstrip("v").split(".")[0] == str(major):
                found = system
    if not found:
        raise StepSkipped(f"Node {major} is not installed. Unpack node-v{major}.x into {TOOLCHAIN}")
    context.cache[key] = found
    return found


def npm_of(node: str) -> str:
    candidate = Path(node).with_name("npm.cmd" if WINDOWS else "npm")
    return str(candidate) if candidate.is_file() else "npm"


def node_path_env(context: Context, node: str) -> dict:
    """An environment in which that node, its npm and its corepack come first."""
    return {"PATH": os.pathsep.join([str(Path(node).parent), context.env.get("PATH", "")])}


def run_yarn(context: Context, cwd: Path, *arguments, node: str, check: bool = True,
             timeout: int = 3600) -> subprocess.CompletedProcess:
    """Yarn 1.22 through Corepack, with the chosen Node first on PATH.

    The lockfile is yarn.lock, so npm must never stand in: it would resolve a
    different tree than the one the deployment installs.
    """
    env = node_path_env(context, node)
    direct = shutil.which("yarn", path=env["PATH"])
    if direct:
        command = [direct]
    else:
        corepack = shutil.which("corepack", path=env["PATH"])
        if not corepack:
            raise StepSkipped("neither yarn nor corepack was found; Node ships corepack")
        command = [corepack, "yarn"]
    return context.run(*command, *arguments, cwd=cwd, env=env, check=check, timeout=timeout)


# ------------------------------------------------------------------ services

def start_mongo(context: Context, name: str, port: int, image: str = MONGO_IMAGE) -> str:
    """A MongoDB of the CI's image, in a container of its own on a port of its own.

    A fresh container per run means no test ever sees the previous run's data,
    and a port per repository means two repositories can be checked at once.
    """
    key = f"mongo:{name}"
    if key in context.cache:
        return context.cache[key]
    binary = docker(context)
    context.run(binary, "rm", "--force", name, check=False, timeout=120)
    if port_open(port):
        raise StepSkipped(f"port {port} is taken by something else; stop it and run again")
    context.run(binary, "run", "--detach", "--name", name, "--publish",
                f"127.0.0.1:{port}:27017", image, timeout=1800)
    context.containers.append(name)
    deadline = time.time() + 120
    while time.time() < deadline:
        ping = context.run(binary, "exec", name, "mongosh", "--quiet", "--eval",
                           "db.adminCommand({ping: 1}).ok", check=False, timeout=60)
        if ping.returncode == 0 and ping.stdout.strip().endswith("1"):
            url = f"mongodb://127.0.0.1:{port}"
            context.cache[key] = url
            return url
        time.sleep(2)
    raise StepFailed(f"{image} did not answer a ping within 120 s")


def start_process(context: Context, name: str, arguments: list, *, cwd: Path, env: dict,
                  url: str, seconds: int = 120, tls=None) -> None:
    """Start a server in the background and wait until it answers HTTP at all.

    Any HTTP answer counts, a 404 included: the question here is whether the
    process serves, and the checks that follow judge what it serves. For a
    server with a certificate of its own, tls is the ssl context that trusts it.
    """
    context.log_dir.mkdir(parents=True, exist_ok=True)
    path = context.log_dir / f"{name}.log"
    sink = path.open("w", encoding="utf-8", errors="replace")
    merged = dict(context.env)
    merged.update(env)
    process = subprocess.Popen([str(part) for part in arguments], cwd=str(cwd), env=merged,
                               stdout=sink, stderr=subprocess.STDOUT)
    context.processes.append((process, sink))
    deadline = time.time() + seconds
    while time.time() < deadline:
        if process.poll() is not None:
            sink.flush()
            output = path.read_text(encoding="utf-8", errors="replace")
            raise StepFailed(f"{name} exited with code {process.returncode} before it answered. "
                             f"Log: {path}\n{output[-2000:]}")
        try:
            with urllib.request.urlopen(url, timeout=5, context=tls):
                return
        except urllib.error.HTTPError:
            return
        except OSError:
            time.sleep(1)
    raise StepFailed(f"{name} did not answer {url} within {seconds} s. Log: {path}")


def stop_everything(context: Context) -> None:
    for process, sink in reversed(context.processes):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
        sink.close()
    context.processes.clear()
    binary = shutil.which("docker", path=context.env.get("PATH"))
    for name in reversed(context.containers):
        if binary:
            subprocess.run([binary, "rm", "--force", name], capture_output=True, text=True,
                           timeout=180)
    context.containers.clear()


def snapshot(context: Context, target: Path, *pathspecs: str, linux: bool = False) -> int:
    """Copy what Git would commit into target: tracked files as they are now, and new ones.

    Ignored files stay behind - a local .env with real credentials, a virtual
    environment, build output - and so do the local check's own files. With
    linux=True, text files get the LF endings a checkout on the Linux runner
    has, because bash in a container stops at the first CR.
    """
    if target.exists():
        shutil.rmtree(target)
    count = 0
    for name in tracked(context, *pathspecs, new=True):
        if name.startswith(LOCAL_TOOLING):
            continue
        data = (ROOT / name).read_bytes()
        if linux and b"\r\n" in data and b"\0" not in data[:8000]:
            data = data.replace(b"\r\n", b"\n")
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        count += 1
    return count


# ------------------------------------------------------------------- ratchet

def load_baseline() -> dict:
    try:
        return json.loads(BASELINE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_baseline(data: dict) -> None:
    BASELINE.parent.mkdir(parents=True, exist_ok=True)
    BASELINE.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                        encoding="utf-8", newline="\n")


def ratchet(context: Context, key: str, found: set, what: str) -> str:
    """Known findings are debt; new ones fail.

    A gate is green on the day it is switched on and honest from then on. Run
    with --record once debt has been paid down, so the baseline shrinks with it.
    """
    baseline = load_baseline()
    known = set(baseline.get(key, []))
    if context.record:
        baseline[key] = sorted(found)
        save_baseline(baseline)
        return f"baseline recorded: {len(found)} {what}"
    new = sorted(found - known)
    if new:
        shown = "\n  ".join(new[:20]) + ("\n  ..." if len(new) > 20 else "")
        raise StepFailed(f"{len(new)} new {what}:\n  {shown}\n"
                         f"Fix them, or run with --record to accept them into {BASELINE.name}.")
    note = f"{len(found)} known {what}" if found else f"no {what}"
    resolved = known - found
    if resolved:
        note += f"; {len(resolved)} resolved since the baseline, run --record to lock that in"
    return note


# ------------------------------------------------------ steps every repo shares

def shell_scripts(context: Context) -> str:
    """Every shell script parses, with the line endings Git stores.

    The CI checks the scripts it names. This checks every .sh in the repository:
    a restore or deploy script that only breaks during an incident is the worst
    place to find a typo.
    """
    bash = posix_bash(context)
    listed = tracked(context, "*.sh", new=True)
    if not listed:
        raise StepSkipped("no shell scripts in this repository")
    broken = []
    for name in listed:
        text = (ROOT / name).read_bytes().replace(b"\r\n", b"\n").decode("utf-8", "replace")
        completed = context.run(bash, "-n", check=False, timeout=120, stdin=text)
        if completed.returncode != 0:
            broken.append(f"{name}: {tail(completed, 2)}")
    if broken:
        raise StepFailed("these do not parse:\n  " + "\n  ".join(broken))
    return f"{len(listed)} scripts parse"


def line_endings(context: Context) -> str:
    """No CRLF in what Git stores for text files.

    Git for Windows converts line endings on the way out, so a file can look
    right here and still be stored with CRLF - and a shell script stored that
    way fails on a Linux server with 'bad interpreter'. This reads the index,
    which is what every other machine checks out.
    """
    found = set()
    for entry in context.run(git(context), "ls-files", "--eol", "-z").stdout.split("\0"):
        info, _, path = entry.partition("\t")
        fields = info.split()
        if not path or not fields:
            continue
        attributes = info.partition("attr/")[2].strip()
        if fields[0] in ("i/crlf", "i/mixed") and "-text" not in attributes:
            found.add(f"{path} ({fields[0][2:]})")
    return ratchet(context, "line-endings", found, "text files stored with CRLF")


def whitespace(context: Context) -> str:
    """git diff --check over everything, not over nothing.

    On a fresh checkout there is no diff, so a CI that runs git diff --check can
    never fail. Measured against the empty tree it covers every committed line:
    what is there today is recorded, and whitespace errors in uncommitted
    changes fail outright.
    """
    binary = git(context)
    committed = context.run(binary, "diff", "--check", EMPTY_TREE, "HEAD", check=False, timeout=900)
    found = set()
    for line in committed.stdout.splitlines():
        match = re.match(r"^(.+?):\d+: (.+?)\.?$", line)
        if match:
            found.add(f"{match.group(1)}: {match.group(2)}")
    pending = context.run(binary, "diff", "--check", "HEAD", check=False, timeout=900)
    fresh = [line for line in pending.stdout.splitlines() if re.match(r"^.+?:\d+: ", line)]
    if fresh:
        raise StepFailed("whitespace errors in uncommitted changes:\n  " + "\n  ".join(fresh[:20]))
    return ratchet(context, "whitespace", found, "committed whitespace errors")


def gitleaks_binary(context: Context) -> str:
    return require(context, "gitleaks", "winget install Gitleaks.Gitleaks")


def gitleaks_config() -> list[str]:
    config = ROOT / ".gitleaks.toml"
    return ["--config", str(config)] if config.is_file() else []


def gitleaks_history(context: Context) -> str:
    completed = context.run(gitleaks_binary(context), "git", ".", "--redact", "--no-banner",
                            *gitleaks_config(), "--log-opts=HEAD", check=False, timeout=1800)
    output = completed.stdout + completed.stderr
    context.log("gitleaks-history", output)
    if completed.returncode != 0:
        raise StepFailed("Gitleaks found secrets in the reachable history:\n" + tail(completed))
    commits = re.search(r"(\d+) commits scanned", output)
    return f"{commits.group(1) if commits else 'every'} commits are clean"


def gitleaks_worktree(context: Context) -> str:
    """The files Git does not have yet: changed ones and new ones.

    The history scan cannot see them, and neither can GitHub. Only what Git
    would pick up is scanned - ignored logs and build output are left out - so
    a finding here is always something that could be committed next.
    """
    binary = git(context)
    changed = set(context.run(binary, "diff", "--name-only", "-z", "HEAD").stdout.split("\0"))
    changed |= set(context.run(binary, "ls-files", "-z", "--others", "--exclude-standard").stdout.split("\0"))
    pending = sorted(name for name in changed
                     if name and not name.startswith(LOCAL_TOOLING) and (ROOT / name).is_file())
    if not pending:
        return "nothing uncommitted to scan"
    with tempfile.TemporaryDirectory(prefix="local-check-leaks-") as folder:
        for name in pending:
            destination = Path(folder) / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, destination)
        completed = context.run(gitleaks_binary(context), "dir", ".", "--redact", "--no-banner",
                                *gitleaks_config(), cwd=Path(folder), check=False, timeout=1800)
    context.log("gitleaks-worktree", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed("Gitleaks found secrets in uncommitted or new files:\n" + tail(completed))
    return f"{len(pending)} uncommitted or new files are clean"


def osv_scan(context: Context) -> str:
    """Known vulnerabilities in every lockfile, from the OSV database.

    One scanner reads package-lock.json, yarn.lock, requirements files, go.sum
    and NuGet locks alike, so every ecosystem in the repository is judged by
    the same source of advisories. Transitive resolution stays off: for a
    requirements file without a lock it picks the oldest allowed versions -
    h11 0.9.0 where 0.16.0 is installed - and reports advisories that do not
    apply.
    """
    binary = docker(context)
    completed = context.run(binary, "run", "--rm", "--mount",
                            f"type=bind,source={ROOT},target=/src,readonly", OSV_IMAGE,
                            "scan", "source", "--recursive", "--no-resolve", "--allow-no-lockfiles",
                            "--format", "json", "/src",
                            check=False, timeout=2400)
    output = completed.stdout + completed.stderr
    context.log("osv-scanner", output)
    if "No package sources found" in output:
        return "no lockfiles in this repository, nothing to scan"
    if completed.returncode not in (0, 1):
        raise StepFailed("OSV-Scanner could not scan the repository:\n" + tail(completed))
    try:
        report = json.loads(completed.stdout or "{}")
    except ValueError as error:
        raise StepFailed("OSV-Scanner produced no JSON report:\n" + tail(completed)) from error
    found = set()
    for result in report.get("results") or []:
        source = str((result.get("source") or {}).get("path", "")).replace("/src/", "", 1)
        for package in result.get("packages") or []:
            info = package.get("package") or {}
            for vulnerability in package.get("vulnerabilities") or []:
                found.add(f"{source}: {info.get('name')} {info.get('version')} {vulnerability.get('id')}")
    return ratchet(context, "osv", found, "known vulnerabilities in the lockfiles")


def shellcheck(context: Context) -> str:
    """ShellCheck over every tracked script: quoting, globbing and exit-code traps."""
    listed = tracked(context, "*.sh")
    if not listed:
        raise StepSkipped("no shell scripts in this repository")
    binary = docker(context)
    completed = context.run(binary, "run", "--rm", "--mount",
                            f"type=bind,source={ROOT},target=/mnt,readonly", SHELLCHECK_IMAGE,
                            "--format=json1", *[f"/mnt/{name}" for name in listed],
                            check=False, timeout=900)
    try:
        report = json.loads(completed.stdout or '{"comments": []}')
    except ValueError as error:
        raise StepFailed("ShellCheck produced no report:\n" + tail(completed)) from error
    found = {f"{comment['file'][5:]}: SC{comment['code']} ({comment['level']})"
             for comment in report.get("comments", [])}
    return ratchet(context, "shellcheck", found, "ShellCheck findings")


def pytest_counts(text: str) -> dict:
    """The counts from pytest's last summary line."""
    lines = [line for line in text.splitlines()
             if re.search(r"\d+ (passed|failed|skipped|errors?|deselected)", line)]
    counts: dict = {}
    if lines:
        for number, kind in re.findall(r"(\d+) (passed|failed|skipped|errors?|deselected)", lines[-1]):
            counts["errors" if kind.startswith("error") else kind] = int(number)
    return counts


def describe_counts(counts: dict) -> str:
    order = ("passed", "failed", "errors", "skipped", "deselected")
    return ", ".join(f"{counts[kind]} {kind}" for kind in order if counts.get(kind)) or "no tests reported"


# -------------------------------------------------------------------- runner

def head_info() -> dict:
    binary = shutil.which("git")
    if not binary:
        return {}

    def ask(*arguments: str) -> str:
        completed = subprocess.run([binary, *arguments], cwd=str(ROOT), capture_output=True,
                                   text=True, encoding="utf-8", errors="replace")
        return completed.stdout.strip()

    return {"branch": ask("branch", "--show-current"), "head": ask("rev-parse", "--short", "HEAD"),
            "subject": ask("log", "-1", "--format=%s"), "dirty": bool(ask("status", "--porcelain"))}


def write_progress(planned: list, results: list, current, started: str, finished: bool,
                   info: dict) -> None:
    """What has run so far, for the dashboard. Best effort: a locked file is skipped."""
    done = {(item.group, item.name): item for item in results}
    steps = []
    for step in planned:
        item = done.get((step.group, step.name))
        if item:
            steps.append({"group": item.group, "name": item.name, "describe": item.describe,
                          "status": item.status, "detail": item.detail, "seconds": item.seconds})
        else:
            steps.append({"group": step.group, "name": step.name, "describe": step.describe,
                          "status": "running" if step is current else "pending",
                          "detail": "", "seconds": 0})
    payload = {"repo": ROOT.name, "path": str(ROOT), "started": started,
               "finished": datetime.now(timezone.utc).isoformat(timespec="seconds") if finished else None,
               "git": info, "steps": steps}
    try:
        STATE.mkdir(parents=True, exist_ok=True)
        temporary = STATE / (PROGRESS + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, STATE / PROGRESS)
    except OSError:
        pass


def execute(steps: list, context: Context) -> list:
    results: list = []
    passed: set = set()
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    info = head_info()
    context.cache["git-info"] = info
    for step in steps:
        missing = [need for need in step.requirements() if need not in passed]
        if missing:
            detail = f"needs {', '.join(missing)} to pass first"
            results.append(Result(step.group, step.name, step.describe, SKIP, detail))
            print(f"SKIPPED         {step.key}: {detail}", flush=True)
            continue
        print(f"\n== {step.group}: {step.describe}", flush=True)
        write_progress(steps, results, step, started, False, info)
        clock = time.monotonic()
        try:
            detail = step.action(context) or ""
            status = PASS
            passed.add(step.key)
        except StepSkipped as reason:
            detail, status = str(reason), SKIP
        except StepFailed as reason:
            detail, status = str(reason), FAIL
        except Exception as reason:  # a bug in a check must not read as a clean run
            detail, status = f"the check itself failed: {reason!r}", FAIL
        seconds = round(time.monotonic() - clock, 1)
        results.append(Result(step.group, step.name, step.describe, status, detail, seconds))
        head = detail.splitlines()[0] if detail else ""
        print(f"{status.upper():<8} {seconds:6.1f} s  {head}", flush=True)
    write_progress(steps, results, None, started, True, info)
    return results


def summary(results: list, seconds: float) -> str:
    counts = {status: sum(1 for item in results if item.status == status) for status in (PASS, FAIL, SKIP)}
    lines = [f"\n{ROOT.name}: {counts[PASS]} passed, {counts[SKIP]} skipped, "
             f"{counts[FAIL]} failed in {seconds:.0f} s"]
    for item in results:
        head = item.detail.splitlines()[0] if item.detail else ""
        lines.append(f"  {item.status.upper():<8}{item.group:<12}{item.describe:<58}"
                     f"{item.seconds:7.1f} s  {head[:110]}")
    failed = [item for item in results if item.status == FAIL]
    if failed:
        lines.append("\nWhat failed, in full:")
        for item in failed:
            lines.append(f"\n  {item.group}/{item.name} - {item.describe}")
            lines.extend(f"    {line}" for line in item.detail.splitlines())
    return "\n".join(lines)


def main(argv: list | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description=f"Run every check for {ROOT.name} on this computer.")
    parser.add_argument("--only", help="comma-separated groups: " + ", ".join(GROUPS))
    parser.add_argument("--all", action="store_true", help="include the extra group, which GitHub does not run")
    parser.add_argument("--list", action="store_true", help="show the steps without running them")
    parser.add_argument("--record", action="store_true", help="accept today's findings into the ratchet baseline")
    parser.add_argument("--keep-services", action="store_true", help="leave containers and servers running")
    arguments = parser.parse_args(argv)

    if arguments.only:
        groups = {name.strip() for name in arguments.only.split(",") if name.strip()}
        unknown = groups - set(GROUPS)
        if unknown:
            parser.error("unknown groups: " + ", ".join(sorted(unknown)))
    elif arguments.all or arguments.record:
        groups = set(GROUPS)
    else:
        groups = set(DEFAULT_GROUPS)

    steps = plan(groups)
    if arguments.list:
        for step in steps:
            print(f"{step.group:<12} {step.describe}")
        return 0

    context = build_context(record=arguments.record)
    print(f"{ROOT.name}: {', '.join(group for group in GROUPS if group in groups)}", flush=True)
    if context.dropped:
        print("Withheld from every step (names only): " + ", ".join(context.dropped), flush=True)

    clock = time.monotonic()
    try:
        results = execute(steps, context)
    finally:
        if arguments.keep_services:
            print("Containers and servers are left running (--keep-services).")
        else:
            tear_down(context)
    seconds = time.monotonic() - clock

    report = {"repo": ROOT.name, "groups": [group for group in GROUPS if group in groups],
              "seconds": round(seconds, 1), "git": context.cache.get("git-info", {}),
              "results": [vars(item) for item in results]}
    (STATE / REPORT).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(summary(results, seconds))
    print(f"Report: {STATE / REPORT}")
    return 1 if any(item.status == FAIL for item in results) else 0


# ======================================================= THE LION SQUAD eSPORT

# ---------------------------------------------------------------- repository

def repo_script(context: Context, script: str, *arguments: str) -> subprocess.CompletedProcess:
    completed = context.run(sys.executable, ROOT / "scripts" / script, *arguments, check=False, timeout=900)
    context.log(Path(script).stem, completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed(tail(completed))
    return completed


def check_secrets(context: Context) -> str:
    repo_script(context, "check-secrets.py")
    return "no secrets or removed provider remnants in tracked source"


def doc_links(context: Context) -> str:
    repo_script(context, "check-doc-links.py")
    return "every documentation link resolves"


def msys_path(path: Path) -> str:
    """A Windows path as Git Bash writes it: C:/a/b becomes /c/a/b."""
    text = path.resolve().as_posix()
    if WINDOWS and len(text) > 2 and text[1] == ":":
        return f"/{text[0].lower()}{text[2:]}"
    return text


def public_routes(context: Context) -> str:
    """The public and legacy route contract, against nginx in a container.

    Under Git Bash, MSYS rewrites the paths the script hands to docker --volume,
    so nginx starts without the site's configuration and every route looks
    broken. MSYS_NO_PATHCONV keeps the paths as written, and a temporary folder
    inside the repository keeps the mktemp directory visible to Docker Desktop.
    The script itself is untouched; on the Linux runner neither setting matters.
    """
    scratch = STATE / "tmp"
    scratch.mkdir(parents=True, exist_ok=True)
    env = {"MSYS_NO_PATHCONV": "1", "TMPDIR": msys_path(scratch)}
    completed = context.run(posix_bash(context), "scripts/check-public-routes.sh", env=env,
                            check=False, timeout=900)
    context.log("public-routes", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed("the public route contract is broken:\n" + tail(completed))
    return "the public and legacy route contract holds"


def repository_steps() -> list:
    return [
        Step("repository", "secrets", "Secrets and removed provider remnants", check_secrets),
        Step("repository", "doc-links", "Every documentation link resolves", doc_links),
        Step("repository", "shell", "Every shell script parses", shell_scripts),
        Step("repository", "routes", "The public and legacy route contract", public_routes),
        Step("repository", "line-endings", "No CRLF stored for text files", line_endings),
        Step("repository", "gitleaks-history", "Gitleaks over the history", gitleaks_history),
        Step("repository", "gitleaks-worktree", "Gitleaks over uncommitted and new files",
             gitleaks_worktree),
    ]


# ------------------------------------------------------------------- backend

def venv_python() -> str:
    exe = venv_executable(VENV)
    if not exe.is_file():
        raise StepSkipped("the backend environment is not built yet")
    return str(exe)


def backend_environment(context: Context) -> str:
    # tzdata: Windows has no zoneinfo database, so a test that builds a named
    # timezone fails here and passes on the Linux runner. It is a data package
    # for the local run and changes nothing in production.
    extra = ["tzdata"] if WINDOWS else []
    exe = make_venv(context, VENV, python_for(context, BACKEND_PYTHON),
                    "--requirement", BACKEND / "requirements.txt",
                    "--requirement", BACKEND / "requirements-dev.txt", *extra)
    return context.run(exe, "--version", timeout=60).stdout.strip() + " with both requirement files"


def backend_compile(context: Context) -> str:
    completed = context.run(venv_python(), "-m", "compileall", "-q", "-x", r"[\\/](\.?venv|node_modules)[\\/]",
                            BACKEND, check=False, timeout=900)
    if completed.returncode != 0:
        raise StepFailed(tail(completed))
    return "the backend compiles"


def backend_lint(context: Context) -> str:
    """The lint gate the CI enforces: undefined names and syntax hazards."""
    completed = context.run(venv_python(), "-m", "flake8", "backend", "--select=E9,F63,F7,F82",
                            "--exclude=backend/tests", check=False, timeout=900)
    if completed.returncode != 0:
        raise StepFailed("flake8 found undefined names or syntax hazards:\n" + tail(completed))
    return "no undefined names or syntax hazards"


def backend_audit(context: Context) -> str:
    """pip-audit, failing as the CI fails: on any known vulnerability."""
    completed = context.run(venv_python(), "-m", "pip_audit", "-r", BACKEND / "requirements.txt",
                            check=False, timeout=1800)
    context.log("pip-audit", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed("pip-audit found vulnerable backend dependencies:\n" + tail(completed))
    return "no known vulnerabilities in backend/requirements.txt"


def backend_tests(context: Context) -> str:
    """The suite the CI runs, with the same coverage floor and the same environment."""
    results = STATE / "test-results"
    uploads = STATE / "uploads"
    results.mkdir(parents=True, exist_ok=True)
    uploads.mkdir(parents=True, exist_ok=True)
    env = dict(BACKEND_TEST_ENV, UPLOAD_DIR=str(uploads))
    completed = context.run(venv_python(), "-m", "pytest", "-m", "not live", "--cov=backend",
                            f"--cov-fail-under={COVERAGE_FLOOR}",
                            f"--cov-report=xml:{results / 'backend-coverage.xml'}",
                            f"--junitxml={results / 'backend-junit.xml'}",
                            env=env, check=False, timeout=5400)
    text = completed.stdout + completed.stderr
    path = context.log("backend-tests", text)
    if completed.returncode != 0:
        raise StepFailed(f"the backend suite failed. Full output: {path}\n" + tail(completed, 30))
    note = describe_counts(pytest_counts(text))
    coverage = re.search(r"TOTAL\s+\d+\s+\d+\s+(?:\d+\s+\d+\s+)?(\d+(?:\.\d+)?)%", text)
    if coverage:
        note += f", {coverage.group(1)}% covered (floor {COVERAGE_FLOOR}%)"
    return note


def backend_steps() -> list:
    return [
        Step("backend", "venv", f"Python {BACKEND_PYTHON} with both requirement files", backend_environment),
        Step("backend", "compile", "The backend compiles", backend_compile, ("venv",)),
        Step("backend", "lint", "No undefined names or syntax hazards", backend_lint, ("venv",)),
        Step("backend", "audit", "No known vulnerabilities in the dependencies", backend_audit, ("venv",)),
        Step("backend", "tests", f"The suite, with the {COVERAGE_FLOOR}% coverage floor", backend_tests,
             ("venv",)),
    ]


# ------------------------------------------------------------------ frontend

def yarn(context: Context, *arguments: str, check: bool = True, timeout: int = 3600) -> subprocess.CompletedProcess:
    return run_yarn(context, FRONTEND, *arguments, node=node_of(context, FRONTEND_NODE_MAJOR),
                    check=check, timeout=timeout)


def yarn_step(name: str, describe: str, *arguments: str, failure: str, needs: tuple = ("install",),
              timeout: int = 3600) -> Step:
    def action(context: Context) -> str:
        completed = yarn(context, *arguments, check=False, timeout=timeout)
        path = context.log(f"frontend-{name}", completed.stdout + completed.stderr)
        if completed.returncode != 0:
            raise StepFailed(f"{failure}. Full output: {path}\n" + tail(completed, 30))
        return " ".join(("yarn",) + arguments)
    return Step("frontend", name, describe, action, needs)


def frontend_install(context: Context) -> str:
    completed = yarn(context, "install", "--frozen-lockfile", check=False)
    path = context.log("frontend-install", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed(f"the frozen install failed. Full output: {path}\n" + tail(completed))
    return "yarn install --frozen-lockfile"


def frontend_build(context: Context) -> str:
    completed = yarn(context, "build", check=False)
    path = context.log("frontend-build", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed(f"the production build failed. Full output: {path}\n" + tail(completed, 30))
    out = next((FRONTEND / name for name in ("dist", "build") if (FRONTEND / name / "index.html").is_file()), None)
    if out is None:
        raise StepFailed("the build produced no index.html in dist/ or build/")
    bundles = [item for item in out.rglob("*.js") if item.is_file()]
    if not bundles:
        raise StepFailed(f"the build produced no JavaScript under {out}")
    size = sum(item.stat().st_size for item in out.rglob("*") if item.is_file())
    return f"{out.name}/: {len(bundles)} bundles, {size // 1024} KiB"


def frontend_unit(context: Context) -> str:
    completed = yarn(context, "test:coverage", check=False)
    text = completed.stdout + completed.stderr
    path = context.log("frontend-unit", text)
    if completed.returncode != 0:
        raise StepFailed(f"the frontend unit suite failed. Full output: {path}\n" + tail(completed, 30))
    passed = re.search(r"Tests\s+(\d+) passed", text)
    return f"{passed.group(1) if passed else '?'} tests passed"


def frontend_e2e(context: Context) -> str:
    completed = yarn(context, "test:e2e", check=False, timeout=5400)
    text = completed.stdout + completed.stderr
    path = context.log("frontend-e2e", text)
    if completed.returncode != 0:
        raise StepFailed(f"the browser smoke tests failed. Report: {FRONTEND / 'playwright-report'}. "
                         f"Full output: {path}\n" + tail(completed, 30))
    passed = re.search(r"(\d+) passed", text)
    return f"{passed.group(1) if passed else '?'} browser tests passed"


def frontend_steps() -> list:
    return [
        Step("frontend", "install", "A frozen install from yarn.lock", frontend_install),
        yarn_step("audit", "No high severity advisories", "audit:high",
                  failure="the frontend audit found high severity advisories"),
        yarn_step("lint", "ESLint against the recorded suppressions", "lint",
                  failure="ESLint found new problems; known ones live in eslint-suppressions.json"),
        Step("frontend", "build", "The production build, and it is not empty", frontend_build, ("install",)),
        Step("frontend", "unit", "The unit suite with coverage", frontend_unit, ("install",)),
        yarn_step("browser", "Chromium for the smoke tests", "playwright", "install", "chromium",
                  failure="Playwright could not install Chromium"),
        Step("frontend", "e2e", "Browser smoke tests, desktop and mobile", frontend_e2e, ("browser",)),
    ]


# -------------------------------------------------------------------- mobile

def mobile_run(context: Context, *arguments: str, check: bool = True, timeout: int = 2400) -> subprocess.CompletedProcess:
    if not MOBILE.is_dir():
        raise StepSkipped("there is no mobile/ directory in this checkout")
    node = node_of(context, MOBILE_NODE_MAJOR)
    return context.run(npm_of(node), *arguments, cwd=MOBILE, env=node_path_env(context, node),
                       check=check, timeout=timeout)


def mobile_install(context: Context) -> str:
    completed = mobile_run(context, "ci", "--no-audit", "--no-fund", check=False, timeout=3600)
    path = context.log("mobile-install", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed(f"npm ci failed. Full output: {path}\n" + tail(completed))
    return "npm ci on Node " + context.run(node_of(context, MOBILE_NODE_MAJOR), "--version", timeout=60).stdout.strip()


def mobile_script(script: str, describe: str, *, name: str, timeout: int = 2400) -> Step:
    def action(context: Context) -> str:
        completed = mobile_run(context, "run", script, check=False, timeout=timeout)
        path = context.log(f"mobile-{name}", completed.stdout + completed.stderr)
        if completed.returncode != 0:
            raise StepFailed(f"npm run {script} failed. Full output: {path}\n" + tail(completed, 25))
        return f"npm run {script}"
    return Step("mobile", name, describe, action, ("install",))


def mobile_tests(context: Context) -> str:
    completed = mobile_run(context, "test", check=False, timeout=3600)
    text = completed.stdout + completed.stderr
    path = context.log("mobile-tests", text)
    if completed.returncode != 0:
        raise StepFailed(f"the mobile suite failed. Full output: {path}\n" + tail(completed, 25))
    passed = re.search(r"Tests:\s+(\d+) passed", text)
    return f"{passed.group(1) if passed else '?'} tests passed"


def expo_config(context: Context) -> str:
    """The Expo configuration matches the installed SDK.

    The CI pins expo-doctor to 1.20.4 until the SDK 57 migration lands, and so
    does this: a newer doctor would report problems the CI does not.
    """
    node = node_of(context, MOBILE_NODE_MAJOR)
    npx = Path(npm_of(node)).with_name("npx.cmd" if WINDOWS else "npx")
    env = node_path_env(context, node)
    check = context.run(npx, "expo", "install", "--check", cwd=MOBILE, env=env, check=False, timeout=2400)
    context.log("expo-install-check", check.stdout + check.stderr)
    if check.returncode != 0:
        raise StepFailed("expo install --check found mismatched packages:\n" + tail(check))
    doctor = context.run(npx, "--yes", "expo-doctor@1.20.4", cwd=MOBILE, env=env, check=False, timeout=2400)
    context.log("expo-doctor", doctor.stdout + doctor.stderr)
    if doctor.returncode != 0:
        raise StepFailed("expo-doctor found problems:\n" + tail(doctor))
    return "the Expo configuration is consistent"


def java_for_release(context: Context) -> str:
    """A Java the Android release tooling can use. The CI sets up Temurin 21."""
    binary = require(context, "java", "Install a JDK; Temurin 21 matches the CI.")
    completed = context.run(binary, "-version", check=False, timeout=120)
    lines = (completed.stdout + completed.stderr).strip().splitlines()
    found = lines[0] if lines else "unknown"
    version = re.search(r'"(\d+)', found)
    if version and int(version.group(1)) < 17:
        raise StepFailed(f"the Android release tooling needs Java 17 or newer, this is {found}")
    return found


def mobile_steps() -> list:
    return [
        Step("mobile", "install", "A locked install on Node 20", mobile_install),
        Step("mobile", "java", "A Java the release tooling can use", java_for_release),
        mobile_script("audit:ci", "No advisories above the threshold", name="audit"),
        mobile_script("typecheck", "TypeScript type check", name="typecheck"),
        mobile_script("test:security", "Cache and logging security regressions", name="security"),
        mobile_script("test:release", "Release version tooling tests", name="release-tests"),
        Step("mobile", "tests", "The mobile unit suite", mobile_tests, ("install",)),
        mobile_script("release:preflight", "Release preflight", name="preflight"),
        Step("mobile", "expo", "The Expo configuration matches the SDK", expo_config, ("install",)),
    ]


# ----------------------------------------------------------------- container

def compose(context: Context, *arguments: str, project: bool = True, check: bool = True,
            timeout: int = 3600) -> subprocess.CompletedProcess:
    prefix = ["-p", COMPOSE_PROJECT] if project else []
    return context.run(docker(context), "compose", *prefix, *arguments, env=COMPOSE_ENV,
                       check=check, timeout=timeout)


def backup_target(context: Context, definition: str, *arguments: str) -> None:
    completed = context.run(sys.executable, ROOT / "scripts" / "compose-backup-target.py", *arguments,
                            stdin=definition, check=False, timeout=600)
    if completed.returncode != 0:
        raise StepFailed(f"the compose file names the wrong backup target ({' '.join(arguments)}):\n"
                         + tail(completed))


def compose_contract(context: Context) -> str:
    """The compose files parse, and the backup targets they name are the real ones.

    A backup that writes to the wrong database or volume looks like it worked
    until the day of the restore. The same invocations as the CI, which reads
    the configuration only.
    """
    compose(context, "config", "-q", project=False, timeout=900)
    backup_target(context, compose(context, "config", "--format", "json", project=False, timeout=900).stdout,
                  "--db", "tls_arena")
    staging = compose(context, "--env-file", ".env.staging.example", "-p", "tls-staging",
                      "-f", "docker-compose.yml", "-f", "docker-compose.staging.yml",
                      "config", "--format", "json", project=False, check=False, timeout=900)
    if staging.returncode != 0:
        raise StepFailed("the staging compose does not parse:\n" + tail(staging))
    backup_target(context, staging.stdout, "--db", "tls_arena_staging", "--volume", "tls-staging_uploads_data")
    return "production and staging name the right database and volume"


def nginx_config(context: Context) -> str:
    completed = context.run(docker(context), "run", "--rm", "--add-host", "backend:127.0.0.1",
                            "--mount", f"type=bind,source={FRONTEND / 'nginx.conf'},"
                                       "target=/etc/nginx/conf.d/default.conf,readonly",
                            "nginx:alpine", "nginx", "-t", check=False, timeout=1800)
    context.log("nginx-config", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed("the nginx configuration is not valid:\n" + tail(completed))
    return "frontend/nginx.conf is valid"


def compose_build(context: Context) -> str:
    completed = compose(context, "build", check=False, timeout=7200)
    path = context.log("compose-build", completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise StepFailed(f"the images do not build. Full output: {path}\n" + tail(completed))
    return "the hardened images build"


def compose_start(context: Context) -> str:
    for port in (BACKEND_PORT, FRONTEND_PORT):
        if port_open(port):
            raise StepSkipped(f"port {port} is taken - a development stack? Stop it and run again")
    compose(context, "up", "-d", timeout=3600)
    context.cache["compose-up"] = True
    probes = (f"http://127.0.0.1:{BACKEND_PORT}/api/health/live",
              f"http://127.0.0.1:{BACKEND_PORT}/api/health/ready",
              f"http://127.0.0.1:{FRONTEND_PORT}/health")
    deadline = time.time() + 180
    last = ""
    while time.time() < deadline:
        try:
            for url in probes:
                with urllib.request.urlopen(url, timeout=10) as answer:
                    if answer.status != 200:
                        raise OSError(f"{url} answered {answer.status}")
            return "live, ready and the web health probe all answer"
        except OSError as reason:
            last = str(reason)
            time.sleep(3)
    logs = compose(context, "logs", "--no-color", "--tail=150", check=False, timeout=600)
    path = context.log("compose-logs", logs.stdout + logs.stderr)
    raise StepFailed(f"the stack did not become healthy within 180 s ({last}). Container logs: {path}")


def stack_script(script: str, *arguments: str, success: str):
    def action(context: Context) -> str:
        # The scripts call docker compose themselves. On GitHub they inherit the
        # job environment; here they get the same variables and the local project
        # name, or compose cannot even read its file.
        env = dict(COMPOSE_ENV, COMPOSE_PROJECT_NAME=COMPOSE_PROJECT)
        completed = context.run(sys.executable, ROOT / "scripts" / script, *arguments, env=env,
                                check=False, timeout=1800)
        context.log(Path(script).stem, completed.stdout + completed.stderr)
        if completed.returncode != 0:
            raise StepFailed(tail(completed))
        return success
    return action


def container_steps() -> list:
    web = f"http://127.0.0.1:{FRONTEND_PORT}"
    return [
        Step("container", "compose-contract", "The compose files and their backup targets", compose_contract),
        Step("container", "nginx", "The reverse proxy configuration is valid", nginx_config),
        Step("container", "build", "The hardened images build", compose_build, ("compose-contract",)),
        Step("container", "up", "The stack answers live, ready and health", compose_start, ("build",)),
        Step("container", "inventory", "The read-only host inventory",
             stack_script("staging-preflight.py", success="the host inventory is consistent"), ("up",)),
        Step("container", "web-release", "Release marker and cache headers",
             stack_script("check-web-update.py", web, success="the release marker and cache headers are right"),
             ("up",)),
        Step("container", "media", "Uploads are served by nginx",
             stack_script("check-media-serving.py", web, success="nginx serves the uploads from disk"),
             ("up",)),
    ]


# --------------------------------------------------------------------- extra

def relative(path: str) -> str:
    return Path(path).as_posix().replace(ROOT.as_posix() + "/", "")


def formatting(context: Context) -> str:
    """black and isort, which requirements-dev pins and the CI never calls."""
    exe = venv_python()
    found = set()
    black = context.run(exe, "-m", "black", "--check", "backend", check=False, timeout=1800)
    for name in re.findall(r"would reformat (.+)", black.stdout + black.stderr):
        found.add(f"black: {relative(name.strip())}")
    isort = context.run(exe, "-m", "isort", "--check-only", "backend", check=False, timeout=1800)
    for name in re.findall(r"ERROR: (.+?) Imports are incorrectly sorted", isort.stdout + isort.stderr):
        found.add(f"isort: {relative(name.strip())}")
    return ratchet(context, "formatting", found, "files whose formatting has drifted")


def full_lint(context: Context) -> str:
    """All of flake8, not only the four rules the CI blocks on.

    E9, F63, F7 and F82 catch code that cannot run. Unused imports, shadowed
    names and bare excepts are what make the next change risky.
    """
    completed = context.run(venv_python(), "-m", "flake8", "backend", "--max-line-length=120",
                            "--exclude=backend/tests", check=False, timeout=1800)
    text = completed.stdout + completed.stderr
    context.log("flake8-full", text)
    found = {f"{relative(path)} {code}"
             for path, code in re.findall(r"^(.+?):\d+:\d+: ([A-Z]+\d+)", text, re.MULTILINE)}
    return ratchet(context, "flake8-full", found, "flake8 rule classes per file")


def type_check(context: Context) -> str:
    """mypy, which requirements-dev pins and the CI never calls."""
    completed = context.run(venv_python(), "-m", "mypy", "backend", "--ignore-missing-imports",
                            "--no-error-summary", check=False, timeout=2400)
    text = completed.stdout + completed.stderr
    context.log("mypy", text)
    found = set()
    for line in text.splitlines():
        match = re.match(r"^(.+?):\d+: error: .*?(\[[\w-]+\])?$", line)
        if match:
            found.add(f"{relative(match.group(1))} {match.group(2) or ''}".strip())
    return ratchet(context, "mypy", found, "type error classes per file")


def contrast(context: Context) -> str:
    """Text contrast against the design floor. The CI does not run it."""
    completed = yarn(context, "check:contrast", check=False, timeout=900)
    text = completed.stdout + completed.stderr
    context.log("frontend-contrast", text)
    found = {line.strip() for line in text.splitlines()
             if re.search(r"\b(fail|FAIL|below|insufficient)\b", line)}
    if completed.returncode != 0 and not found:
        raise StepFailed("the contrast check failed:\n" + tail(completed))
    return ratchet(context, "contrast", found, "colour combinations below the contrast floor")


def extra_steps() -> list:
    return [
        Step("extra", "formatting", "black and isort, installed but never run", formatting, ("backend/venv",)),
        Step("extra", "flake8-full", "All of flake8, not only the four blocking rules", full_lint,
             ("backend/venv",)),
        Step("extra", "mypy", "The type check the CI never runs", type_check, ("backend/venv",)),
        Step("extra", "contrast", "Text contrast meets the design floor", contrast, ("frontend/install",)),
        Step("extra", "shellcheck", "ShellCheck over every script", shellcheck),
        Step("extra", "osv", "Known vulnerabilities in the lockfiles", osv_scan),
    ]


# -------------------------------------------------------------------- wiring

def plan(groups: set) -> list:
    builders = {"repository": repository_steps, "backend": backend_steps, "frontend": frontend_steps,
                "mobile": mobile_steps, "container": container_steps, "extra": extra_steps}
    steps: list = []
    for group in GROUPS:
        if group in groups:
            steps += builders[group]()
    return steps


def build_context(record: bool = False) -> Context:
    return base_context(record)


def tear_down(context: Context) -> None:
    """Stop the local stack - only the local check's own project - then the rest."""
    if context.cache.pop("compose-up", False):
        try:
            compose(context, "down", "--volumes", "--remove-orphans", check=False, timeout=1200)
        except (StepFailed, StepSkipped):
            pass
    stop_everything(context)


if __name__ == "__main__":
    sys.exit(main())
