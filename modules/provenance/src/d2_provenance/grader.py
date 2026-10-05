"""The `match` checker: grade a claim by what the records literally say.

Rules, in order (README has the full table):
1. An opinion (should, unfair, too ...) or a word mixing alphabets is never graded green or red.
2. Structured facts: a deposit date or a council vote tally (and outcome) stated in the claim is
   compared with the record. Different value or outcome: red. Same value: green only when
   everything else the claim says is in that record too; otherwise yellow.
3. Record text (only when rule 2 did not apply): a record sentence with the same negation and the
   same comparisons ("more than", "less than") that carries
   - every content word, number and date of the claim: green;
   - every content word (one may be missing per ten) and, for a counted thing, only other
     numbers (none of the claim's matches) or another date: red.
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
    comparators,
    find_dates,
    fold,
    has_negation,
    is_opinion,
    mixed_scripts,
    numbers,
    references,
    words,
)

CHECKER_ID = "d2-provenance-match"
METHOD_VERSION = "match/2"
SLACK = 10  # for red only, a sentence may miss one claim content word per 10
MIN_WORDS = 3  # fewer content words than this and text alone never grades green or red
RELATED = 0.34  # share of content words a sentence needs to be shown as yellow evidence
MAX_EVIDENCE = 3
MAX_CLAIM_CHARS = 2000
NEAR = 16  # characters allowed between a deposit verb and its date

A = re.ASCII
DEPOSIT = re.compile(r"\b(depos\w*|filed|submitted|eingereicht\w*|hinterleg\w*|apresentad\w*)\b", A)
# a deposit verb whose subject is another document: "l'avis ... a été déposé"
OTHER_DOCUMENT = re.compile(
    r"\b(avis|rapports?|amendements?|amendments?|opinions?|reports?|gutachten|stellungnahme\w*"
    r"|parecer\w*|relatorio\w*|questions?|petitions?|motions?)\b",
    A,
)
FUTURE = re.compile(
    r"\b(sera|seront|serait|seraient|va|vont|pourrait|pourraient|will|would|could|might|shall"
    r"|wird|werden|konnte|vai|vao|ira|irao|gett)\b",
    A,
)
BILL_WORDS = re.compile(
    r"\b(loi|dossier|bill|projet|proposition|gesetz\w*|projeto|proposta|debat|debate|motion)\b", A
)
FOUR_DIGITS = re.compile(r"(?<![\d/.,-])\b(\d{4})\b(?![/.,-]?\d)", A)
# "projet de loi 9999", "débat d'orientation 8821", "bill no. 8752": a dossier named explicitly
DOSSIER_REF = re.compile(
    r"\b(?:loi|lei|bill|dossier|projet|projeto|proposition|proposta|gesetz\w*|debat|debate"
    r"|motion|orientation|nr|no|n|numero|number)\s*[.°o]?\s*(\d{4})\b(?![/.,-]?\d)",
    A,
)
_VOTES = r"(?:voix|votes?|stemmen?|stimmen|votos)"
_N = r"(\d{1,3})"  # a vote count; years and other long numbers are not tallies
_SEP = r"(?:contre|to|against|gegen|geint|contra|a)"
TALLY = re.compile(
    rf"\b{_N}\s*{_VOTES}\s*{_SEP}\s*{_N}(?:\s*{_VOTES})?\b(?![.,]?\d)"
    rf"|\b{_N}\s*{_SEP}\s*{_N}\s*{_VOTES}\b",
    A,
)
_STRONG_FOR = r"(?:oui|yes|in favou?r|dafur|ja|jo|sim|a favor|favoraveis)"
_FOR = rf"(?:pour(?! cent)|fir|{_STRONG_FOR})"
_STRONG_AGAINST = r"(?:non|dagegen|dogeint|nein|nee|nao)"
_AGAINST = rf"(?:contre|no|against|contra|{_STRONG_AGAINST})"
YES = re.compile(rf"\b{_N}\s*(?:{_VOTES}\s*{_FOR}|{_STRONG_FOR})\b", A)
NO = re.compile(rf"\b{_N}\s*(?:{_VOTES}\s*{_AGAINST}|{_STRONG_AGAINST})\b", A)
NO_AFTER_YES = re.compile(rf"\b{_N}\s*{_AGAINST}\b", A)  # "11 voix pour, 8 contre"
ABSTAIN = re.compile(
    rf"\b{_N}\s*(?:{_VOTES}\s*)?(?:abstentions?|abstencoes|abstencao|enthaltung\w*"
    r"|abstentioun\w*)",
    A,
)
ADOPTED = re.compile(
    r"\b(approuv\w*|adopt\w*|approved|passed|accepted|carried|angenommen|ugeholl\w*"
    r"|aprovad\w*)\b",
    A,
)
REJECTED = re.compile(
    r"\b(rejet\w*|rejected|refus\w*|defeated|failed|lost|voted down|turned down|abgelehnt"
    r"|verworfen|ofgeleent|rejeitad\w*|chumbad\w*)\b",
    A,
)
UNANIMOUS = re.compile(r"\b(unanim\w*|einstimmig\w*|eestemmeg\w*)\b", A)
YES_KEYS = ("oui", "yes", "ja", "jo", "sim", "pour")
NO_KEYS = ("non", "no", "nein", "nee", "nao", "contre")

# words that only say which kind of fact the claim states; any other word must be in the record
DEPOSIT_FRAME = frozenset(
    words(
        "loi lei bill dossier gesetz gesetzesprojet gesetzentwurf chambre chamber kammer "
        "depose deposee deposes filed submitted eingereicht hinterlegt apresentado apresentada"
    )
)
VOTE_FRAME = frozenset(
    words(
        "conseil communal council gemengerot gemeinderat camara municipal vote voted votes "
        "voix stemmen stimmen votos point item plan majorite majority maioria recueilli obtenu "
        "received approuve approuvee approved adopte adoptee adopted passed accepted carried "
        "angenommen ugeholl aprovado aprovada rejete rejetee rejected refuse refusee defeated "
        "failed lost turned down abgelehnt verworfen ofgeleent rejeitado rejeitada chumbado "
        "unanimite unanimously unanimous unanime einstimmig eestemmeg unanimidade "
        "huet mat fir dogeint dagegen"
    )
)


class UnknownContext(ValueError):
    """The `context` names no item of the corpus."""


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
        """Items to search, and the one item the claim is clearly about (if any).

        A dossier the claim names explicitly wins over `context`: a claim is graded against
        what it says, never against an item the caller guessed.
        """
        blanked = claim
        for _, s, e in find_dates(claim):
            blanked = blanked[:s] + " " * (e - s) + blanked[e:]
        explicit = set(DOSSIER_REF.findall(blanked))
        named = list(dict.fromkeys(n for n in FOUR_DIGITS.findall(blanked) if n in self._by_number))
        if context is not None:
            if context not in self.corpus.items:
                raise UnknownContext(f"unknown context {context!r}: no such record")
            item = self.corpus.items[context]
            claimed = explicit | (set(named) if BILL_WORDS.search(claim) else set())
            if not (claimed - {item.number}):
                return [item], item
        if len(named) == 1 and BILL_WORDS.search(claim) and explicit <= set(named):
            return [self._by_number[named[0]]], self._by_number[named[0]]
        return list(self.corpus.items.values()), None

    # -- rule 2: structured facts ---------------------------------------------------------

    def _rest_is_on_record(
        self, claim: str, spans: list[tuple[int, int]], item: Item, frame: frozenset[str]
    ) -> bool:
        """After removing the matched fact, is everything else the claim says in the item?

        Every remaining content word must be in the item's sentences or only say which kind of
        fact this is ("loi", "déposé"; "voix", "conseil"). No other number or date may remain.
        """
        rest = claim
        for s, e in spans:
            rest = rest[:s] + " " * (e - s) + rest[e:]
        if find_dates(rest):
            return False
        own = {n.value for n in numbers(fold(item.number))} if item.number else set()
        if any(n.value not in own for n in numbers(rest)):
            return False
        on_record = set().union(*(self._folded[s][1] for s in item.sentences))
        return set(words(rest)) <= on_record | frame

    def _deposit(self, claim: str, item: Item) -> Verdict | None:
        dates = find_dates(claim)
        if not item.deposited or not item.url or len(dates) != 1 or FUTURE.search(claim):
            return None
        said, ds, de = dates[0]
        verbs = [
            m for m in DEPOSIT.finditer(claim) if m.start() - de <= NEAR and ds - m.end() <= NEAR
        ]  # the deposit verb next to the date: "déposé le 15 mai 2026", "am ... eingereicht"
        if len(verbs) != 1 or OTHER_DOCUMENT.search(claim[: verbs[0].start()]):
            return None  # not the dossier's own deposit ("l'avis ... a été déposé le ...")
        ev = _fact_evidence(item, f"{dmy(item.deposited)} Déposé", f"history, {item.deposited}")
        if said != item.deposited:
            return Verdict("red", [ev], [f"record says deposited {item.deposited}, claim {said}"])
        if self._rest_is_on_record(claim, [(ds, de), verbs[0].span()], item, DEPOSIT_FRAME):
            return Verdict("green", [ev], ["deposit date matches the record"])
        return Verdict(
            "yellow", [ev], ["deposit date matches, but the record does not state the rest"]
        )

    def _votes(self, claim: str, item: Item) -> Verdict | None:
        if not item.votes or not item.url or FUTURE.search(claim):
            return None
        counts = {k.lower(): v for k, v in item.votes.items()}
        yes = sum(counts.get(k, 0) for k in YES_KEYS)
        no = sum(counts.get(k, 0) for k in NO_KEYS)
        other = sum(counts.values()) - yes - no
        excerpt = ", ".join(f"{k} : {v}" for k, v in sorted(item.votes.items()) if k)
        ev = _fact_evidence(item, excerpt, f"council vote, point {item.number or item.id}")
        red = Verdict("red", [ev], [f"record tally is {yes} for, {no} against"])
        adopted, rejected = bool(ADOPTED.search(claim)), bool(REJECTED.search(claim))
        said_outcome = "adopted" if adopted and not rejected else None
        said_outcome = "rejected" if rejected and not adopted else said_outcome
        outcome = "adopted" if yes > no else "rejected" if no > yes else None
        spans: list[tuple[int, int]] = []
        ok = True  # the claim's figures agree with the record, read one way only
        if m := TALLY.search(claim):
            a, b = (int(x) for x in m.groups() if x is not None)
            spans.append(m.span())
            if sorted((a, b)) != sorted((yes, no)):
                return red
            if said_outcome == "adopted" or said_outcome is None:
                ok = (a, b) == (yes, no)  # "adopted 8 to 11" or "8 voix contre 11": unclear
        else:
            said_yes = said_no = None
            if m := YES.search(claim):
                said_yes = int(m.group(1))
                spans.append(m.span())
            if m := (NO.search(claim) or (said_yes is not None and NO_AFTER_YES.search(claim))):
                said_no = int(m.group(1))
                spans.append(m.span())
            if (said_yes is not None and said_yes != yes) or (
                said_no is not None and said_no != no
            ):
                return red
        if m := ABSTAIN.search(claim):
            spans.append(m.span())
            if int(m.group(1)) != other:
                if other == 0:
                    return Verdict("red", [ev], ["record shows no abstention"])
                ok = False
        if UNANIMOUS.search(claim):
            if no > 0:
                return Verdict("red", [ev], [f"record shows {no} votes against"])
            ok = ok and other == 0 and yes > 0
            spans.append(UNANIMOUS.search(claim).span())
        elif not spans:
            return None
        if said_outcome and outcome and said_outcome != outcome:
            return Verdict("red", [ev], [f"record shows the point {outcome}, {yes} to {no}"])
        if adopted and rejected:
            ok = False  # "refused to adopt": the outcome is not read
        if ok and outcome and self._rest_is_on_record(claim, spans, item, VOTE_FRAME):
            return Verdict("green", [ev], ["vote tally matches the record"])
        return Verdict(
            "yellow", [ev], ["vote figures match, but the record does not state the rest"]
        )

    # -- rule 3: record text --------------------------------------------------------------

    def _text(
        self, claim: str, items: list[Item], ignore: set[str]
    ) -> tuple[Verdict | None, list[Sentence]]:
        claim_words = set(words(claim))
        claim_nums = {(n.value, n.unit) for n in numbers(claim) if n.value not in ignore}
        claim_dates = {d for d, _, _ in find_dates(claim)}
        claim_refs = references(claim)
        claim_neg = has_negation(claim)
        claim_cmp = comparators(claim)
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
        need_red = 1 - (len(claim_words) // SLACK) / len(claim_words)
        greens, reds = [], []
        for cover, _, s in scored:
            if cover < need_red:
                break
            f, _ = self._folded[s]
            if has_negation(f) != claim_neg or not claim_refs <= references(f):
                continue
            if comparators(f) != claim_cmp:
                continue  # "plus de 5.000" is not "moins de 5.000"
            s_nums = {(n.value, n.unit) for n in numbers(f)}
            s_dates = {d for d, _, _ in find_dates(f)}
            if cover == 1 and claim_nums <= s_nums and claim_dates <= s_dates:
                greens.append(s)
                continue
            # a counted thing the sentence gives only other numbers for, none of the claim's
            units = {u for _, u in claim_nums if u}
            num_conflict = any(
                {v for v, cu in claim_nums if cu == u}.isdisjoint(
                    sv for sv, su in s_nums if su == u
                )
                and any(su == u for _, su in s_nums)
                for u in units
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
        unsure = None
        if is_opinion(claim):
            unsure = "a matter of opinion, not of record"
        elif mixed_scripts(text):
            unsure = "a word mixes alphabets, so it cannot be compared with the record"
        if unsure:
            ev = [e for v in verdicts for e in v.evidence] or [_evidence(s) for s in related]
            if not ev and item and item.sentences:
                ev = [_evidence(item.sentences[0])]
            if not ev:
                raise NoRecord(text)
            return Verdict("yellow", _dedupe(ev), [unsure])
        grades = {v.grade for v in verdicts}
        ev = _dedupe([e for v in verdicts for e in v.evidence])
        reasons = [r for v in verdicts for r in v.reasons]
        if "green" in grades and "red" in grades:
            return Verdict("yellow", ev, reasons + ["the records disagree"])
        if "yellow" in grades:
            return Verdict("yellow", ev, reasons)
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
