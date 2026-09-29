"""Grounding checks for generated text.

Gemini is instructed to use only numbers present in the evidence packet.
We verify that mechanically: every number in a generated sentence must
match a number in the evidence (within rounding). Sentences that cite a
figure we cannot find are removed and reported — never shown silently.
"""
from __future__ import annotations

import html
import re
from typing import Any, Iterable

_NUM = re.compile(r"(?<![A-Za-z])(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)")
_SENT = re.compile(r"(?<=[.!?।])\s+")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def collect_numbers(obj: Any, out: set[float] | None = None) -> set[float]:
    out = set() if out is None else out
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)):
        out.add(float(obj))
    elif isinstance(obj, str):
        for m in _NUM.finditer(obj):
            out.add(float(m.group(1).replace(",", "")))
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            collect_numbers(v, out)
    return out


def _allowed(n: float, allowed: set[float]) -> bool:
    if n <= 10 and float(n).is_integer():
        return True  # small counts / ordinals ("three categories", "top 5")
    if 1900 <= n <= 2100 and float(n).is_integer():
        return True  # years
    for a in allowed:
        if abs(a - n) <= 0.051 or (a != 0 and abs(a - n) / abs(a) < 0.006):
            return True
        # evidence 1234567 may be written as "12.3 lakh" / "1.2 million"
        for scale in (1e5, 1e6, 1e7):
            if abs(a / scale - n) < 0.051:
                return True
        # percentage shares written as percentages of 1.0
        if abs(a * 100 - n) <= 0.051:
            return True
    return False


def unverified_numbers(text: str, allowed: set[float]) -> list[str]:
    bad = []
    for m in _NUM.finditer(text):
        n = float(m.group(1).replace(",", ""))
        if not _allowed(n, allowed):
            bad.append(m.group(1))
    return bad


def clean_text(text: str) -> str:
    """Plain text only: strip control chars, markdown emphasis, HTML."""
    t = _CTRL.sub("", text)
    t = re.sub(r"<[^>]{0,200}>", "", t)
    t = t.replace("**", "").replace("__", "").replace("`", "")
    return html.unescape(t).strip()


def ground_text(text: str, allowed: set[float], removed: list[str]) -> str:
    kept = []
    for sent in _SENT.split(clean_text(text)):
        if not sent:
            continue
        bad = unverified_numbers(sent, allowed)
        if bad:
            removed.append(f"{sent} [unverified: {', '.join(bad)}]")
        else:
            kept.append(sent)
    return " ".join(kept)


def ground_list(items: Iterable[str], allowed: set[float], removed: list[str]) -> list[str]:
    out = []
    for it in items:
        g = ground_text(it, allowed, removed)
        if g:
            out.append(g)
    return out
