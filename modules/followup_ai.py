"""
AI for follow-ups: read a note / conversation and decide whether it implies a
follow-up and when ("they'll discuss internally and respond next week" ->
follow up on Friday next week), suggest the next follow-up from a record's
whole history, and draft the personalized follow-up email.

Every AI path has a deterministic fallback (heuristic date parsing, a plain
template) so the feature keeps working without OPENAI_API_KEY or when the AI
call fails. Notes and emails are untrusted text — prompts fence them as data
(email_ai.UNTRUSTED) and outputs are validated here.
"""
import re
from datetime import date, datetime, timedelta
from typing import Optional

from modules import email_ai
from modules.email_ai import EmailAIError

CHANNELS = ("email", "call", "meeting", "whatsapp", "other")
PRIORITIES = ("high", "medium", "low")
MAX_DAYS_AHEAD = 366

_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"])}
_MONTHS.update({k[:3]: v for k, v in list(_MONTHS.items())})
_MONTHS["sept"] = 9
_NUMBER_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "couple of": 2, "a couple of": 2, "few": 3, "a few": 3,
                 "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "ten": 10, "fifteen": 15}

# Phrases that mean someone owes a next step.
_COMMITMENT_RE = re.compile(
    r"\b(get back|respond|revert|reply|confirm|decide|decision|discuss(?:ing)? (?:it )?internally|discuss with|"
    r"think (?:about|it over)|review|let (?:us|me) know|call (?:back|again|us|them|him|her)|follow[- ]?up|"
    r"touch base|check in|reach out|remind|reconnect|speak (?:again|next)|talk (?:again|next)|circle back|"
    r"send (?:the |a |over )?(?:proposal|quote|deck|details|pricing|contract)|budget|approval|meeting|demo)\b",
    re.I,
)


def _shift_off_weekend(d: date) -> date:
    while d.weekday() >= 5:  # Saturday / Sunday -> Monday
        d += timedelta(days=1)
    return d


def _end_of_week(d: date) -> date:
    """Friday of d's week."""
    return d + timedelta(days=4 - d.weekday()) if d.weekday() <= 4 else d + timedelta(days=11 - d.weekday())


def _num(word: str) -> Optional[int]:
    word = word.strip().lower()
    if word.isdigit():
        return int(word)
    return _NUMBER_WORDS.get(word)


