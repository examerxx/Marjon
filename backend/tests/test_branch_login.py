from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.auth.models import User
from app.modules.auth.security import hash_password
from tests.conftest import register_company

LOGIN = "+998901112233"
PASSWORD = "Terminal-Pass-1"


async def _company_with_branch_login(client, *, slug="acme"):
    owner_headers, _ = await register_company(client, slug=slug, email=f"owner@{slug}.example.com")
    created = await client.post(
        "/companies/me/branches",
        headers=owner_headers,
        json={"name": "Main", "login": "+998 90 111-22-33", "password": PASSWORD},
    )
    assert created.status_code == 201, created.text
    return owner_headers, created.json()


async def _cashier_with_pin(client, owner_headers, pin="1234"):
    resp = await client.post(
        "/auth/users",
        headers=owner_headers,
        json={"email": "cashier@acme.example.com", "password": "Passw0rd!", "role_slug": "cashier"},
    )
    assert resp.status_code == 201, resp.text
    staff = resp.json()
    setpin = await client.patch(f"/auth/users/{staff['id']}/pin", headers=owner_headers, json={"pin": pin})
    assert setpin.status_code == 204
    return staff


async def test_branch_login_normalizes_phone_and_hides_password(client):
    _, branch = await _company_with_branch_login(client)
    assert branch["login"] == LOGIN
    assert "password" not in branch and "password_hash" not in branch

    resp = await client.post("/auth/branch-login", json={"login": "+998 90 111-22-33", "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["branch"]["id"] == branch["id"]
    assert body["company"]["slug"] == "acme"


async def test_branch_login_rejects_bad_credentials(client):
    await _company_with_branch_login(client)
    wrong_password = await client.post("/auth/branch-login", json={"login": LOGIN, "password": "nope"})
    unknown_login = await client.post("/auth/branch-login", json={"login": "+998900000000", "password": PASSWORD})
    assert wrong_password.status_code == 401
    assert unknown_login.status_code == 401


async def test_terminal_lists_staff_and_pin_login_with_user_id(client):
    owner_headers, branch = await _company_with_branch_login(client)
    staff = await _cashier_with_pin(client, owner_headers)

    terminal = (await client.post("/auth/branch-login", json={"login": LOGIN, "password": PASSWORD})).json()
    term_headers = {"Authorization": f"Bearer {terminal['access_token']}"}

    listing = await client.get("/auth/staff-users", headers=term_headers, params={"branch_id": branch["id"]})
    assert listing.status_code == 200, listing.text
    emails = {u["email"] for u in listing.json()}
    assert "cashier@acme.example.com" in emails
    assert not any((e or "").startswith("terminal+") for e in emails)

    ok = await client.post("/auth/pin-login", headers=term_headers, json={"pin": "1234", "user_id": staff["id"]})
    assert ok.status_code == 200, ok.text
    staff_headers = {"Authorization": f"Bearer {ok.json()['access_token']}"}
    me = await client.get("/auth/me", headers=staff_headers)
    assert me.json()["email"] == "cashier@acme.example.com"

    bad = await client.post("/auth/pin-login", headers=term_headers, json={"pin": "0000", "user_id": staff["id"]})
    assert bad.status_code == 401

    active = await client.get("/auth/active-staff", headers=term_headers)
    assert active.status_code == 200
    assert staff["id"] in active.json()


async def test_shared_pin_prefers_working_staff_over_owner(client, db_engine):
    """Один и тот же код у владельца и кассира не должен открывать кассу под
    владельцем: на терминале приоритет у рабочей роли, код владельца остаётся
    запасным (сработает, когда он один такой)."""
    owner_headers, _ = await _company_with_branch_login(client, slug="sharedpin")
    staff = await _cashier_with_pin(client, owner_headers, pin="1111")

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        owner = (await session.execute(
            select(User).where(User.email == "owner@sharedpin.example.com")
        )).scalar_one()
        owner.pin_hash = await hash_password("1111")
        await session.commit()

    terminal = (await client.post(
        "/auth/branch-login", json={"login": LOGIN, "password": PASSWORD}
    )).json()
    term_headers = {"Authorization": f"Bearer {terminal['access_token']}"}

    resp = await client.post("/auth/pin-login", headers=term_headers, json={"pin": "1111"})
    assert resp.status_code == 200, resp.text
    me = await client.get(
        "/auth/me", headers={"Authorization": f"Bearer {resp.json()['access_token']}"}
    )
    assert me.json()["email"] == "cashier@acme.example.com"
    assert me.json()["id"] == staff["id"]


async def test_active_staff_excludes_deactivated_employee(client):
    owner_headers, _ = await _company_with_branch_login(client, slug="activeoff")
    staff = await _cashier_with_pin(client, owner_headers)

    terminal = (await client.post(
        "/auth/branch-login", json={"login": LOGIN, "password": PASSWORD}
    )).json()
    term_headers = {"Authorization": f"Bearer {terminal['access_token']}"}
    login = await client.post(
        "/auth/pin-login", headers=term_headers, json={"pin": "1234", "user_id": staff["id"]}
    )
    assert login.status_code == 200
    assert staff["id"] in (await client.get("/auth/active-staff", headers=term_headers)).json()

    off = await client.patch(
        f"/auth/users/{staff['id']}", headers=owner_headers, json={"is_active": False}
    )
    assert off.status_code == 200, off.text
    assert staff["id"] not in (await client.get("/auth/active-staff", headers=term_headers)).json()


async def test_branch_colleagues_scopes_to_the_caller_own_branch(client):
    """Personal-device sign-in (mobile Staff, /auth/login — no shared terminal)
    needs a way to list colleagues for order/item hand-offs. /auth/staff-users
    stays owner/terminal-only (frozen BI-06 contract); /auth/branch-colleagues
    is the narrower replacement: always the caller's own branch, never an
    owner-wide roster, and never another branch via a query override."""
    owner_headers, branch_a = await _company_with_branch_login(client, slug="colleagues")
    branch_b = (await client.post(
        "/companies/me/branches", headers=owner_headers,
        json={"name": "Second", "login": "+998 90 222-33-44", "password": "Other-Pass-1"},
    )).json()

    async def _make(email, phone, branch_id):
        resp = await client.post(
            "/auth/users", headers=owner_headers,
            json={"email": email, "password": "Passw0rd!", "phone": phone, "role_slug": "cashier", "branch_id": branch_id},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    cashier_a = await _make("cashier-a@colleagues.example.com", "+998901110001", branch_a["id"])
    cashier_b = await _make("cashier-b@colleagues.example.com", "+998901110002", branch_b["id"])
    unassigned = await _make("floater@colleagues.example.com", "+998901110003", None)

    login = await client.post("/auth/login", json={"phone": "+998901110001", "password": "Passw0rd!"})
    assert login.status_code == 200, login.text
    cashier_a_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # The frozen owner/terminal-only route stays denied for a plain employee login.
    denied = await client.get("/auth/staff-users", headers=cashier_a_headers)
    assert denied.status_code == 403

    colleagues = await client.get("/auth/branch-colleagues", headers=cashier_a_headers)
    assert colleagues.status_code == 200, colleagues.text
    ids = {u["id"] for u in colleagues.json()}
    assert cashier_a["id"] in ids
    assert unassigned["id"] in ids
    assert cashier_b["id"] not in ids


async def test_branch_colleagues_and_my_employee_use_the_hr_record_not_user_branch_id(client):
    """The real owner-panel staff editor (StaffRolePage.jsx) only ever sends
    User.branch_id for the monoblock role — cashier/waiter/kitchen/courier
    accounts get their branch from a separate HR Employee record instead
    (StaffPage.jsx's "Филиал" field, POST /hr/employees). A personal-device
    login must resolve the branch from there, or every real staff account
    hits "not assigned to a branch" on first sign-in."""
    owner_headers, branch_a = await _company_with_branch_login(client, slug="hr-branch")
    branch_b = (await client.post(
        "/companies/me/branches", headers=owner_headers,
        json={"name": "Second", "login": "+998 90 333-44-55", "password": "Other-Pass-2"},
    )).json()

    async def _make_user(email, phone):
        resp = await client.post(
            "/auth/users", headers=owner_headers,
            json={"email": email, "password": "Passw0rd!", "phone": phone, "role_slug": "cashier"},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    async def _assign(user_id, branch_id):
        resp = await client.post(
            "/hr/employees", headers=owner_headers,
            json={"user_id": user_id, "branch_id": branch_id, "position": "Кассир", "hire_date": "2026-01-01"},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    waiter_a = await _make_user("waiter-a@hr-branch.example.com", "+998901110011")
    waiter_b = await _make_user("waiter-b@hr-branch.example.com", "+998901110012")
    await _assign(waiter_a["id"], branch_a["id"])
    await _assign(waiter_b["id"], branch_b["id"])

    login = await client.post("/auth/login", json={"phone": "+998901110011", "password": "Passw0rd!"})
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    me = await client.get("/auth/me", headers=headers)
    assert me.json()["branch_id"] is None, "User.branch_id must stay unset for a non-monoblock role"

    mine = await client.get("/hr/employees/me", headers=headers)
    assert mine.status_code == 200, mine.text
    assert mine.json()["branch_id"] == branch_a["id"]

    colleagues = await client.get("/auth/branch-colleagues", headers=headers)
    assert colleagues.status_code == 200, colleagues.text
    ids = {u["id"] for u in colleagues.json()}
    assert waiter_a["id"] in ids
    assert waiter_b["id"] not in ids


async def test_pin_login_without_terminal_or_employee_is_rejected(client):
    resp = await client.post("/auth/pin-login", json={"pin": "1234"})
    assert resp.status_code == 422


async def test_terminal_cannot_pin_into_other_company_user(client):
    await _company_with_branch_login(client, slug="acme")
    other_headers, _ = await register_company(client, slug="other", email="owner@other.example.com")
    other = (await client.post(
        "/auth/users", headers=other_headers,
        json={"email": "c@other.example.com", "password": "Passw0rd!", "role_slug": "cashier"},
    )).json()
    await client.patch(f"/auth/users/{other['id']}/pin", headers=other_headers, json={"pin": "1234"})

    terminal = (await client.post("/auth/branch-login", json={"login": LOGIN, "password": PASSWORD})).json()
    resp = await client.post(
        "/auth/pin-login",
        headers={"Authorization": f"Bearer {terminal['access_token']}"},
        json={"pin": "1234", "user_id": other["id"]},
    )
    assert resp.status_code == 401
