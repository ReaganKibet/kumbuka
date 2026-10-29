PASSWORD = "correct-horse-9"


def signup(api, email):
    r = api.post("/api/auth/register", json={"name": "Counselor", "email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
