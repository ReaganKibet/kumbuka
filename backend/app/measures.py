"""Standardized questionnaires and their scoring rules.

PHQ-9 and GAD-7 were developed by Drs. Spitzer, Williams, Kroenke and colleagues with an
educational grant from Pfizer; no permission is required to reproduce, translate, display
or distribute them.
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
        "bands": [(4, "Minimal"), (9, "Mild"), (14, "Moderate"), (21, "Severe")],
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
    if any((not isinstance(a, int)) or a < 0 or a > 3 for a in answers):
        raise MeasureError("Each answer must be a whole number from 0 to 3")

    total = sum(answers)
    severity = next(label for upper, label in measure["bands"] if total <= upper)

    flags: list[str] = []
    if kind == "PHQ-9" and answers[8] > 0:
        flags.append("Item 9 endorsed (thoughts of death or self-harm). Review risk with the client today.")
    if kind == "PHQ-9" and total >= 20:
        flags.append("Severe range. Consider whether a referral or closer follow-up is needed.")
    if kind == "GAD-7" and total >= 15:
        flags.append("Severe range. Consider whether a referral or closer follow-up is needed.")

    return {"total": total, "severity": severity, "flags": flags}


def public_definitions() -> list[dict]:
    return [
        {k: v for k, v in m.items() if k != "bands"} | {"bands": [{"upTo": u, "label": l} for u, l in m["bands"]]}
        for m in MEASURES.values()
    ]
