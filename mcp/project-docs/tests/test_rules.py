import pytest

from rules import MAX_BYTES, RuleError, check_content, check_path, check_prefix


@pytest.mark.parametrize(
    "path",
    [
        "p-7f3k2b9c4d/notes.md",
        "p-7f3k2b9c4d/ontology/perma-core.ttl",
        "p-7f3k2b9c4d/a_b.c-d/x.SPARQL",
        "p-7f3k2b9c4d/data.yaml",
    ],
)
def test_good_paths(path):
    assert check_path(path) == path


@pytest.mark.parametrize(
    "path",
    [
        "",
        "notes.md",  # no space
        "/p-7f3k2b9c4d/notes.md",
        "p-7f3k2b9c4d/../other/notes.md",
        "p-7f3k2b9c4d/./notes.md",
        "p-7f3k2b9c4d//notes.md",
        "p-7f3k2b9c4d/notes.md/",
        "p-7f3k2b9c4d/no tes.md",
        "p-7f3k2b9c4d/notes\\x.md",
        "p-7f3k2b9c4d/ümlaut.md",
        "p-7f3k2b9c4d/image.png",
        "p-7f3k2b9c4d/archive.tgz",
        "p-7f3k2b9c4d/noextension",
        "p-7f3k2b9c4d/" + "a" * 510 + ".md",
    ],
)
def test_bad_paths(path):
    with pytest.raises(RuleError):
        check_path(path)


def test_prefixes():
    assert check_prefix(None) == ""
    assert check_prefix("p-7f3k2b9c4d/") == "p-7f3k2b9c4d/"
    assert check_prefix("p-7f") == "p-7f"
    for bad in ("/p", "p/../q", "p//q", "p q"):
        with pytest.raises(RuleError):
            check_prefix(bad)


def test_size_counts_bytes_not_characters():
    assert len(check_content("a" * MAX_BYTES)) == MAX_BYTES
    with pytest.raises(RuleError):
        check_content("a" * (MAX_BYTES + 1))
    # Two bytes per character in UTF-8: half as many characters fit.
    with pytest.raises(RuleError):
        check_content("é" * (MAX_BYTES // 2 + 1))