def parse_relative_date(text: str, base: date) -> Optional[date]:
    """Best-effort: the follow-up date a phrase like "respond next week" / "call me on Tuesday" /
    "in 2 weeks" / "by 15 Oct" implies, resolved against `base` (the day the note was written).

    When someone promises to get back within a period, the follow-up lands at the END of that period
    (next week -> Friday of next week), so they get the chance to respond first. Weekends roll to
    Monday. Returns None if no date phrase is found.
    """
    t = " " + (text or "").lower() + " "
    candidates = []

    def add(d: Optional[date]):
        if d and base - timedelta(days=1) <= d <= base + timedelta(days=MAX_DAYS_AHEAD):
            candidates.append(d)

    # ISO / numeric dates: 2026-10-20, 20/10/2026, 20-10
    for y, m, d in re.findall(r"\b(20\d\d)-(\d{1,2})-(\d{1,2})\b", t):
        try:
            add(date(int(y), int(m), int(d)))
        except ValueError:
            pass
    # "15 oct", "15th october", "oct 15", "october 15th"
    month_names = "|".join(sorted(_MONTHS, key=len, reverse=True))
    for dd, mon in re.findall(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?(?:\s+of)?\s+({month_names})\b", t):
        add(_next_occurrence(base, _MONTHS[mon], int(dd)))
    for mon, dd in re.findall(rf"\b({month_names})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", t):
        add(_next_occurrence(base, _MONTHS[mon], int(dd)))

    if re.search(r"\bday after tomorrow\b", t):
        add(base + timedelta(days=2))
    elif re.search(r"\btomorrow\b", t):
        add(base + timedelta(days=1))
    # "today" mostly describes when the note was written ("spoke today, they'll reply next week"),
    # so it only counts when no other date phrase is present.
    weak_today = bool(re.search(r"\b(today|tonight|this evening|later today)\b", t))
    if re.search(r"\b(this week|end of (?:the |this )?week|by (?:the )?weekend|this weekend)\b", t):
        add(_end_of_week(base))
    if re.search(r"\b(next week|following week|early next week|within a week|in a week)\b", t):
        add(_end_of_week(base + timedelta(days=7)) if "early next week" not in t else
            base + timedelta(days=7 - base.weekday()))
    if re.search(r"\b(next month|end of (?:the )?month|this month)\b", t):
        if re.search(r"\bnext month\b", t):
            first_next = (base.replace(day=1) + timedelta(days=32)).replace(day=1)
            add(first_next + timedelta(days=7))
        else:
            add((base.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1))
    for qty, unit in re.findall(r"\b(?:in|within|after|another)\s+(\d+|a|an|one|two|three|four|five|six|seven|ten|fifteen|"
                                r"a couple of|couple of|a few|few)\s+(day|week|month)s?\b", t):
        n = _num(qty)
        if n:
            add(base + timedelta(days=n * {"day": 1, "week": 7, "month": 30}[unit]))
    for qty, unit in re.findall(r"\b(\d+|two|three|four)\s+(day|week)s?\s+(?:time|later|from now)\b", t):
        n = _num(qty)
        if n:
            add(base + timedelta(days=n * (7 if unit == "week" else 1)))
    # Weekdays: "on monday", "next friday", "by thursday"
    for prefix, wd in re.findall(rf"\b(next\s+|this\s+|on\s+|by\s+|until\s+|)({'|'.join(_WEEKDAYS)})\b", t):
        target = _WEEKDAYS.index(wd)
        if prefix.strip() == "next":  # "next friday" = the friday of next week
            add(base - timedelta(days=base.weekday()) + timedelta(days=7 + target))
        else:  # "on/by/this friday" = the coming friday (a week ahead if today is friday)
            add(base + timedelta(days=(target - base.weekday()) % 7 or 7))

    if not candidates:
        return _shift_off_weekend(base) if weak_today else None
    return _shift_off_weekend(min(candidates))


def _next_occurrence(base: date, month: int, day: int) -> Optional[date]:
    for year in (base.year, base.year + 1):
        try:
            d = date(year, month, day)
        except ValueError:
            return None
        if d >= base - timedelta(days=1):
            return d
    return None


def _first_sentence_with(text: str, pattern) -> str:
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text or ""):
        if pattern.search(sentence):
            return sentence.strip()
    return (text or "").strip()


def heuristic_extract(text: str, base: date) -> dict:
    """Rule-based twin of extract_from_note, used without AI."""
    committed = bool(_COMMITMENT_RE.search(text or ""))
    # Prefer a date stated in the same sentence as the commitment over one elsewhere in the note.
    due = parse_relative_date(_first_sentence_with(text, _COMMITMENT_RE), base) if committed else None
    due = due or parse_relative_date(text, base)
    if not due or not committed:
        return {"should_follow_up": False, "due_date": None, "title": "", "reason": "", "quote": "",
                "channel": "email", "priority": "medium", "confidence": 0.0, "engine": "rules"}
    quote = _first_sentence_with(text, _COMMITMENT_RE)
    channel = "call" if re.search(r"\b(call|phone|ring)\b", text, re.I) else (
        "meeting" if re.search(r"\b(meeting|demo|visit)\b", text, re.I) else "email")
    return {
        "should_follow_up": True, "due_date": due.isoformat(),
        "title": _clip(f"Follow up: {quote}", 140),
        "reason": f"From the note: “{_clip(quote, 300)}”", "quote": _clip(quote, 300),
        "channel": channel, "priority": "medium", "confidence": 0.6, "engine": "rules",
    }


