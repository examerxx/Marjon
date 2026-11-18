from datetime import datetime, timezone
from uuid import uuid4

from app.modules.qrmenu.service import (
    SHORT_CODE_LEN,
    accepted_stamp,
    normalize_short_code,
    parse_table_token,
    table_short_code,
    table_token,
)


def test_accepted_stamp_is_in_company_timezone_not_utc():
    created = datetime(2026, 11, 14, 18, 20, tzinfo=timezone.utc)  # 18:20 UTC = 23:20 Tashkent
    now = datetime(2026, 11, 14, 18, 40, tzinfo=timezone.utc)  # 23:40 Tashkent, same day
    stamp = accepted_stamp(created, "Asia/Tashkent", now=now)
    assert stamp == {"accepted_time": "23:20", "accepted_date": "14.11.26", "accepted_today": True}


def test_accepted_stamp_naive_datetime_is_utc_and_yesterday_is_not_today():
    created = datetime(2026, 11, 14, 18, 20)  # без tz — это UTC
    now = datetime(2026, 11, 15, 10, 0, tzinfo=timezone.utc)
    stamp = accepted_stamp(created, "Asia/Tashkent", now=now)
    assert stamp["accepted_time"] == "23:20"
    assert stamp["accepted_today"] is False


def test_accepted_stamp_falls_back_to_tashkent_for_bad_timezone_and_handles_none():
    created = datetime(2026, 11, 14, 18, 20, tzinfo=timezone.utc)
    assert accepted_stamp(created, "Nowhere/Nothing")["accepted_time"] == "23:20"
    assert accepted_stamp(created, None)["accepted_time"] == "23:20"
    assert accepted_stamp(None, "Asia/Tashkent") == {"accepted_time": None, "accepted_date": None, "accepted_today": None}


def test_token_roundtrip():
    table_id = uuid4()
    token = table_token(table_id)
    assert len(token) == 52
    assert parse_table_token(token) == table_id


def test_token_is_stable_per_table_and_unique_between_tables():
    a, b = uuid4(), uuid4()
    assert table_token(a) == table_token(a)
    assert table_token(a) != table_token(b)


def test_tampered_or_guessed_tokens_are_rejected():
    table_id = uuid4()
    token = table_token(table_id)
    flipped = token[:-1] + ("0" if token[-1] != "0" else "1")
    assert parse_table_token(flipped) is None
    # подпись другого стола к id этого стола не подходит
    assert parse_table_token(table_id.hex + table_token(uuid4())[32:]) is None
    # голый id без подписи и мусор
    assert parse_table_token(table_id.hex) is None
    assert parse_table_token("") is None
    assert parse_table_token("z" * 52) is None


def test_short_code_is_short_qr_alphanumeric_and_stable():
    a, b = uuid4(), uuid4()
    code = table_short_code(a)
    assert len(code) == SHORT_CODE_LEN == 7
    assert set(code) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    assert table_short_code(a) == code
    assert table_short_code(b) != code


def test_short_code_normalization_accepts_lowercase_and_rejects_garbage():
    code = table_short_code(uuid4())
    assert normalize_short_code(code.lower()) == code
    assert normalize_short_code(f" {code} ") == code
    assert normalize_short_code(code[:-1]) is None
    assert normalize_short_code(code + "A") is None
    assert normalize_short_code("ABCDEF1") is None  # «1» нет в base32
    assert normalize_short_code("") is None


def test_short_codes_do_not_collide_on_many_tables():
    codes = {table_short_code(uuid4()) for _ in range(20000)}
    assert len(codes) == 20000
