"""Lint of the systemd units in ops/deploy: hardening every civic unit shares, and the backup job.

`systemd-analyze verify` also runs when the machine has it (CI's Ubuntu runner does).
"""

import shutil
import subprocess
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[2] / "ops" / "deploy"


def _unit(path: Path) -> dict[str, dict[str, list[str]]]:
    """Section -> key -> values (systemd allows a key more than once)."""
    out: dict[str, dict[str, list[str]]] = {}
    section = None
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = out.setdefault(line[1:-1], {})
            continue
        assert section is not None, f"{path.name}: key outside a section: {line}"
        assert "=" in line, f"{path.name}: not a key=value line: {line}"
        key, value = line.split("=", 1)
        section.setdefault(key.strip(), []).append(value.strip())
    return out


def test_every_service_is_hardened():
    services = sorted(DEPLOY.glob("civic-*.service"))
    assert services
    for path in services:
        svc = _unit(path)["Service"]
        assert svc["User"] == ["civic"], path.name
        assert svc["NoNewPrivileges"] == ["true"], path.name
        assert svc["ProtectSystem"] == ["strict"], path.name
        assert svc["PrivateTmp"] == ["true"], path.name


def test_every_timer_has_its_service():
    for path in DEPLOY.glob("*.timer"):
        assert path.with_suffix(".service").exists(), path.name
        timer = _unit(path)["Timer"]
        assert timer.get("OnCalendar"), path.name
        assert timer.get("Persistent") == ["true"], path.name


def test_backup_unit():
    unit = _unit(DEPLOY / "civic-backup.service")
    svc = unit["Service"]
    assert svc["Type"] == ["oneshot"]
    assert svc["UMask"] == ["0077"]
    writable = " ".join(svc["ReadWritePaths"]).split()
    assert sorted(writable) == ["/var/backups/civic", "/var/lib/civic-agora", "/var/lib/civic-desk"]
    assert svc["ReadOnlyPaths"] == ["/opt/civic"]
    (start,) = svc["ExecStart"]
    assert "modules/desk/src/backup.ts" in start
    for arg in (
        "--out /var/backups/civic",
        "--keep-days 7",
        "--desk /var/lib/civic-desk/desk.db",
        "--agora /var/lib/civic-agora/agora.db",
    ):
        assert arg in start
    # The Desk and Agora units write these exact paths.
    assert "DESK_DB=/var/lib/civic-desk/desk.db" in (DEPLOY / "civic-desk.service").read_text()
    assert "--db /var/lib/civic-agora/agora.db" in (DEPLOY / "civic-agora.service").read_text()
    (pre,) = svc["ExecStartPre"]
    assert pre.startswith("+") and "-m 0700 -o civic -g civic /var/backups/civic" in pre
    timer = _unit(DEPLOY / "civic-backup.timer")
    assert timer["Install"]["WantedBy"] == ["timers.target"]


def test_systemd_analyze_verify():
    exe = shutil.which("systemd-analyze")
    if exe is None:  # not every dev machine has systemd; the lint tests above still run
        return
    units = [str(DEPLOY / "civic-backup.service"), str(DEPLOY / "civic-backup.timer")]
    result = subprocess.run(
        [exe, "verify", "--man=no", *units], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    # verify reports unknown keys and bad values as warnings and still exits 0.
    warnings = [line for line in result.stderr.splitlines() if "civic-backup" in line]
    assert warnings == [], result.stderr
