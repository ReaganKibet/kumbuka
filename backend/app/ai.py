"""AI helpers: transcribe a session recording, turn notes into a DAP draft, write a pre-session brief,
draft referral letters, and write the narrative for a funder report.

Providers: Google Gemini (GEMINI_API_KEY) or Anthropic Claude (ANTHROPIC_API_KEY). Gemini also
transcribes audio; Claude does not take audio, so recording needs a Gemini key.

Design rules:
- AI only ever produces drafts. Nothing is saved until the counsellor reviews and saves it.
- No names or contact details are sent with text requests; the model only sees "the client".
- Callers check settings.ai_allowed_for(org) before sending client records. On a free Gemini key
  that is only true for the fictional demo organisation (see config.py).
- Without a key everything still works with simple non-AI fallbacks.
"""

import base64
import json
import logging
import re

import httpx

from .config import settings

log = logging.getLogger("kumbuka.ai")


class AIError(Exception):
    """A provider call failed. The message is safe to show to the counsellor."""


NOTE_SYSTEM = """You are a clinical documentation assistant for a counsellor. You turn the counsellor's \
spoken or typed rough notes, or a transcript of the session, into a concise, professional DAP note.

Rules:
- Use ONLY information present in the input. Never invent details, quotes, history, \
diagnoses, scores or plans. If a section has no information, return an empty string for it.
- Write in professional third person ("Client reported...", "Counsellor observed..."). Refer to the \
person only as "Client"; never use names, even if the input contains them.
- data: what the client reported and what the counsellor observed (mood, affect, presentation).
- assessment: the counsellor's own interpretation of progress, themes and response to the session, \
as stated or clearly implied. Do not add your own clinical judgement.
- plan: next steps, next session focus, referrals, as stated.
- interventions: techniques or approaches the counsellor used in this session.
- homework: anything the client agreed to do before the next session.
- risk_indicators: list every mention of suicidal thoughts, self-harm, harm to others, abuse or \
safeguarding concerns, or a substance-use crisis, each as a short factual phrase. Include risk that \
was explicitly denied too (e.g. "Client denied suicidal ideation"). Empty list if none mentioned.
- Keep each section brief: plain sentences, no headings or bullet symbols. A full-session \
transcript should still become a short note: summarise, don't transcribe.
- Use British English spelling (counselling, behaviour, programme)."""

NOTE_FIELDS = ["data", "assessment", "plan", "interventions", "homework", "risk_indicators"]
NOTE_SCHEMA = {
    "type": "object",
    "properties": {
        "data": {"type": "string"},
        "assessment": {"type": "string"},
        "plan": {"type": "string"},
        "interventions": {"type": "string"},
        "homework": {"type": "string"},
        "risk_indicators": {"type": "array", "items": {"type": "string"}},
    },
    "required": NOTE_FIELDS,
}

BRIEF_SYSTEM = """You prepare a short pre-session brief for a counsellor about one of their clients, \
using only the records provided. Write 3 to 6 short sentences of plain prose, no headings or bullets. \
Cover: the main themes being worked on, what happened last session and the agreed homework, how \
questionnaire scores are trending (if any), and anything the counsellor should check on today, \
especially any risk notes or flags. Never invent information or add clinical advice beyond the \
records. Refer to the person as "the client". Use British English spelling."""

LETTER_SYSTEM = """You draft the body of a referral letter from a counsellor to another professional, \
using only the records provided. Write 2 to 4 short paragraphs of plain prose: who is being referred \
and why, the presenting concern and a brief, factual summary of the work so far, and any current risk \
the receiving professional needs to know about. Refer to the person only as "[Client]" (exactly that, \
with the brackets). Do not include a salutation, closing or signature. Never invent details, diagnoses \
or scores. Keep it professional and share only what is relevant to the referral. Use British English."""

TRANSCRIBE_SYSTEM = """You transcribe recordings of counselling sessions and counsellors' voice notes \
for the counsellor's own records. Recordings may mix English with Kiswahili, Sheng or other African \
languages.

Rules:
- Write what was said, in the language it was said. Do not translate, summarise or add anything.
- If two or more people speak, start each turn on a new line with "Counsellor:" or "Client:" (or \
"Speaker 3:" and so on for others, such as a parent). If only one person speaks, give plain text \
with no labels.
- Replace people's names with [name], phone numbers with [phone] and exact home addresses or \
school names with [place]. Keep everything else.
- Mark unclear audio as [inaudible]. Leave out filler sounds (um, er).
- If there is no speech, reply with exactly: [no speech detected]"""

