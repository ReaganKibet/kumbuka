"""Standardized questionnaires and their scoring rules.

PHQ-9 and GAD-7 were developed by Drs. Spitzer, Williams, Kroenke and colleagues with an
educational grant from Pfizer; no permission is required to reproduce, translate, display
or distribute them. The WHO-5 Well-Being Index is free to use (Psychiatric Research Unit,
Mental Health Centre North Zealand).

Each measure declares how to tell "improvement" for funder reports:
- improve_by: change in total that counts as reliable improvement
- cutoff: the clinical threshold; "recovered" means crossing it in the healthy direction
"""

FREQUENCY_OPTIONS = [
    {"value": 0, "label": "Not at all"},
    {"value": 1, "label": "Several days"},
    {"value": 2, "label": "More than half the days"},
    {"value": 3, "label": "Nearly every day"},
]

MEASURES: dict[str, dict] = {
    "PHQ-9": {
        "kind": "PHQ-9",
        "title": "PHQ-9 (Depression)",
        "prompt": "Over the last 2 weeks, how often has the client been bothered by any of the following problems?",
        "items": [
            "Little interest or pleasure in doing things",
            "Feeling down, depressed, or hopeless",
            "Trouble falling or staying asleep, or sleeping too much",
            "Feeling tired or having little energy",
            "Poor appetite or overeating",
            "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
            "Trouble concentrating on things, such as reading the newspaper or watching television",
            "Moving or speaking so slowly that other people could have noticed, or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
            "Thoughts that you would be better off dead, or of hurting yourself in some way",
        ],
        "options": FREQUENCY_OPTIONS,
        "max": 27,
        "higher_is_better": False,
        "improve_by": 5,
        "cutoff": 10,
        "bands": [(4, "Minimal"), (9, "Mild"), (14, "Moderate"), (19, "Moderately severe"), (27, "Severe")],
    },
    "GAD-7": {
        "kind": "GAD-7",
        "title": "GAD-7 (Anxiety)",
        "prompt": "Over the last 2 weeks, how often has the client been bothered by the following problems?",
        "items": [
            "Feeling nervous, anxious, or on edge",
            "Not being able to stop or control worrying",
            "Worrying too much about different things",
            "Trouble relaxing",
            "Being so restless that it is hard to sit still",
            "Becoming easily annoyed or irritable",
            "Feeling afraid, as if something awful might happen",
        ],
        "options": FREQUENCY_OPTIONS,
        "max": 21,
        "higher_is_better": False,
        "improve_by": 4,
        "cutoff": 10,
        "bands": [(4, "Minimal"), (9, "Mild"), (14, "Moderate"), (21, "Severe")],
    },
    "WHO-5": {
        "kind": "WHO-5",
        "title": "WHO-5 (Wellbeing)",
        "prompt": "Over the last two weeks, how much of the time has the client felt the following?",
        "items": [
            "I have felt cheerful and in good spirits",
            "I have felt calm and relaxed",
            "I have felt active and vigorous",
            "I woke up feeling fresh and rested",
            "My daily life has been filled with things that interest me",
        ],
        "options": [
            {"value": 0, "label": "At no time"},
            {"value": 1, "label": "Some of the time"},
            {"value": 2, "label": "Less than half of the time"},
            {"value": 3, "label": "More than half of the time"},
            {"value": 4, "label": "Most of the time"},
            {"value": 5, "label": "All of the time"},
        ],
        "multiplier": 4,  # raw 0-25 is reported as a 0-100 percentage score
        "max": 100,
        "higher_is_better": True,
        "improve_by": 10,
        "cutoff": 50,
        "bands": [(28, "Low (screen for depression)"), (50, "Poor wellbeing"), (100, "Good wellbeing")],
    },
}


class MeasureError(ValueError):
    pass


def score(kind: str, answers: list[int]) -> dict:
    measure = MEASURES.get(kind)
    if measure is None:
        raise MeasureError(f"Unknown measure '{kind}'. Available: {', '.join(MEASURES)}")
    n = len(measure["items"])
    if len(answers) != n:
        raise MeasureError(f"{kind} needs exactly {n} answers, got {len(answers)}")
    top = max(o["value"] for o in measure["options"])
    if any((not isinstance(a, int)) or a < 0 or a > top for a in answers):
        raise MeasureError(f"Each answer must be a whole number from 0 to {top}")

    total = sum(answers) * measure.get("multiplier", 1)
    severity = next(label for upper, label in measure["bands"] if total <= upper)

    flags: list[str] = []
    if kind == "PHQ-9" and answers[8] > 0:
        flags.append("Item 9 endorsed (thoughts of death or self-harm). Review risk with the client today.")
    if kind == "PHQ-9" and total >= 20:
        flags.append("Severe range. Consider whether a referral or closer follow-up is needed.")
    if kind == "GAD-7" and total >= 15:
        flags.append("Severe range. Consider whether a referral or closer follow-up is needed.")
    if kind == "WHO-5" and total <= 28:
        flags.append("Very low wellbeing. Screen for depression (e.g. PHQ-9).")

    return {"total": total, "severity": severity, "flags": flags}


def public_definitions() -> list[dict]:
    return [
        {k: v for k, v in m.items() if k not in ("bands", "multiplier")}
        | {"bands": [{"upTo": u, "label": l} for u, l in m["bands"]]}
        for m in MEASURES.values()
    ]
