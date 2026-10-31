"""AI helpers: turn dictation into a DAP draft, and write a pre-session brief.

Design rules:
- AI only ever produces drafts. Nothing is saved until the counsellor reviews and saves it.
- No names or contact details are sent to the model; it only sees "the client".
- Without an API key everything still works with simple non-AI fallbacks.
"""

import logging
import re

from .config import settings

log = logging.getLogger("kumbuka.ai")

NOTE_SYSTEM = """You are a clinical documentation assistant for a counsellor. You turn the counsellor's \
spoken or typed rough notes from a counselling session into a concise, professional DAP note.

Rules:
- Use ONLY information present in the counsellor's notes. Never invent details, quotes, history, \
diagnoses, scores or plans. If a section has no information, return an empty string for it.
- Write in professional third person ("Client reported...", "Counsellor observed..."). Refer to the \
person only as "Client"; never use names.
- data: what the client reported and what the counsellor observed (mood, affect, presentation).
- assessment: the counsellor's own interpretation of progress, themes and response to the session, \
as stated or clearly implied in the notes. Do not add your own clinical judgement.
- plan: next steps, next session focus, referrals, as stated.
- interventions: techniques or approaches the counsellor used in this session.
- homework: anything the client agreed to do before the next session.
- risk_indicators: list every mention of suicidal thoughts, self-harm, harm to others, abuse or \
safeguarding concerns, or a substance-use crisis, each as a short factual phrase. Include risk that \
was explicitly denied too (e.g. "Client denied suicidal ideation"). Empty list if none mentioned.
- Keep each section brief: plain sentences, no headings or bullet symbols.
- Use British English spelling (counselling, behaviour, programme)."""

NOTE_TOOL = {
    "name": "record_dap_note",
    "description": "Record the structured DAP session note drafted from the counsellor's notes.",
    "input_schema": {
        "type": "object",
        "properties": {
            "data": {"type": "string"},
            "assessment": {"type": "string"},
            "plan": {"type": "string"},
            "interventions": {"type": "string"},
            "homework": {"type": "string"},
            "risk_indicators": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["data", "assessment", "plan", "interventions", "homework", "risk_indicators"],
    },
}

BRIEF_SYSTEM = """You prepare a short pre-session brief for a counsellor about one of their clients, \
using only the records provided. Write 3 to 6 short sentences of plain prose, no headings or bullets. \
Cover: the main themes being worked on, what happened last session and the agreed homework, how \
questionnaire scores are trending (if any), and anything the counsellor should check on today, \
especially any risk notes or flags. Never invent information or add clinical advice beyond the \
records. Refer to the person as "the client"."""

LETTER_SYSTEM = """You draft the body of a referral letter from a counsellor to another professional, \
using only the records provided. Write 2 to 4 short paragraphs of plain prose: who is being referred \
and why, the presenting concern and a brief, factual summary of the work so far, and any current risk \
the receiving professional needs to know about. Refer to the person only as "[Client]" (exactly that, \
with the brackets). Do not include a salutation, closing or signature. Never invent details, diagnoses \
or scores. Keep it professional and share only what is relevant to the referral."""

# Used only when AI is off, so risky content in a dictation is never silently missed.
_RISK_PATTERNS = [
    r"suicid\w*", r"kill (?:my|him|her|them)sel(?:f|ves)", r"end (?:my|his|her|their) life",
    r"self[- ]?harm\w*", r"hurt(?:ing)? (?:my|him|her|them)sel(?:f|ves)", r"cutting",
    r"overdos\w*", r"better off dead", r"abus\w*", r"violen\w*", r"hit(?:s|ting)? (?:me|him|her|them)",
    r"weapon", r"want(?:s|ed)? to die",
]


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _keyword_risks(text: str) -> list[str]:
    hits = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text):
        if any(re.search(p, sentence, re.IGNORECASE) for p in _RISK_PATTERNS):
            hits.append(sentence.strip()[:200])
    return hits


def draft_note(dictation: str) -> dict:
    if not settings.ai_enabled:
        return {
            "data": dictation.strip(),
            "assessment": "",
            "plan": "",
            "interventions": "",
            "homework": "",
            "risk_indicators": _keyword_risks(dictation),
            "ai_used": False,
            "message": "AI is not configured (no ANTHROPIC_API_KEY), so your notes were copied into Data. "
            "Possible risk mentions were found with a keyword check.",
        }
    try:
        resp = _client().messages.create(
            model=settings.anthropic_model,
            max_tokens=1500,
            system=NOTE_SYSTEM,
            tools=[NOTE_TOOL],
            tool_choice={"type": "tool", "name": NOTE_TOOL["name"]},
            messages=[{"role": "user", "content": f"Counsellor's notes from today's session:\n\n{dictation}"}],
        )
        block = next(b for b in resp.content if b.type == "tool_use")
        out = {k: block.input.get(k, "" if k != "risk_indicators" else []) for k in NOTE_TOOL["input_schema"]["required"]}
        # Belt and braces: never let the keyword check find something the model dropped.
        if not out["risk_indicators"]:
            out["risk_indicators"] = [f"Possible mention, please check: {r}" for r in _keyword_risks(dictation)]
        return out | {"ai_used": True, "message": None}
    except Exception as exc:  # network, auth, model errors
        log.exception("AI draft failed")
        return {
            "data": dictation.strip(),
            "assessment": "",
            "plan": "",
            "interventions": "",
            "homework": "",
            "risk_indicators": _keyword_risks(dictation),
            "ai_used": False,
            "message": f"AI drafting failed ({type(exc).__name__}). Your notes were copied into Data instead.",
        }


def write_brief(context: str) -> tuple[str | None, str | None]:
    """Returns (summary, message). summary is None when AI is unavailable."""
    if not settings.ai_enabled:
        return None, "AI summary is off (no ANTHROPIC_API_KEY). The facts below are still up to date."
    try:
        resp = _client().messages.create(
            model=settings.anthropic_model,
            max_tokens=600,
            system=BRIEF_SYSTEM,
            messages=[{"role": "user", "content": context}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return text or None, None
    except Exception as exc:
        log.exception("AI brief failed")
        return None, f"AI summary failed ({type(exc).__name__}). The facts below are still up to date."


def draft_letter(context: str) -> tuple[str | None, str | None]:
    """Returns (letter body, message). Body is None when AI is unavailable."""
    try:
        resp = _client().messages.create(
            model=settings.anthropic_model,
            max_tokens=900,
            system=LETTER_SYSTEM,
            messages=[{"role": "user", "content": context}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return text or None, None
    except Exception as exc:
        log.exception("AI letter failed")
        return None, f"AI drafting failed ({type(exc).__name__}), so this is the standard template."
