"""The `match` checker: grade a claim by what the records literally say.

Rules, in order (README has the full table):
1. An opinion (should, unfair, too ...) is never graded green or red.
2. Structured facts: a deposit date or a council vote tally stated in the claim is compared
   with the record. Same value: green. Different value: red.
3. Record text (only when rule 2 did not apply): a record sentence that carries every content
   word of the claim (one may be missing per ten)
   - and every number and date in the claim, with the same negation: green;
   - and the same counted thing with a different number or date, none matching: red.
4. Anything else is yellow, shown with the closest record sentences.
A claim no record mentions gets no grade (`NoRecord`): a grade must rest on a record.
Green and red from different rules on the same claim make it yellow (the records disagree).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from .corpus import Corpus, Item, Sentence, dmy
from .text import (
    find_dates,
    fold,
    has_negation,
    is_opinion,
    numbers,
    references,
    words,
)

CHECKER_ID = "d2-provenance-match"
METHOD_VERSION = "match/1"
SLACK = 10  # for green or red, a sentence may miss one claim content word per 10
MIN_WORDS = 3  # fewer content words than this and text alone never grades green or red
RELATED = 0.34  # share of content words a sentence needs to be shown as yellow evidence
MAX_EVIDENCE = 3
MAX_CLAIM_CHARS = 2000

DEPOSIT = re.compile(r"\b(depos\w*|filed|submitted|eingereicht\w*|hinterleg\w*|apresentad\w*)\b")
BILL_WORDS = re.compile(
    r"\b(loi|dossier|bill|projet|proposition|gesetz\w*|projeto|proposta|debat|debate|motion)\b"
)
FOUR_DIGITS = re.compile(r"(?<![\d/.,-])\b(\d{4})\b(?![/.,-]?\d)")
_VOTES = r"(?:voix|votes?|stemmen?|stimmen|votos)"
TALLY = re.compile(rf"\b(\d+)\s*{_VOTES}?\s*(?:contre|to|against|gegen|geint|contra|a)\s*(\d+)\b")
_FOR = r"(?:pour(?! cent)|oui|yes|in favou?r|dafur|fir|ja|jo|sim|a favor|favoraveis)"
YES = re.compile(rf"\b(\d+)\s*{_VOTES}?\s*{_FOR}\b")
NO = re.compile(
    rf"\b(\d+)\s*{_VOTES}?\s*(?:contre|non|no|against|dagegen|dogeint|nein|nee|nao|contra)\b"
)
REJECTED = re.compile(r"\b(rejet\w*|rejected|refus\w*|abgelehnt|ofgeleent|rejeitad\w*)\b")
UNANIMOUS = re.compile(r"\b(unanim\w*|einstimmig\w*|eestemmeg\w*)\b")
YES_KEYS = ("oui", "yes", "ja", "jo", "sim", "pour")
NO_KEYS = ("non", "no", "nein", "nee", "nao", "contre")


class NoRecord(Exception):
    """No record mentions the claim, so there is nothing to grade it against."""


@dataclass
class Verdict:
    grade: str  # green, yellow or red
    evidence: list[dict]
    reasons: list[str] = field(default_factory=list)


def claim_id(text: str, context: str | None) -> str:
    digest = hashlib.sha256(f"{text}\x00{context or ''}".encode()).hexdigest()
    return f"claim-{digest[:16]}"


def _evidence(s: Sentence) -> dict:
    return {
        "url": s.url,
        "source_document_id": s.source_document_id,
        "excerpt": s.text,
        "locator": s.locator,
    }


def _fact_evidence(item: Item, excerpt: str, locator: str) -> dict:
    return {"url": item.url, "source_document_id": None, "excerpt": excerpt, "locator": locator}


class Grader:
    def __init__(self, corpus: Corpus):
        self.corpus = corpus
        self.model_version = f"{METHOD_VERSION}+docket:{corpus.sha256[:12]}"
        self._folded: dict[Sentence, tuple[str, set[str]]] = {}
        for item in corpus.items.values():
            for s in item.sentences:
                f = fold(s.text)
                self._folded[s] = (f, set(words(f)))
        self._by_number = {
            i.number: i for i in corpus.items.values() if i.id.startswith("lu.chd.") and i.number
        }

    # -- which records a claim is about ---------------------------------------------------

    def _items_for(self, claim: str, context: str | None) -> tuple[list[Item], Item | None]:
        """Items to search, and the one item the claim is clearly about (if any)."""
        if context and context in self.corpus.items:
            item = self.corpus.items[context]
            return [item], item
        named = [self._by_number[n] for n in FOUR_DIGITS.findall(claim) if n in self._by_number]
        if len(named) == 1 and BILL_WORDS.search(claim):
            return named, named[0]
        return list(self.corpus.items.values()), None

    # -- rule 2: structured facts ---------------------------------------------------------

    def _deposit(self, claim: str, item: Item) -> Verdict | None:
        dates = {d for d, _, _ in find_dates(claim)}
        if not item.deposited or not item.url or len(dates) != 1 or not DEPOSIT.search(claim):
            return None
        said = next(iter(dates))
        ev = _fact_evidence(item, f"{dmy(item.deposited)} Déposé", f"history, {item.deposited}")
        if said == item.deposited:
            return Verdict("green", [ev], ["deposit date matches the record"])
        return Verdict("red", [ev], [f"record says deposited {item.deposited}, claim {said}"])

    def _votes(self, claim: str, item: Item) -> Verdict | None:
        if not item.votes or not item.url:
            return None
        counts = {k.lower(): v for k, v in item.votes.items()}
        yes = sum(counts.get(k, 0) for k in YES_KEYS)
        no = sum(counts.get(k, 0) for k in NO_KEYS)
        other = sum(counts.values()) - yes - no
        excerpt = ", ".join(f"{k} : {v}" for k, v in sorted(item.votes.items()) if k)
        ev = _fact_evidence(item, excerpt, f"council vote, point {item.number or item.id}")
        said_yes = said_no = None
        rest = claim
        if m := TALLY.search(rest):
            a, b = int(m.group(1)), int(m.group(2))
            said_yes, said_no = (b, a) if REJECTED.search(claim) else (a, b)
            rest = rest[: m.start()] + rest[m.end() :]
        if m := YES.search(rest):
            said_yes = int(m.group(1))
        if m := NO.search(rest):
            said_no = int(m.group(1))
        if UNANIMOUS.search(claim):
            if no > 0 or (said_no is not None and said_no != no):
                return Verdict("red", [ev], [f"record shows {no} votes against"])
            if other == 0 and yes > 0:
                return Verdict("green", [ev], ["record shows no vote against and no abstention"])
            return None
        if said_yes is None and said_no is None:
            return None
        wrong = (said_yes is not None and said_yes != yes) or (
            said_no is not None and said_no != no
        )
        if wrong:
            return Verdict("red", [ev], [f"record tally is {yes} for, {no} against"])
        return Verdict("green", [ev], ["vote tally matches the record"])

    # -- rule 3: record text --------------------------------------------------------------

    def _text(
        self, claim: str, items: list[Item], ignore: set[str]
    ) -> tuple[Verdict | None, list[Sentence]]:
        claim_words = set(words(claim))
        claim_nums = {(n.value, n.unit) for n in numbers(claim) if n.value not in ignore}
        claim_dates = {d for d, _, _ in find_dates(claim)}
        claim_refs = references(claim)
        claim_neg = has_negation(claim)
        if not claim_words:
            return None, []
        scored: list[tuple[float, int, Sentence]] = []
        for item in items:
            for s in item.sentences:
                f, sw = self._folded[s]
                cover = len(claim_words & sw) / len(claim_words)
                if cover >= RELATED:
                    scored.append((cover, -len(s.text), s))
        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
        related = [s for _, _, s in scored]
        if len(claim_words) < MIN_WORDS:
            return None, related
        need = 1 - (len(claim_words) // SLACK) / len(claim_words)
        greens, reds = [], []
        for cover, _, s in scored:
            if cover < need:
                break
            f, _ = self._folded[s]
            if has_negation(f) != claim_neg or not claim_refs <= references(f):
                continue
            s_nums = {(n.value, n.unit) for n in numbers(f)}
            s_values = {v for v, _ in s_nums}
            s_dates = {d for d, _, _ in find_dates(f)}
            if claim_nums <= s_nums and claim_dates <= s_dates:
                greens.append(s)
                continue
            num_conflict = any(
                v not in s_values and any(u and u == su and v != sv for sv, su in s_nums)
                for v, u in claim_nums
            )
            date_conflict = bool(claim_dates) and bool(s_dates) and not (claim_dates & s_dates)
            if num_conflict or date_conflict:
                reds.append(s)
        if greens and not reds:
            ev = [_evidence(s) for s in greens[:MAX_EVIDENCE]]
            return Verdict("green", ev, ["a record sentence states the claim"]), related
        if reds and not greens:
            ev = [_evidence(s) for s in reds[:MAX_EVIDENCE]]
            return Verdict("red", ev, ["a record sentence gives another number or date"]), related
        if reds and greens:
            ev = [_evidence(s) for s in (greens[:1] + reds[:1])]
            return Verdict("yellow", ev, ["record sentences disagree"]), related
        return None, related

    # -- putting it together --------------------------------------------------------------

    def verdict(self, text: str, context: str | None = None) -> Verdict:
        if not text or not text.strip():
            raise ValueError("claim text is empty")
        if len(text) > MAX_CLAIM_CHARS:
            raise ValueError(f"claim text is longer than {MAX_CLAIM_CHARS} characters")
        claim = fold(text)
        items, item = self._items_for(claim, context)
        # the dossier's own number ("projet de loi 8752") is not a figure the record must repeat
        ignore = {n.value for n in numbers(fold(item.number))} if item and item.number else set()
        text_verdict, related = self._text(claim, items, ignore)
        verdicts: list[Verdict] = []
        if item and not has_negation(claim):
            verdicts += [v for v in (self._deposit(claim, item), self._votes(claim, item)) if v]
        if text_verdict and not verdicts:  # a structured fact is more specific than wording
            verdicts.append(text_verdict)
        if is_opinion(claim):
            ev = [e for v in verdicts for e in v.evidence] or [_evidence(s) for s in related]
            if not ev and item and item.sentences:
                ev = [_evidence(item.sentences[0])]
            if not ev:
                raise NoRecord(text)
            return Verdict("yellow", _dedupe(ev), ["a matter of opinion, not of record"])
        grades = {v.grade for v in verdicts}
        ev = _dedupe([e for v in verdicts for e in v.evidence])
        reasons = [r for v in verdicts for r in v.reasons]
        if ("green" in grades and "red" in grades) or "yellow" in grades:
            return Verdict("yellow", ev, reasons + ["the records disagree"])
        if grades == {"red"}:
            return Verdict("red", ev, reasons)
        if grades == {"green"}:
            return Verdict("green", ev, reasons)
        ev = [_evidence(s) for s in related[:MAX_EVIDENCE]]
        if not ev and item and item.url and item.sentences:
            ev = [_evidence(item.sentences[0])]
        if not ev:
            raise NoRecord(text)
        return Verdict("yellow", ev, ["the records neither confirm nor contradict the claim"])

    def grade(self, text: str, context: str | None = None) -> dict:
        """A `Grade` as in spec/schemas/grade.schema.json."""
        v = self.verdict(text, context)
        return {
            "claim_id": claim_id(text, context),
            "checker_id": CHECKER_ID,
            "grade": v.grade,
            "evidence": v.evidence,
            "model_version": self.model_version,
        }

    def checker(self) -> dict:
        return {
            "checker_id": CHECKER_ID,
            "model_version": self.model_version,
            "method": "Literal match against Docket records: deposit dates, council vote "
            "tallies and record sentences. No language model.",
            "corpus": {
                "sha256": self.corpus.sha256,
                "items": len(self.corpus.items),
                "sentences": self.corpus.sentence_count,
            },
        }


def _dedupe(evidence: list[dict]) -> list[dict]:
    seen, out = set(), []
    for e in evidence:
        key = (e["url"], e["excerpt"])
        if key not in seen:
            seen.add(key)
            out.append(e)
    return out[: MAX_EVIDENCE + 2]