def _clip(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _valid_date(value, base: date, floor: date) -> Optional[date]:
    try:
        d = date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None
    if d > base + timedelta(days=MAX_DAYS_AHEAD):
        return None
    return _shift_off_weekend(max(d, floor))


_DATE_RULES = (
    "Date rules: resolve relative dates against the date the text was written. When the contact promised to get "
    "back within a period, schedule the follow-up at the END of that period so they have time to respond "
    "(\"next week\" -> Friday of next week, \"in two weeks\" -> that day, \"tomorrow\" -> the next day). If a "
    "specific day or date is named, use it. Never schedule on a Saturday or Sunday. If the text implies a "
    "follow-up but gives no timing, use 3 business days after it was written."
)


def extract_from_note(text: str, written_on: date, today: date, record_label: str = "") -> dict:
    """Does this note / conversation log imply a follow-up, and when? Falls back to rules without AI."""
    text = (text or "").strip()
    if not text:
        return heuristic_extract("", written_on)
    system = (
        "You read sales CRM notes and conversation logs and decide whether they imply a follow-up the salesperson "
        "must do: the contact promised to get back, asked to be contacted later, needs to discuss internally, is "
        "waiting on budget/approval, or the salesperson promised to send something or call back. Pure facts with "
        "no pending next step, closed deals, and refusals (\"not interested\", \"unsubscribe\") need no follow-up.\n"
        f"{_DATE_RULES}\n{email_ai.UNTRUSTED}\n"
        'Respond as JSON: {"should_follow_up": bool, "due_date": "YYYY-MM-DD" or null, "title": "short imperative '
        'task, max 12 words", "reason": "one sentence on what was said and why to follow up", "quote": "the exact '
        'words from the note that justify it", "channel": "email|call|meeting|whatsapp|other", '
        '"priority": "high|medium|low", "confidence": 0.0-1.0}'
    )
    user = (f"Record: {record_label or 'a lead/client'}\nWritten on: {written_on.isoformat()} "
            f"({_WEEKDAYS[written_on.weekday()].title()})\nToday: {today.isoformat()}\n\n<crm_context>\n{_clip(text, 4000)}\n</crm_context>")
    try:
        data = email_ai._chat_json(system, user, max_tokens=400, timeout=30)
    except EmailAIError:
        return heuristic_extract(text, written_on)
    return _clean_suggestion(data, written_on, floor=written_on, engine="ai")


def _clean_suggestion(data: dict, base: date, floor: date, engine: str) -> dict:
    should = bool(data.get("should_follow_up"))
    due = _valid_date(data.get("due_date"), base, floor) if should else None
    if should and not due:
        due = _shift_off_weekend(base + timedelta(days=3))
    try:
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.7))))
    except (TypeError, ValueError):
        confidence = 0.7
    channel = str(data.get("channel") or "email").lower()
    priority = str(data.get("priority") or "medium").lower()
    return {
        "should_follow_up": should,
        "due_date": due.isoformat() if due else None,
        "title": _clip(data.get("title"), 160) if should else "",
        "reason": _clip(data.get("reason"), 600) if should else "",
        "quote": _clip(data.get("quote"), 400) if should else "",
        "channel": channel if channel in CHANNELS else "email",
        "priority": priority if priority in PRIORITIES else "medium",
        "confidence": confidence,
        "engine": engine,
    }


