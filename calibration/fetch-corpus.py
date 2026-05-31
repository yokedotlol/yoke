#!/usr/bin/env python3
"""
Yoke Scoring Calibration — Corpus Collection
Fetches live analysis for 60+ domains from the Yoke API.
"""
import json
import time
import sys
import urllib.request
import urllib.error

DOMAINS = [
    # SaaS/Application
    "stripe.com", "github.com", "notion.so", "slack.com", "figma.com",
    "vercel.com", "linear.app", "supabase.com",
    # Enterprise
    "microsoft.com", "salesforce.com", "oracle.com", "ibm.com", "cisco.com",
    # E-commerce
    "shopify.com", "amazon.com", "etsy.com", "ebay.com",
    # Media/News
    "nytimes.com", "bbc.com", "cnn.com", "theverge.com", "techcrunch.com",
    "arstechnica.com",
    # Government/Institutional
    "usa.gov", "nasa.gov", "whitehouse.gov", "mit.edu", "stanford.edu",
    "harvard.edu",
    # Portfolio/Small
    "yoke.lol", "firetanksoftware.com", "danluu.com", "jvns.ca",
    "paulgraham.com", "marco.org",
    # Infrastructure/CDN
    "cloudflare.com", "fastly.com", "akamai.com",
    # Popular general
    "google.com", "apple.com", "facebook.com", "twitter.com", "reddit.com",
    "wikipedia.org", "youtube.com", "netflix.com", "spotify.com",
    # WordPress
    "wordpress.org", "wired.com",
    # Reference
    "example.com",
    # Additional diversity
    "dropbox.com", "zoom.us", "twitch.tv", "pinterest.com",
    "stackoverflow.com", "medium.com", "gitlab.com",
    "digitalocean.com", "heroku.com", "fly.io",
    "washingtonpost.com", "reuters.com",
    "yale.edu", "berkeley.edu",
    "paypal.com", "square.com",
    "signal.org", "proton.me",
    "arch.dev",
]

def fetch_domain(domain, retry=2):
    url = f"https://yoke.lol/{domain}"
    for attempt in range(retry + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "YokeCalibration/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 30 * (attempt + 1)
                print(f"  429 for {domain}, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
            elif e.code == 504 or e.code == 502:
                wait = 10 * (attempt + 1)
                print(f"  {e.code} for {domain}, retrying in {wait}s...", file=sys.stderr)
                time.sleep(wait)
            else:
                print(f"  HTTP {e.code} for {domain}", file=sys.stderr)
                return None
        except Exception as e:
            print(f"  Error for {domain}: {e}", file=sys.stderr)
            if attempt < retry:
                time.sleep(5)
            else:
                return None
    return None

def main():
    results = {}
    total = len(DOMAINS)
    
    for i, domain in enumerate(DOMAINS):
        print(f"[{i+1}/{total}] Fetching {domain}...", file=sys.stderr)
        data = fetch_domain(domain)
        if data:
            results[domain] = data
            print(f"  ✓ {domain}", file=sys.stderr)
        else:
            print(f"  ✗ {domain} FAILED", file=sys.stderr)
        
        # Rate limit: ~1 req/sec
        if i < total - 1:
            time.sleep(1.5)
    
    print(f"\nFetched {len(results)}/{total} domains", file=sys.stderr)
    
    with open("yoke-public/calibration/corpus-raw.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print("Saved to yoke-public/calibration/corpus-raw.json", file=sys.stderr)

if __name__ == "__main__":
    main()
