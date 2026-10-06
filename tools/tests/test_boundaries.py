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
    _module(tmp_path, "agora", {"src/a.ts": "import x from '../../door/src/x';\n"})
    [problem] = boundaries.check(tmp_path)
    assert "imports module 'door'" in problem


def test_relative_escape_to_apps_fails(tmp_path):
    _module(tmp_path, "agora", {"src/a.tsx": "import x from '../../../apps/citizen/x';\n"})
    [problem] = boundaries.check(tmp_path)
    assert "imports module 'apps'" in problem


def test_relative_import_to_spec_and_inside_module_pass(tmp_path):
    _module(
        tmp_path,
        "agora",
        {
            "src/a.ts": "import s from '../../../spec/x';\n"
            "import b from './b';\nimport c from '../c';\n"
        },
    )
    assert boundaries.check(tmp_path) == []


def test_tsx_cross_module_import_fails(tmp_path):
    _module(tmp_path, "agora", {"src/a.tsx": "import y from '@democracy2/door';\n"})
    [problem] = boundaries.check(tmp_path)
    assert "imports module 'door'" in problem


def test_checkout_under_build_dir_still_checked(tmp_path):
    root = tmp_path / "build" / "repo"
    _module(root, "agora", {"src/a.ts": "import y from '@democracy2/door';\n"})
    assert len(boundaries.check(root)) == 1


def test_node_modules_ignored(tmp_path):
    _module(tmp_path, "agora", {"node_modules/y/a.js": "require('@democracy2/door')\n"})
    assert boundaries.check(tmp_path) == []


def test_rust_cross_module_use_fails(tmp_path):
    _module(tmp_path, "door", {"src/lib.rs": "use d2_record::log::Entry;\n"})
    [problem] = boundaries.check(tmp_path)
    assert "imports module 'record'" in problem


def test_rust_own_crate_and_shared_pass(tmp_path):
    _module(
        tmp_path,
        "door",
        {
            "src/lib.rs": "use d2_door::x;\nlet y = d2_charter::tier();\nextern crate d2_spec;\n",
            "Cargo.toml": '[dependencies]\nd2-charter = { path = "../../charter/rust" }\n',
        },
    )
    assert boundaries.check(tmp_path) == []


def test_rust_cargo_path_dependency_on_module_fails(tmp_path):
    _module(
        tmp_path,
        "door",
        {"Cargo.toml": '[dependencies]\nd2-record = { version = "0.1", path = "../record" }\n'},
    )
    [problem] = boundaries.check(tmp_path)
    assert "path dependency on 'record'" in problem


def test_rust_target_dir_ignored(tmp_path):
    _module(tmp_path, "door", {"target/debug/build/x.rs": "use d2_record::x;\n"})
    assert boundaries.check(tmp_path) == []