def suggest_from_history(*, context_text: str, record_label: str, today: date, latest_texts: list) -> dict:
    """Propose the next follow-up for a record from its whole CRM history (not saved).

    `latest_texts` is [(written_on: date, text)] newest first — used by the rules fallback."""
    system = (
        "You are a sales assistant. From the CRM history of one lead/client, decide the single most useful next "
        "follow-up: when, through which channel, and why. Prefer explicit commitments in the most recent notes, "
        "conversations and emails (e.g. 'they will discuss internally and respond next week'). If nothing is "
        "pending and the relationship is still open, suggest a light check-in. If the record is clearly closed, "
        "lost or asked not to be contacted, set should_follow_up to false.\n"
        f"{_DATE_RULES}\n{email_ai.UNTRUSTED}\n"
        'Respond as JSON: {"should_follow_up": bool, "due_date": "YYYY-MM-DD" or null, "title": "short imperative '
        'task", "reason": "1-2 sentences citing what was said and when", "quote": "exact words that triggered it, '
        'if any", "channel": "email|call|meeting|whatsapp|other", "priority": "high|medium|low", "confidence": 0.0-1.0}'
    )
    user = f"Record: {record_label}\nToday: {today.isoformat()} ({_WEEKDAYS[today.weekday()].title()})\n\n<crm_context>\n{context_text}\n</crm_context>"
    try:
        data = email_ai._chat_json(system, user, max_tokens=500, timeout=40)
        return _clean_suggestion(data, today, floor=today, engine="ai")
    except EmailAIError:
        pass
    for written_on, text in latest_texts:
        s = heuristic_extract(text, written_on)
        if s["should_follow_up"]:
            due = max(date.fromisoformat(s["due_date"]), today)
            s["due_date"] = _shift_off_weekend(due).isoformat()
            return s
    due = _shift_off_weekend(today + timedelta(days=3))
    return {"should_follow_up": True, "due_date": due.isoformat(), "title": f"Check in with {record_label}",
            "reason": "No pending commitment was found in the notes; a short check-in keeps the conversation moving.",
            "quote": "", "channel": "email", "priority": "low", "confidence": 0.3, "engine": "rules"}


def template_email(*, contact_name: str, company: str, title: str, reason: str, last_discussion: str,
                   sender_name: str) -> dict:
    """Plain personalized follow-up used when AI drafting isn't available."""
    first = (contact_name or "").split()[0] if (contact_name or "").strip() else ""
    greeting = f"Hi {first}," if first else "Hello,"
    lines = [greeting, ""]
    if last_discussion:
        lines.append(f"I'm following up on our last conversation, where {last_discussion.rstrip('.')}.")
    elif reason:
        lines.append(f"I'm following up regarding {reason.rstrip('.')}.")
    else:
        lines.append(f"I wanted to follow up{(' with ' + company) if company else ''} on our recent conversation.")
    lines += ["", "Is there anything you need from my side to move forward? I'd be happy to answer any questions "
                  "or set up a quick call at a time that suits you.", "", "Best regards,"]
    if sender_name:
        lines.append(sender_name)
    subject = f"Following up{(' — ' + company) if company else ''}"
    return {"subject": subject[:300], "body": "\n".join(lines), "engine": "template"}


def draft_followup_email(*, contact_name: str, company: str, record_label: str, title: str, reason: str,
                         context_text: str, sender_name: str, sender_company: str, tone: str = "professional",
                         instructions: str = "", last_discussion: str = "") -> dict:
    """A follow-up email grounded in the previous notes/conversations, never a generic message."""
    goal = (f"This is a follow-up. The follow-up task: {title}. Why: {reason or 'see the history'}. "
            "Refer specifically to what was last discussed (who said what, and what they promised or asked for), "
            "and propose one concrete next step.")
    try:
        draft = email_ai.draft_record_email(
            purpose="custom", tone=tone if tone in email_ai.TONES else "professional",
            instructions=(goal + ("\n" + instructions if instructions else ""))[:1900],
            record_label=record_label or company or "the contact", context_text=context_text,
            recipient_name=contact_name or "", sender_name=sender_name or "", company=sender_company or "",
        )
        return {**draft, "engine": "ai"}
    except EmailAIError:
        return template_email(contact_name=contact_name, company=company, title=title, reason=reason,
                              last_discussion=last_discussion, sender_name=sender_name)