NARRATIVE_SYSTEM = """You write the narrative section of a donor or funder report for an African \
counselling or psychosocial support programme, using ONLY the anonymised figures provided as JSON.

Write 3 short paragraphs of plain, confident prose suitable to paste into a grant report:
1. Reach: how many people were served, how (one-to-one and groups), and who (gender, age, location \
or programme), for the period given.
2. Outcomes: what share of people with a first and follow-up questionnaire showed reliable \
improvement or recovery, naming each measure (PHQ-9 for depression, GAD-7 for anxiety, WHO-5 for \
wellbeing). Mention how many people the percentage is based on.
3. Safeguarding, referrals and quality: referral completion, safeguarding activity and how promptly \
notes were documented and supervised.

Rules: use exact numbers from the data and never calculate new statistics, estimate, or invent \
figures, names, stories or quotes. Values shown as "<5" mean fewer than five people; write "fewer \
than five". If a figure is missing, zero or null, leave that point out rather than guessing. Do not \
claim the programme caused the change: write "showed improvement", not "improved because of". No \
headings, bullet points or markdown. British English spelling."""

# Used only when AI is off, so risky content in a dictation is never silently missed.
_RISK_PATTERNS = [
    r"suicid\w*", r"kill (?:my|him|her|them)sel(?:f|ves)", r"end (?:my|his|her|their) life",
    r"self[- ]?harm\w*", r"hurt(?:ing)? (?:my|him|her|them)sel(?:f|ves)", r"cutting",
    r"overdos\w*", r"better off dead", r"abus\w*", r"violen\w*", r"hit(?:s|ting)? (?:me|him|her|them)",
    r"weapon", r"want(?:s|ed)? to die", r"kujiua", r"nataka kufa",
]

MAX_AUDIO_BYTES = 18 * 1024 * 1024  # Gemini's inline request limit is 20 MB in total
AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/mpeg", "audio/mp3",
               "audio/wav", "audio/x-wav", "audio/aac", "audio/flac", "audio/opus"}


def _keyword_risks(text: str) -> list[str]:
    hits = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text):
        if any(re.search(p, sentence, re.IGNORECASE) for p in _RISK_PATTERNS):
            hits.append(sentence.strip()[:200])
    return hits


# ---------------------------------------------------------------- providers

def _gemini_schema(s: dict) -> dict:
    """JSON-schema subset -> Gemini's OpenAPI-style schema (upper-case types)."""
    out: dict = {"type": s["type"].upper()}
    if "properties" in s:
        out["properties"] = {k: _gemini_schema(v) for k, v in s["properties"].items()}
        out["propertyOrdering"] = list(s["properties"])
    if "items" in s:
        out["items"] = _gemini_schema(s["items"])
    if "required" in s:
        out["required"] = s["required"]
    return out


# Clinical notes discuss self-harm and abuse as a matter of course; default filters would block them.
_GEMINI_SAFETY = [
    {"category": c, "threshold": "BLOCK_NONE"}
    for c in ("HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
              "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT")
]


