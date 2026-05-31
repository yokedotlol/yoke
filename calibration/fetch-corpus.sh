#!/bin/bash
# Fetch corpus using curl (handles large responses better)
# Extracts only the scoring-relevant fields to keep files manageable

DOMAINS=(
    stripe.com github.com notion.so slack.com figma.com vercel.com linear.app supabase.com
    microsoft.com salesforce.com oracle.com ibm.com cisco.com
    shopify.com amazon.com etsy.com ebay.com
    nytimes.com bbc.com cnn.com theverge.com techcrunch.com arstechnica.com
    usa.gov nasa.gov whitehouse.gov mit.edu stanford.edu harvard.edu
    yoke.lol firetanksoftware.com danluu.com jvns.ca paulgraham.com marco.org
    cloudflare.com fastly.com akamai.com
    google.com apple.com facebook.com twitter.com reddit.com wikipedia.org youtube.com netflix.com spotify.com
    wordpress.org wired.com
    example.com
    dropbox.com zoom.us twitch.tv pinterest.com stackoverflow.com medium.com gitlab.com
    digitalocean.com heroku.com fly.io
    washingtonpost.com reuters.com
    yale.edu berkeley.edu
    paypal.com square.com
    signal.org proton.me
)

OUTDIR="yoke-public/calibration/raw"
mkdir -p "$OUTDIR"

total=${#DOMAINS[@]}
i=0

for domain in "${DOMAINS[@]}"; do
    i=$((i + 1))
    outfile="$OUTDIR/${domain}.json"
    
    if [ -f "$outfile" ] && [ -s "$outfile" ]; then
        echo "[$i/$total] SKIP $domain (already fetched)"
        continue
    fi
    
    echo -n "[$i/$total] $domain... "
    
    # Use curl with longer timeout and compressed transfer
    if curl -s --compressed --max-time 60 "https://yoke.lol/$domain" -o "$outfile" 2>/dev/null; then
        # Verify it's valid JSON
        if python3 -c "import json; json.load(open('$outfile'))" 2>/dev/null; then
            size=$(wc -c < "$outfile")
            echo "✓ (${size} bytes)"
        else
            echo "✗ (invalid JSON)"
            rm -f "$outfile"
        fi
    else
        echo "✗ (curl failed)"
        rm -f "$outfile"
    fi
    
    # Rate limit
    sleep 1.2
done

echo ""
echo "Fetched $(ls "$OUTDIR"/*.json 2>/dev/null | wc -l)/$total domains"
