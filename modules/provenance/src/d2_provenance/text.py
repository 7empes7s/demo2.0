"""Language-light text handling: normalisation, dates, numbers and content words.

Everything here is deterministic and stdlib only. Records are mostly French (Luxembourg), claims
may come in fr, de, en, pt or lb; dates and numbers are read in all five, content words are
compared in the record's language.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

MONTHS = {
    # fr
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7,
    "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
    # en
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
    "oct": 10, "nov": 11, "dec": 12,
    # de and lb
    "januar": 1, "februar": 2, "marz": 3, "maerz": 3, "juni": 6, "juli": 7, "oktober": 10,
    "dezember": 12, "abrell": 4, "mee": 5,
    # pt
    "janeiro": 1, "fevereiro": 2, "marco": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7,
    "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
}  # fmt: skip

_MONTH = "|".join(sorted(MONTHS, key=len, reverse=True))
DATE_PATTERNS = (
    # 2026-05-15
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), ("y", "m", "d")),
    # 15/05/2026, 15.05.2026
    (re.compile(r"\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b"), ("d", "m", "y")),
    # 15 mai 2026, 1er juin 2026, 15. Mai 2026, 15 de maio de 2026
    (
        re.compile(rf"\b(\d{{1,2}})(?:er|\.)?\s+(?:de\s+)?({_MONTH})\.?\s+(?:de\s+)?(\d{{4}})\b"),
        ("d", "mon", "y"),
    ),
    # May 15, 2026 / May 15th 2026
    (
        re.compile(rf"\b({_MONTH})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b"),
        ("mon", "d", "y"),
    ),
)

NEGATIONS = frozenset(
    "ne n pas not no never nicht kein keine keinen nie jamais aucun aucune sans without nao "
    "nunca nee net keng".split()
)

STOPWORDS = frozenset(
    """
    le la les un une des du de d l au aux et ou en dans sur par pour avec ce cet cette ces qui que
    quoi dont est sont ete etre a ont avait sera son sa ses leur leurs il elle ils elles se s y
    qu plus ne pas lui eux on nous vous
    the a an of to in on at by for with from and or is are was were be been has have had it its
    this that these those as which who
    der die das den dem des ein eine einen einem einer und oder ist sind war wurde wurden im am
    zu mit von fur auf aus bei als
    o os as um uma de do da dos das em no na nos nas e ou foi sao com por para
    an de den d dei der vun mat fir op ass
    """.split()
)

OPINION_WORDS = frozenset(
    """
    should shouldn ought devrait devraient faudrait sollte sollten musste deveria deveriam
    good bad better worse best worst fair unfair bon bonne mauvais mauvaise meilleur pire juste
    injuste gut schlecht besser schlechter gerecht ungerecht bom boa mau melhor pior
    scandal scandale skandal escandalo honte shame disgrace trop too excessive excessif
    """.split()
)


def fold(text: str) -> str:
    """Lowercase, strip accents, unify quotes, join PDF hyphenation, collapse spaces."""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    text = text.replace("’", "'").replace("‘", "'").replace(" ", " ")
    text = text.replace(" ", " ")
    text = "".join(
        c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", text).strip()


def find_dates(folded: str) -> list[tuple[str, int, int]]:
    """ISO dates (YYYY-MM-DD) in folded text, with their spans. Impossible dates are dropped."""
    found: list[tuple[str, int, int]] = []
    taken: list[tuple[int, int]] = []
    for pattern, order in DATE_PATTERNS:
        for m in pattern.finditer(folded):
            if any(m.start() < e and s < m.end() for s, e in taken):
                continue
            parts = dict(zip(order, m.groups(), strict=True))
            month = MONTHS[parts["mon"]] if "mon" in parts else int(parts["m"])
            day, year = int(parts["d"]), int(parts["y"])
            if not (1 <= month <= 12 and 1 <= day <= 31):
                continue
            found.append((f"{year:04d}-{month:02d}-{day:02d}", m.start(), m.end()))
            taken.append((m.start(), m.end()))
    return sorted(found, key=lambda x: x[1])


@dataclass(frozen=True)
class Number:
    value: str  # canonical: "5000", "12.5"
    unit: str  # the next content word (or the previous one at the end of a sentence)


_NUM = re.compile(r"(?<![\w/])\d+(?:[., ]\d+)*(?![\w/])")
_REF = re.compile(r"\b\d+(?:/\d+)+\b")


def _canon(groups: list[str], seps: list[str]) -> list[str]:
    """Split one digit run into numbers: '5.000' -> 5000, '12,5' -> 12.5, '2026 2027' -> two."""
    out: list[str] = []
    i = 0
    while i < len(groups):
        whole, frac = groups[i], ""
        thousands = len(groups[i]) <= 3
        i += 1
        while i < len(groups):
            sep, g = seps[i - 1], groups[i]
            if thousands and len(g) == 3 and not frac:
                whole += g
            elif sep in ".," and not frac and len(g) != 3:
                frac = g
            else:
                break
            i += 1
        value = whole.lstrip("0") or "0"
        frac = frac.rstrip("0")
        out.append(f"{value}.{frac}" if frac else value)
    return out


WORD = re.compile(r"[a-z]+|%")


def stem(word: str) -> str:
    return word[:6]


def numbers(folded: str) -> list[Number]:
    """Numbers outside dates and references (8752/01), each with the word it counts."""
    blanked = folded
    for _, s, e in find_dates(folded):
        blanked = blanked[:s] + " " * (e - s) + blanked[e:]
    blanked = _REF.sub(lambda m: " " * len(m.group()), blanked)
    out: list[Number] = []
    for m in _NUM.finditer(blanked):
        raw = m.group()
        groups = re.split(r"[., ]", raw)
        seps = re.findall(r"[., ]", raw)
        values = _canon(groups, seps)
        after = [w for w in WORD.findall(blanked[m.end() : m.end() + 40]) if w not in STOPWORDS]
        before = [w for w in WORD.findall(blanked[max(0, m.start() - 40) : m.start()])]
        before = [w for w in before if w not in STOPWORDS]
        unit = stem(after[0]) if after else (stem(before[-1]) if before else "")
        out.extend(Number(v, unit) for v in values)
    return out


def words(folded: str) -> list[str]:
    """Content words, stemmed. Dates and numbers are not words."""
    return [stem(w) for w in WORD.findall(folded) if len(w) >= 3 and w not in STOPWORDS]


def references(folded: str) -> set[str]:
    return set(_REF.findall(folded))


def has_negation(folded: str) -> bool:
    return any(w in NEGATIONS for w in re.findall(r"[a-z]+", folded))


def is_opinion(folded: str) -> bool:
    return any(w in OPINION_WORDS for w in re.findall(r"[a-z]+", folded))


def sentences(text: str) -> list[str]:
    """Split record text into sentences (also on blank lines and ' ; ' lists)."""
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    parts = re.split(r"(?<=[.!?;])\s+(?=[A-ZÀ-Ý0-9«\"(])|\n\s*\n", text)
    return [re.sub(r"\s+", " ", p).strip() for p in parts if p and p.strip()]
