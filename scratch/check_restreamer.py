import requests
import json

url = "https://media.eventcast.pro"
username = "admin"
password = "R3nug0pa!"

def get_auth_token():
    res = requests.post(f"{url}/api/login", json={"username": username, "password": password})
    res.raise_for_status()
    return f"Bearer {res.json()['access_token']}"

def list_processes():
    token = get_auth_token()
    res = requests.get(f"{url}/api/v3/process", headers={"Authorization": token})
    res.raise_for_status()
    return res.json()

def check_restreamer_api():
    token = get_auth_token()
    # Try to find restreamer specific API
    endpoints = ["/api/restreamer/v1/config", "/api/v3/metadata"]
    results = {}
    for ep in endpoints:
        res = requests.get(f"{url}{ep}", headers={"Authorization": token})
        results[ep] = res.status_code
        if res.status_code == 200:
            try:
                results[ep + "_data"] = res.json()
            except:
                results[ep + "_data"] = res.text[:100]
    return results

if __name__ == "__main__":
    print("Processes:")
    print(json.dumps(list_processes(), indent=2))
    print("\nAPI Check:")
    print(json.dumps(check_restreamer_api(), indent=2))
