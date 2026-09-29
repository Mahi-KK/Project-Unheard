"""Name normalisation + matching helpers shared by the dataset build.

District names differ across NFHS-5, Census 2011 and the boundary file
(spelling, transliteration, renamed districts). Matching is deterministic:
exact normalised match within state, then manual overrides, then a strict
fuzzy match (difflib ratio >= 0.86) within the same state. Anything left
unmatched is reported and marked insufficient — never guessed silently.
"""
from __future__ import annotations

import difflib
import re
import unicodedata

STATE_ALIASES = {
    "andaman nicobar islands": "andaman and nicobar",
    "andaman and nicobar islands": "andaman and nicobar",
    "dadra nagar haveli daman diu": "dnh and dd",
    "dadra and nagar haveli": "dnh and dd",
    "daman and diu": "dnh and dd",
    "jammu kashmir": "jammu and kashmir",
    "nct delhi": "delhi",
    "nct of delhi": "delhi",
    "orissa": "odisha",
    "pondicherry": "puducherry",
}

_REPLACEMENTS = [
    (r"\bdistrict\b", ""),
    (r"\bdist\b", ""),
    (r"&", " and "),
    (r"\bnorth\b", "n"),
    (r"\bsouth\b", "s"),
    (r"\beast\b", "e"),
    (r"\bwest\b", "w"),
    (r"\bcentral\b", "c"),
    (r"\bgarh\b", "garh"),
]


def norm_state(name: str) -> str:
    s = _basic(name)
    return STATE_ALIASES.get(s, s)


def _basic(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_district(name: str) -> str:
    s = _basic(name)
    for pat, rep in _REPLACEMENTS:
        s = re.sub(pat, rep, s)
    s = s.replace(" ", "")
    # common transliteration variants
    for a, b in (("aa", "a"), ("ee", "i"), ("oo", "u"), ("w", "v"), ("sh", "s"), ("th", "t"), ("dh", "d"), ("bh", "b"), ("kh", "k"), ("gh", "g"), ("ph", "p"), ("y", "i")):
        s = s.replace(a, b)
    return s


def best_fuzzy(target: str, candidates: dict[str, str], cutoff: float = 0.86) -> str | None:
    """candidates: normalised -> key. Returns key of best unique match or None."""
    hits = difflib.get_close_matches(target, list(candidates), n=2, cutoff=cutoff)
    if not hits:
        return None
    if len(hits) == 2 and difflib.SequenceMatcher(None, target, hits[0]).ratio() == difflib.SequenceMatcher(None, target, hits[1]).ratio():
        return None  # ambiguous: refuse to guess
    return candidates[hits[0]]
