"""
Geocode all D1 addresses via Google Geocoding API (local script).

Fetches addresses from the live API, geocodes via Google, and uploads
results to D1 via the /sync/geocache endpoint.

Usage:
    GOOGLE_GEOCODING_API_KEY=AIza... python3 worker/scripts/geocode_google.py
"""
import json
import math
import os
import ssl
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

import certifi

# Global SSL context for macOS Python 3.12 compatibility
SSL_CTX = ssl.create_default_context(cafile=certifi.where())


API_URL = "https://hsds-api.devin-d41.workers.dev"
SYNC_SECRET = os.environ.get("SYNC_SECRET", "")
if not SYNC_SECRET:
    # Checked later in main() — but warn early
    pass
GOOGLE_KEY = os.environ.get("GOOGLE_GEOCODING_API_KEY", "")

# NYC center for proximity filter
NYC_LAT, NYC_LNG = 40.7128, -74.006
MAX_DISTANCE_MILES = 200


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in miles between two lat/lng points."""
    R = 3958.8
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def google_geocode(address: str) -> dict | None:
    """Geocode an address via Google Geocoding API."""
    params = urllib.parse.urlencode({"address": address, "key": GOOGLE_KEY})
    url = f"https://maps.googleapis.com/maps/api/geocode/json?{params}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10, context=SSL_CTX) as resp:
            data = json.loads(resp.read().decode())
        if data["status"] == "OK" and data["results"]:
            loc = data["results"][0]["geometry"]["location"]
            return {
                "latitude": loc["lat"],
                "longitude": loc["lng"],
                "formatted_address": data["results"][0]["formatted_address"],
            }
        print(f"  Google: {data['status']}")
        return None
    except Exception as e:
        print(f"  Error: {e}")
        return None


def fetch_addresses():
    """Fetch all addresses from the D1 addresses table via wrangler."""
    import subprocess
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "hsds-directory", "--remote",
         "--command", "SELECT id, data FROM addresses", "--json"],
        capture_output=True, text=True, cwd=os.path.join(os.path.dirname(__file__), "..")
    )
    if result.returncode != 0:
        print(f"wrangler error: {result.stderr}")
        sys.exit(1)
    raw = json.loads(result.stdout)
    # wrangler d1 returns [{ results: [...] }]
    return raw[0]["results"]


def upload_batch(entries: dict):
    """Upload geocache entries via the /sync/geocache endpoint."""
    payload = json.dumps({"entries": entries}).encode()
    req = urllib.request.Request(
        f"{API_URL}/sync/geocache",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SYNC_SECRET}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        return json.loads(resp.read().decode())


def main():
    if not GOOGLE_KEY:
        print("Set GOOGLE_GEOCODING_API_KEY environment variable")
        sys.exit(1)
    if not SYNC_SECRET:
        print("Set SYNC_SECRET environment variable")
        sys.exit(1)

    print("Fetching addresses from D1...")
    rows = fetch_addresses()
    print(f"Found {len(rows)} addresses")

    geocoded = {}
    skipped = 0
    failed = 0

    for i, row in enumerate(rows, 1):
        addr_id = row["id"]
        fields = json.loads(row["data"])
        parts = [
            fields.get("address_1", ""),
            fields.get("city", ""),
            fields.get("state_province", ""),
            fields.get("postal_code", ""),
        ]
        query = ", ".join(p for p in parts if p)
        if not query.strip():
            skipped += 1
            continue

        print(f"[{i}/{len(rows)}] {query[:60]}...", end=" ")
        result = google_geocode(query)

        if result:
            dist = haversine(result["latitude"], result["longitude"], NYC_LAT, NYC_LNG)
            if dist > MAX_DISTANCE_MILES:
                print(f"REJECTED ({dist:.0f}mi from NYC)")
                failed += 1
            else:
                print(f"OK ({result['latitude']:.4f}, {result['longitude']:.4f})")
                geocoded[addr_id] = {
                    "latitude": result["latitude"],
                    "longitude": result["longitude"],
                    "formatted_address": result["formatted_address"],
                    "geocoded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
        else:
            print("FAILED")
            failed += 1

        # Rate limit: Google allows 50 QPS but let's be polite
        time.sleep(0.1)

    print(f"\nResults: {len(geocoded)} geocoded, {failed} failed, {skipped} skipped")

    if geocoded:
        print(f"Uploading {len(geocoded)} entries to D1...")
        result = upload_batch(geocoded)
        print(f"Upload: {result}")

    # Check map improvement
    print("\nVerifying map improvement...")
    req = urllib.request.Request(f"{API_URL}/map/services")
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        data = json.loads(resp.read().decode())
    geo_count = sum(1 for s in data["services"] if s.get("latitude"))
    print(f"Map services: {len(data['services'])}, Geocoded: {geo_count}")


if __name__ == "__main__":
    main()
