#!/bin/bash
# Register a replicant and write the MCP config so Claude Code can play.
# Usage: ./scripts/setup-agent.sh "Bob-1" [server_url]

set -e

NAME="${1:-Bob-1}"
SERVER="${2:-http://localhost:3001}"

echo "Registering replicant: $NAME at $SERVER"
RESULT=$(curl -sf -X POST "$SERVER/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$NAME\"}")

if [ $? -ne 0 ]; then
  echo "Error: Could not connect to $SERVER. Is the server running?"
  echo "  docker compose up --build   OR   npm run test:server"
  exit 1
fi

API_KEY=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['apiKey'])" 2>/dev/null)
SHIP=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['shipName'])" 2>/dev/null)

if [ -z "$API_KEY" ]; then
  echo "Error registering:"
  echo "$RESULT"
  exit 1
fi

echo "Registered: $NAME"
echo "Ship: $SHIP"
echo "API Key: $API_KEY"

# Write .mcp.json
cat > .mcp.json <<EOF
{
  "mcpServers": {
    "homosideria": {
      "type": "url",
      "url": "$SERVER/mcp",
      "headers": {
        "X-API-Key": "$API_KEY"
      }
    }
  }
}
EOF

echo ""
echo "Wrote .mcp.json — Claude Code will auto-detect the Homosideria MCP server."
echo ""
echo "To play: open Claude Code in this directory and say:"
echo '  /homosideria'
echo ""
echo "Or just tell Claude: \"You are a replicant in Homosideria. Use your tools to explore and survive.\""
