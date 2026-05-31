#!/bin/bash
# Parallel corpus fetcher — runs 4 curl processes at a time
# Skips already-fetched domains

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
MAX_PARALLEL=4

fetch_one() {
    local domain="$1"
    local outfile="$OUTDIR/${domain}.json"
    
    if [ -f "$outfile" ] && [ -s "$outfile" ]; then
        # Verify existing is valid JSON
        if python3 -c "import json; json.load(open('$outfile'))" 2>/dev/null; then
            echo "SKIP $domain"
            return 0
        fi
    fi
    
    for attempt in 1 2 3; do
        if curl -s --compressed --max-time 90 --retry 2 "https://yoke.lol/$domain" -o "$outfile" 2>/dev/null; then
            if python3 -c "import json; json.load(open('$outfile'))" 2>/dev/null; then
                echo "OK   $domain ($(wc -c < "$outfile") bytes)"
                return 0
            fi
        fi
        sleep $((attempt * 5))
    done
    
    echo "FAIL $domain"
    rm -f "$outfile"
    return 1
}

export -f fetch_one
export OUTDIR

# Run in parallel batches
running=0
pids=()
domains_queue=("${DOMAINS[@]}")

for domain in "${domains_queue[@]}"; do
    fetch_one "$domain" &
    pids+=($!)
    running=$((running + 1))
    
    if [ $running -ge $MAX_PARALLEL ]; then
        # Wait for any one to finish
        wait -n 2>/dev/null || wait "${pids[0]}"
        running=$((running - 1))
        # Clean up finished pids
        new_pids=()
        for pid in "${pids[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                new_pids+=("$pid")
            fi
        done
        pids=("${new_pids[@]}")
    fi
    
    # Stagger slightly to not slam the API
    sleep 0.5
done

# Wait for remaining
wait

echo ""
echo "=== DONE ==="
echo "Fetched: $(ls "$OUTDIR"/*.json 2>/dev/null | wc -l) / ${#DOMAINS[@]} domains"
