#!/bin/bash
# Create a new Replicant and output the MCP config for Claude Code
# Usage: ./scripts/create-replicant.sh "Bob-1" [server_url]

NAME="${1:-Bob-1}"
SERVER="${2:-http://localhost:3001}"

echo "Creating replicant: $NAME"
RESULT=$(curl -s -X POST "$SERVER/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$NAME\"}")

API_KEY=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('apiKey', 'ERROR'))" 2>/dev/null)

if [ "$API_KEY" = "ERROR" ] || [ -z "$API_KEY" ]; then
  echo "Error registering replicant:"
  echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
  exit 1
fi

echo "$RESULT" | python3 -m json.tool

echo ""
echo "=== Claude Code MCP Config ==="
echo "Add to .mcp.json or settings:"
echo ""
cat <<EOF
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
echo "=== Or use this API key with curl ==="
echo "curl $SERVER/api/game/status -H 'X-API-Key: $API_KEY'"
