# Mobile Terminal

A self-hosted terminal PWA for accessing your Mac terminal from anywhere via Cloudflare tunnel.

**This is NOT a Claude Code wrapper** - just pure terminal access that works great with anything, including Claude Code.

## Features

- **Terminal** - Full terminal with xterm.js, optimized for mobile
- **Native Keyboard** - Uses your phone's keyboard, not a fake one
- **Mobile Keybar** - Quick access to Ctrl+C, Tab, arrows, etc.
- **File Browser** - Navigate, create folders, download files
- **Preview Tunnel** - Click localhost URLs to preview in-app
- **Memory Tab** - Access claude-mem at localhost:37777
- **PWA** - Install on your homescreen

## Quick Start

```bash
# Install dependencies
npm install

# Create your .env file
cp .env.example .env
# Edit .env to set your password

# Start development
npm run dev
```

Then open http://localhost:5173 in your browser.

## Production

```bash
# Build for production
npm run build

# Start production server
NODE_ENV=production npm start
```

## Cloudflare Tunnel Setup

1. Install cloudflared:
```bash
brew install cloudflared
```

2. Login to Cloudflare:
```bash
cloudflared tunnel login
```

3. Create a tunnel:
```bash
cloudflared tunnel create mobile-terminal
```

4. Configure the tunnel in `~/.cloudflared/config.yml`:
```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /Users/YOUR_USERNAME/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: terminal.yourdomain.com
    service: http://localhost:3456
  - service: http_status:404
```

5. Route DNS:
```bash
cloudflared tunnel route dns mobile-terminal terminal.yourdomain.com
```

6. Run the tunnel:
```bash
cloudflared tunnel run mobile-terminal
```

Now access your terminal at https://terminal.yourdomain.com from anywhere!

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3456 | Server port |
| `TERMINAL_PASSWORD` | terminal123 | Login password |
| `NODE_ENV` | development | Environment mode |
| `SHELL` | /bin/zsh | Shell to spawn |

## Security Notes

- Always set a strong `TERMINAL_PASSWORD`
- Use HTTPS via Cloudflare tunnel
- The file API is restricted to your home directory
- Sessions timeout after 30 minutes of inactivity

## Mobile Tips

- **Tap terminal** to open keyboard
- **Use keybar** for special keys (Ctrl+C, Tab, arrows)
- **Long-press files** for context menu
- **Click localhost URLs** in terminal to preview

## Architecture

```
Phone (PWA)
    ↓ WebSocket
Cloudflare Tunnel
    ↓
Your Laptop
    ├── Express + Socket.io (server)
    ├── node-pty (terminal)
    ├── File API (REST)
    └── Port Proxy (/preview/:port, /memory)
```

## License

MIT
