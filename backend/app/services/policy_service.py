"""Policy brief / evidence sheet PDF generation (ReportLab).

Numbers in tables come straight from the deterministic dataset and the
simulator. Gemini supplies narrative text only, after grounding checks.
English only: ReportLab does not shape Indic scripts (documented limitation).
"""
from __future__ import annotations

import datetime as dt
import io
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)
from xml.sax.saxutils import escape

INK = colors.HexColor("#000000")
ACCENT = colors.HexColor("#FF7A17")
ACCENT_LIGHT = colors.HexColor("#FFC285")
DIM = colors.HexColor("#7D8187")
RULE = colors.HexColor("#E4E5E9")
PAPER = colors.HexColor("#F0F0EE")

_FONTS_READY = False
SERIF, SANS, SANS_B, MONO = "Times-Roman", "Helvetica", "Helvetica-Bold", "Courier"


def _register_fonts(fonts_dir: Path) -> None:
    global _FONTS_READY, SERIF, SANS, SANS_B, MONO
    if _FONTS_READY:
        return
    try:
        pdfmetrics.registerFont(TTFont("InstrumentSerif", str(fonts_dir / "InstrumentSerif-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("Geist", str(fonts_dir / "Geist-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("Geist-SemiBold", str(fonts_dir / "Geist-SemiBold.ttf")))
        pdfmetrics.registerFont(TTFont("GeistMono", str(fonts_dir / "GeistMono-Regular.ttf")))
        SERIF, SANS, SANS_B, MONO = "InstrumentSerif", "Geist", "Geist-SemiBold", "GeistMono"
    except Exception:  # fonts missing: fall back to core PDF fonts
        pass
    _FONTS_READY = True


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "kicker": ParagraphStyle("kicker", fontName=MONO, fontSize=7.5, leading=10, textColor=INK, spaceAfter=2),
        "title": ParagraphStyle("title", fontName=SERIF, fontSize=30, leading=33, textColor=INK, spaceAfter=2),
        "sub": ParagraphStyle("sub", fontName=SANS, fontSize=11, leading=15, textColor=INK),
        "h2": ParagraphStyle("h2", fontName=MONO, fontSize=8, leading=11, textColor=INK, spaceBefore=12, spaceAfter=4),
        "body": ParagraphStyle("body", fontName=SANS, fontSize=9.5, leading=14, textColor=INK, alignment=TA_LEFT),
        "lead": ParagraphStyle("lead", fontName=SERIF, fontSize=14, leading=19, textColor=INK),
        "small": ParagraphStyle("small", fontName=SANS, fontSize=7.5, leading=10.5, textColor=INK),
        "cell": ParagraphStyle("cell", fontName=SANS, fontSize=8, leading=10.5, textColor=INK),
        "cellmono": ParagraphStyle("cellmono", fontName=MONO, fontSize=8, leading=10.5, textColor=INK),
        "fig": ParagraphStyle("fig", fontName=SERIF, fontSize=24, leading=26, textColor=INK),
        "figlabel": ParagraphStyle("figlabel", fontName=MONO, fontSize=6.5, leading=9, textColor=INK),
    }


def _p(text: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(str(text)), style)


def _fmt(x: float | None, nd: int = 1) -> str:
    return "—" if x is None else f"{x:,.{nd}f}"


def _fmt_pop(x: float | None) -> str:
    return "UNAVAILABLE" if not x else f"{x:,.0f}"


def build_pdf(*, fonts_dir: Path, district: dict[str, Any], evidence: dict[str, Any], sources: dict[str, Any],
              brief: dict[str, Any] | None, simulation: dict[str, Any] | None, interventions: list[dict[str, Any]],
              model_name: str | None, removed: list[str]) -> bytes:
    _register_fonts(fonts_dir)
    st = _styles()
    buf = io.BytesIO()
    generated = dt.datetime.now().strftime("%d %b %Y, %H:%M")
    kind = "POLICY BRIEF" if brief else "EVIDENCE SHEET"

    def on_page(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(ACCENT)
        canvas.rect(18 * mm, h - 14 * mm, 12 * mm, 1.2 * mm, stroke=0, fill=1)
        canvas.setFont(MONO, 6.5)
        canvas.setFillColor(INK)
        canvas.drawString(18 * mm, 10 * mm, f"UNHEARD · {kind} · {district['name'].upper()}, {district['state'].upper()} · GENERATED {generated.upper()}")
        canvas.drawRightString(w - 18 * mm, 10 * mm, f"PAGE {doc.page}")
        canvas.setFillColor(DIM)
        canvas.drawString(18 * mm, 6.5 * mm, "Citizen-signal baseline is SYNTHETIC DEMONSTRATION DATA. Simulated values are PROJECTED / MODELLED.")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
                            title=f"UNHEARD {kind.title()} — {district['name']}", author="UNHEARD prototype")
    story: list[Any] = []
    s = evidence["scores"]

    story.append(_p(f"UNHEARD / {kind}" + (f" / NARRATIVE BY {model_name.upper()} (GROUNDING-CHECKED)" if brief and model_name else " / DETERMINISTIC DATA ONLY"), st["kicker"]))
    story.append(_p(brief["title"] if brief else f"{district['name']}: evidence sheet", st["title"]))
    story.append(_p(f"{district['name']} district, {district['state']}", st["sub"]))
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=0.6, color=INK, spaceAfter=4 * mm))

    figs = [
        ("UNHEARD INDEX", _fmt(s["unheard_index"]), f"rank {s['unheard_rank']} of {s['ranked_districts']}"),
        ("NEED", _fmt(s["need"]), "public indicators, 0–100"),
        ("DEMAND", _fmt(s["demand_percentile"]), "signal-rate percentile (SYNTHETIC baseline)"),
        ("POPULATION", _fmt_pop(evidence["population_census_2011"]), "Census 2011"),
    ]
    fig_table = Table([[[_p(v, st["fig"]), _p(k, st["figlabel"]), _p(n, st["small"])] for k, v, n in figs]], colWidths=[43.5 * mm] * 4)
    fig_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEAFTER", (0, 0), (-2, -1), 0.4, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("BACKGROUND", (0, 0), (0, 0), ACCENT_LIGHT),
    ]))
    story.append(fig_table)
    story.append(Spacer(1, 4 * mm))

    def section(title: str, body: str | list[str] | None):
        if not body:
            return
        parts = [_p(title.upper(), st["h2"])]
        if isinstance(body, list):
            parts += [_p(f"— {b}", st["body"]) for b in body]
        else:
            parts.append(_p(body, st["body"]))
        story.append(KeepTogether(parts))

    if brief:
        story.append(_p(brief["executive_summary"], st["lead"]))
        section("Problem signal", brief["problem_signal"])
        section("Evidence", brief["evidence"])
        section("Affected population", brief["affected_population"])
        section("Current need", brief["current_need"])
        section("Observed demand", brief["observed_demand"])
        section("Why the area is unheard", brief["why_unheard"])
        section("Potential intervention", brief["potential_intervention"])
        section("Projected effect (PROJECTED / MODELLED)", brief["projected_effect"])
    else:
        story.append(_p("This sheet contains only deterministic figures from the UNHEARD dataset. No AI narrative was generated "
                        "(Gemini unavailable or not requested).", st["lead"]))

    # indicator evidence table
    story.append(_p("INDICATOR EVIDENCE", st["h2"]))
    rows = [[_p(h, st["cellmono"]) for h in ("CATEGORY", "INDICATOR", "VALUE", "DEFICIT", "SOURCE")]]
    for ind in evidence["indicators"]:
        rows.append([_p(ind["category"], st["cellmono"]), _p(ind["label"], st["cell"]), _p(f"{ind['value']}{ind['unit']}", st["cellmono"]),
                     _p(_fmt(ind["deficit_0_100"]), st["cellmono"]), _p(ind['source'] if ind['year'] in ind['source'] else f"{ind['source']} {ind['year']}", st["cell"])])
    rows.append([_p("roads", st["cellmono"]), _p("Road connectivity", st["cell"]), _p("N/A", st["cellmono"]), _p("—", st["cellmono"]), _p("UNAVAILABLE — not integrated", st["cell"])])
    t = Table(rows, colWidths=[27 * mm, 75 * mm, 24 * mm, 20 * mm, 28 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, INK), ("LINEBELOW", (0, 1), (-1, -1), 0.3, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)

    # signals
    sig = evidence["signals"]
    story.append(_p("OBSERVED CITIZEN SIGNALS", st["h2"]))
    story.append(_p(f"Synthetic baseline: {sig['synthetic_baseline_total']:,} signals (SYNTHETIC DEMONSTRATION SIGNAL). "
                    f"Captured in this app: {sum(sig['captured_in_app'].values())}. Rate: {_fmt(sig['rate_per_100k_total'])} per 100,000 population.", st["body"]))

    if interventions:
        story.append(_p("CANDIDATE INTERVENTIONS (RULE-BASED, HIGHEST CATEGORY DEFICIT FIRST)", st["h2"]))
        for iv in interventions:
            story.append(_p(f"— {iv['label']} ({iv['category']}; category deficit {iv['category_deficit']}/100)", st["body"]))

    if simulation:
        b, a, iv = simulation["before"], simulation["after"], simulation["intervention"]
        story.append(_p("WHAT IF? — PROJECTED / MODELLED", st["h2"]))
        story.append(_p(f"{iv['facilities']} × {iv['label']} (capacity {iv['capacity_per_facility']:,} people each; illustrative cost ₹{iv['investment_cr']} cr). "
                        f"People covered: {simulation['people_covered']:,.0f}.", st["body"]))
        srows = [[_p(h, st["cellmono"]) for h in ("METRIC", "CURRENT", "PROJECTED")]]
        for label, k, nd in (("Primary indicator (%)", "primary_value", 1), ("Category deficit", "category_deficit", 1), ("Need (category)", "need_category", 1),
                             ("Need (overall)", "need", 1), ("Unheard (category)", "unheard_category", 1), ("Unheard index", "unheard", 1),
                             ("People lacking service", "deficit_population", 0)):
            srows.append([_p(label, st["cell"]), _p(_fmt(b[k], nd), st["cellmono"]), _p(_fmt(a[k], nd), st["cellmono"])])
        stbl = Table(srows, colWidths=[80 * mm, 47 * mm, 47 * mm])
        stbl.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), 0.6, INK), ("LINEBELOW", (0, 1), (-1, -1), 0.3, RULE),
                                  ("BACKGROUND", (2, 1), (2, -1), PAPER)]))
        story.append(stbl)
        story.append(Spacer(1, 2 * mm))
        for asm in simulation["assumptions"]:
            story.append(_p(f"— {asm}", st["small"]))

    story.append(_p("DATA SOURCES", st["h2"]))
    for sid in ("nfhs5", "census2011", "boundaries", "synthetic_demand"):
        src = sources[sid]
        story.append(_p(f"{src['dataset']} — {src['publisher']} ({src['year']}). Licence: {src['license']}", st["small"]))

    lims = (brief or {}).get("limitations") or [
        "NFHS-5 (2019-21) and Census 2011 figures predate current conditions.",
        "Citizen-signal baseline is synthetic; demand scores demonstrate the method only.",
        "Scores are relative to other districts, not absolute thresholds.",
        "The index indicates where to look, not what is true on the ground; field verification is required.",
    ]
    section("Limitations", lims)
    if removed:
        section("Grounding check", [f"{len(removed)} generated statement(s) were removed because they cited figures not present in the evidence."])

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()