def _gemini(system: str, text: str, *, max_tokens: int, schema: dict | None = None,
            audio: tuple[bytes, str] | None = None, timeout: float = 120) -> str:
    parts: list[dict] = []
    if audio:
        data, mime = audio
        parts.append({"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}})
    parts.append({"text": text})
    config: dict = {"maxOutputTokens": max_tokens, "temperature": 0.2}
    if schema:
        config |= {"responseMimeType": "application/json", "responseSchema": _gemini_schema(schema)}
    url = f"{settings.gemini_base_url}/v1beta/models/{settings.gemini_model}:generateContent"
    try:
        r = httpx.post(
            url,
            headers={"x-goog-api-key": settings.gemini_api_key},
            json={
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": config,
                "safetySettings": _GEMINI_SAFETY,
            },
            timeout=timeout,
        )
    except httpx.TimeoutException:
        raise AIError("Gemini took too long to answer. Try again, or use a shorter recording.")
    except httpx.HTTPError as exc:
        raise AIError(f"Couldn't reach Gemini ({type(exc).__name__}).")
    if r.status_code != 200:
        try:
            detail = r.json().get("error", {}).get("message", "")
        except ValueError:
            detail = r.text[:200]
        log.warning("Gemini %s: %s", r.status_code, detail[:500])
        if r.status_code == 429:
            raise AIError("The Gemini key has reached its usage limit for now. Try again later.")
        if r.status_code in (401, 403) or "API key" in detail:
            raise AIError("Gemini rejected the API key. Check GEMINI_API_KEY on the server.")
        if r.status_code == 404:
            raise AIError(f"Gemini doesn't recognise the model '{settings.gemini_model}'. Check GEMINI_MODEL.")
        raise AIError(f"Gemini returned an error ({r.status_code}).")
    body = r.json()
    cands = body.get("candidates") or []
    if not cands:
        reason = (body.get("promptFeedback") or {}).get("blockReason", "no answer")
        raise AIError(f"Gemini declined this request ({reason}).")
    out = "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []) if not p.get("thought"))
    if not out.strip():
        raise AIError(f"Gemini returned an empty answer ({cands[0].get('finishReason', 'unknown')}).")
    return out.strip()


def _anthropic(system: str, text: str, *, max_tokens: int, schema: dict | None = None) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        if schema:
            tool = {"name": "record", "description": "Record the structured result.", "input_schema": schema}
            resp = client.messages.create(
                model=settings.anthropic_model, max_tokens=max_tokens, system=system, tools=[tool],
                tool_choice={"type": "tool", "name": "record"}, messages=[{"role": "user", "content": text}],
            )
            return json.dumps(next(b for b in resp.content if b.type == "tool_use").input)
        resp = client.messages.create(
            model=settings.anthropic_model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": text}],
        )
        return "".join(b.text for b in resp.content if b.type == "text").strip()
    except anthropic.APIError as exc:
        raise AIError(f"Claude returned an error ({type(exc).__name__}).")


def _generate(system: str, text: str, *, max_tokens: int, schema: dict | None = None) -> str:
    if settings.ai_provider == "gemini":
        return _gemini(system, text, max_tokens=max_tokens, schema=schema)
    if settings.ai_provider == "anthropic":
        return _anthropic(system, text, max_tokens=max_tokens, schema=schema)
    raise AIError("AI is not configured.")


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    return json.loads(raw)


# ---------------------------------------------------------------- features

def draft_note(dictation: str, allowed: bool = True) -> dict:
    fallback = {
        "data": dictation.strip(), "assessment": "", "plan": "", "interventions": "", "homework": "",
        "risk_indicators": _keyword_risks(dictation), "ai_used": False,
    }
    if not settings.ai_enabled or not allowed:
        why = ("AI is not set up on this server" if not settings.ai_enabled
               else "AI is limited to the demo organisation on this server's free AI plan")
        return fallback | {"message": f"{why}, so your notes were copied into Data. "
                                      "Possible risk mentions were found with a keyword check."}
    try:
        out = _parse_json(_generate(NOTE_SYSTEM, f"Counsellor's notes or session transcript:\n\n{dictation}",
                                    max_tokens=4000, schema=NOTE_SCHEMA))
        out = {k: out.get(k) or ([] if k == "risk_indicators" else "") for k in NOTE_FIELDS}
        # Belt and braces: never let the keyword check find something the model dropped.
        if not out["risk_indicators"]:
            out["risk_indicators"] = [f"Possible mention, please check: {r}" for r in _keyword_risks(dictation)]
        return out | {"ai_used": True, "message": None}
    except (AIError, ValueError, KeyError, StopIteration) as exc:
        log.warning("AI draft failed: %s", exc)
        msg = str(exc) if isinstance(exc, AIError) else "The AI answer couldn't be read."
        return fallback | {"message": f"{msg} Your notes were copied into Data instead."}


def write_brief(context: str, allowed: bool = True) -> tuple[str | None, str | None]:
    """Returns (summary, message). summary is None when AI is unavailable."""
    if not settings.ai_enabled:
        return None, "AI summary is off on this server. The facts below are still up to date."
    if not allowed:
        return None, "AI summaries are limited to the demo organisation on this server's free AI plan."
    try:
        return _generate(BRIEF_SYSTEM, context, max_tokens=1200) or None, None
    except AIError as exc:
        return None, f"{exc} The facts below are still up to date."


def draft_letter(context: str) -> tuple[str | None, str | None]:
    """Returns (letter body, message). Body is None when AI is unavailable."""
    try:
        return _generate(LETTER_SYSTEM, context, max_tokens=1500) or None, None
    except AIError as exc:
        return None, f"{exc} This is the standard template instead."


def can_transcribe() -> bool:
    return settings.ai_provider == "gemini"


def transcribe(audio: bytes, mime: str) -> str:
    """Raises AIError on failure. Audio is held in memory only for this call and never stored."""
    if not can_transcribe():
        raise AIError("Transcription needs a Gemini API key on the server.")
    mime = mime.split(";")[0].strip().lower()
    if mime == "video/webm":  # some browsers label audio-only recordings this way
        mime = "audio/webm"
    if mime not in AUDIO_TYPES:
        raise AIError("That audio format isn't supported. Use WebM, Ogg, M4A, MP3 or WAV.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise AIError("The recording is too large (over 18 MB). Split it, or record at a lower quality.")
    if len(audio) < 2000:
        raise AIError("The recording is empty or too short.")
    return _gemini(TRANSCRIBE_SYSTEM, "Transcribe this recording.", max_tokens=32000,
                   audio=(audio, mime), timeout=300)


def report_narrative(figures: dict) -> str:
    """Raises AIError. `figures` is the already anonymised, small-cell-suppressed report."""
    if not settings.ai_enabled:
        raise AIError("AI is not set up on this server.")
    return _generate(NARRATIVE_SYSTEM, json.dumps(figures, default=str, indent=1), max_tokens=2500)
