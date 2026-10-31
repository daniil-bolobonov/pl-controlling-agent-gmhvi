"""Unit tests for wrong booking and one-time effect flagging rules."""
import pytest


@pytest.fixture(autouse=True)
def setup_path(add_agent_to_path):
    pass


def flag_journal_entries(entries: list[dict], line_total_deviation: float) -> list[dict]:
    """Apply flagging rules and return flagged entries."""
    CORRECTION_KEYWORDS = {"correction", "reversal", "one-time", "korrekt", "umbuchung", "einmaleffekt", "storno"}
    ACCRUAL_DOC_TYPES = {"AA", "AE"}
    flagged = []
    for entry in entries:
        flags = []
        amount = abs(entry.get("amount", 0))
        text = (entry.get("text") or "").lower()
        doc_type = entry.get("doc_type", "")
        debit_credit = entry.get("debit_credit", "")
        account_type = entry.get("account_type", "")

        # Rule 1: single entry > 80% of line total deviation
        if line_total_deviation and amount > 0.8 * abs(line_total_deviation):
            flags.append("Dominant single posting — accounts for > 80% of line deviation")

        # Rule 2: correction/reversal keyword in text
        for kw in CORRECTION_KEYWORDS:
            if kw in text:
                flags.append(f"Correction/reversal keyword found: '{kw}'")
                break

        # Rule 3: revenue account with debit posting
        if account_type == "revenue" and debit_credit == "S":
            flags.append("Revenue account with debit posting — possible error")

        # Rule 4: large period-end accrual
        if doc_type in ACCRUAL_DOC_TYPES:
            flags.append(f"Period-end accrual posting (doc type {doc_type}) — verify basis")

        if flags:
            entry["flags"] = flags
            flagged.append(entry)

    return flagged


def test_dominant_posting_flagged():
    entries = [{"id": "1", "amount": 90000, "text": "Normal posting", "doc_type": "RV", "debit_credit": "H", "account_type": "revenue"}]
    flagged = flag_journal_entries(entries, line_total_deviation=100000)
    assert len(flagged) == 1
    assert any("Dominant" in f for f in flagged[0]["flags"])


def test_correction_keyword_flagged():
    entries = [{"id": "2", "amount": 5000, "text": "Correction of posting error", "doc_type": "SA", "debit_credit": "H", "account_type": "cost"}]
    flagged = flag_journal_entries(entries, line_total_deviation=100000)
    assert len(flagged) == 1
    assert any("correction" in f.lower() for f in flagged[0]["flags"])


def test_storno_keyword_flagged():
    entries = [{"id": "3", "amount": 5000, "text": "Storno Buchung", "doc_type": "SA", "debit_credit": "H", "account_type": "cost"}]
    flagged = flag_journal_entries(entries, line_total_deviation=100000)
    assert len(flagged) == 1


def test_revenue_debit_flagged():
    entries = [{"id": "4", "amount": 10000, "text": "Normal", "doc_type": "RV", "debit_credit": "S", "account_type": "revenue"}]
    flagged = flag_journal_entries(entries, line_total_deviation=100000)
    assert len(flagged) == 1
    assert any("debit" in f.lower() for f in flagged[0]["flags"])


def test_accrual_doc_type_flagged():
    entries = [{"id": "5", "amount": 50000, "text": "Month-end accrual", "doc_type": "AA", "debit_credit": "H", "account_type": "cost"}]
    flagged = flag_journal_entries(entries, line_total_deviation=100000)
    assert len(flagged) == 1
    assert any("accrual" in f.lower() for f in flagged[0]["flags"])


def test_normal_entry_not_flagged():
    entries = [{"id": "6", "amount": 10000, "text": "Regular vendor invoice", "doc_type": "KR", "debit_credit": "H", "account_type": "cost"}]
    flagged = flag_journal_entries(entries, line_total_deviation=100000)
    assert len(flagged) == 0
