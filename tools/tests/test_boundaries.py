import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "boundaries", Path(__file__).resolve().parent.parent / "boundaries.py"
)
boundaries = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(boundaries)


def _module(root: Path, name: str, files: dict[str, str] | None = None) -> Path:
    d = root / "modules" / name
    d.mkdir(parents=True)
    for f in boundaries.REQUIRED_FILES:
        (d / f).write_text("x")
    for rel, text in (files or {}).items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return d


def test_clean_repo_passes(tmp_path):
    _module(tmp_path, "docket", {"src/d2_docket/a.py": "from d2_spec import x\nimport d2_docket\n"})
    _module(tmp_path, "companion", {"src/a.ts": "import { t } from '@democracy2/charter';\n"})
    assert boundaries.check(tmp_path) == []


def test_missing_licence_fails(tmp_path):
    d = _module(tmp_path, "docket")
    (d / "LICENSE").unlink()
    assert boundaries.check(tmp_path) == ["modules/docket: missing LICENSE"]


def test_python_cross_module_import_fails(tmp_path):
    _module(tmp_path, "commons", {"src/d2_commons/a.py": "from d2_provenance.grade import g\n"})
    [problem] = boundaries.check(tmp_path)
    assert "imports module 'provenance'" in problem


def test_typescript_cross_module_import_fails(tmp_path):
    _module(tmp_path, "companion", {"src/a.ts": "import { x } from '@democracy2/docket';\n"})
    [problem] = boundaries.check(tmp_path)
    assert "imports module 'docket'" in problem


def test_relative_escape_fails(tmp_path):
    _module(tmp_path, "agora", {"src/a.ts": "import x from '../../modules/door/src/x';\n"})
    [problem] = boundaries.check(tmp_path)
    assert "imports module 'door'" in problem


def test_node_modules_ignored(tmp_path):
    _module(tmp_path, "agora", {"node_modules/y/a.js": "require('@democracy2/door')\n"})
    assert boundaries.check(tmp_path) == []
