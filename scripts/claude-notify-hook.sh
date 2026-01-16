#!/bin/bash
# Terminal Tunnel - Claude Code Stop Hook
#
# This script is called by Claude Code's stop hook to send push notifications
# when Claude finishes responding and is awaiting user input.
#
# Installation:
# 1. Copy this script to ~/.terminal-tunnel/notify-hook.sh
# 2. Make it executable: chmod +x ~/.terminal-tunnel/notify-hook.sh
# 3. Add to your Claude Code settings (~/.config/claude/settings.json):
#    {
#      "hooks": {
#        "Stop": [{
#          "matcher": "*",
#          "hooks": [{
#            "type": "command",
#            "command": "~/.terminal-tunnel/notify-hook.sh"
#          }]
#        }]
#      }
#    }

# Read stdin for hook context (contains session info)
# Claude Code passes JSON with session_id, transcript_path, cwd, etc.
HOOK_INPUT=$(cat)

# Extract session ID if available (requires jq)
if command -v jq &> /dev/null; then
    SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
fi

# Get the Terminal Tunnel server URL from environment or default
SERVER_URL="${TERMINAL_TUNNEL_URL:-http://localhost:3456}"

# Send notification request in background (don't block Claude)
# The server will broadcast to all subscribed mobile devices
curl -s -X POST "$SERVER_URL/api/notify" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"stop\",\"sessionId\":\"${SESSION_ID:-unknown}\",\"message\":\"Claude is awaiting your input\"}" \
  >/dev/null 2>&1 &

# Exit immediately - don't block Claude Code
exit 0
