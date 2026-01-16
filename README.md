# Terminal Tunnel 🚇

A modern, web-based terminal emulator that lets you access your terminal from anywhere. Built with React, TypeScript, and Node.js, with optional desktop app support via Tauri.

## Features

### Web Application
- 🌐 **Access Anywhere** - Use your terminal from any device with a browser
- 🔒 **Secure** - PIN lock protection and authentication middleware
- 📱 **Responsive** - Works on desktop, tablet, and mobile devices
- 🎨 **Customizable** - Multiple themes and appearance settings
- 📂 **File Management** - Built-in file browser and operations
- 🔄 **Real-time** - WebSocket-based communication for instant updates
- 📊 **Memory Monitoring** - Built-in memory usage viewer
- 🔗 **Port Proxying** - Tunnel local ports through Cloudflare

### Desktop Application
- 💻 **Native Performance** - Tauri-based desktop app with Rust backend
- 🔔 **System Integration** - Native notifications and system tray
- 📦 **Portable** - Bundled Node.js runtime included
- 🚀 **Fast Startup** - Quick launch and low resource usage

## Technology Stack

**Frontend:**
- React 18 with TypeScript
- Vite for fast development and building
- xterm.js for terminal emulation
- Socket.io for real-time communication
- PWA support for offline capability

**Backend:**
- Node.js + Express
- Socket.io server
- node-pty for pseudo-terminal management
- HTTP proxy for port forwarding

**Desktop:**
- Tauri 2.9 (Rust framework)
- Bundled Node.js runtime
- Cross-platform (Windows, macOS, Linux)

## Installation

### Prerequisites
- Node.js 18+ and npm
- Git

### Web Application Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/kerpopule/TerminalTunnel.git
   cd TerminalTunnel
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the application**
   ```bash
   npm run build
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Access the application**
   - Open your browser to `http://localhost:3001`
   - Default port is 3001 (configurable in server/index.ts)

### Desktop Application Setup

1. **Complete web application setup first** (steps 1-2 above)

2. **Install Rust** (required for Tauri)
   - Visit [rustup.rs](https://rustup.rs/) and follow instructions

3. **Build the desktop app**
   ```bash
   npm run tauri:build
   ```

4. **Run the desktop app**
   - Find the installer in `src-tauri/target/release/`
   - Install and launch the application

### Development Mode

**Web application (with hot reload):**
```bash
npm run dev
```

**Desktop application (with hot reload):**
```bash
npm run tauri:dev
```

## Usage

### First Launch
1. Application starts with a default terminal tab
2. Configure settings via the settings panel (gear icon)
3. Set up PIN lock for additional security (optional)

### Key Features

**Multiple Tabs:**
- Open multiple terminal sessions simultaneously
- Switch between tabs with keyboard shortcuts or clicks
- Each tab maintains independent session state

**File Browser:**
- Access via the file manager icon
- Navigate your file system
- Upload/download files
- Edit files directly in browser

**Port Proxying:**
- Expose local ports to the internet via Cloudflare tunnel
- Access local development servers remotely
- Automatic tunnel setup and management

**Themes:**
- Choose from multiple built-in themes
- Customize colors and appearance
- Settings persist across sessions

### Keyboard Shortcuts
- `Ctrl+C` - Copy (in terminal)
- `Ctrl+V` - Paste (in terminal)
- `Ctrl+Shift+T` - New tab
- `Ctrl+Shift+W` - Close tab

## Configuration

### Server Configuration
Edit `server/index.ts` to configure:
- Port number (default: 3001)
- Authentication settings
- CORS policy
- WebSocket options

### Client Configuration
Settings available in the UI:
- Terminal theme
- Font size and family
- Cursor style
- Tab persistence
- PIN lock settings

## Project Structure

```
Terminal Tunnel/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── contexts/           # React contexts
│   ├── hooks/              # Custom hooks
│   ├── utils/              # Utilities
│   └── themes/             # Theme definitions
├── server/                 # Node.js backend
│   ├── index.ts            # Server entry point
│   ├── pty-manager.ts      # Terminal management
│   ├── auth.ts             # Authentication
│   └── file-api.ts         # File operations
├── src-tauri/              # Desktop app (Tauri/Rust)
│   ├── src/                # Rust source
│   └── Cargo.toml          # Rust config
├── scripts/                # Build scripts
├── public/                 # Static assets
└── package.json            # Project config
```

## Security Considerations

- **PIN Lock**: Enable PIN lock for additional authentication
- **HTTPS**: Use HTTPS in production environments
- **Authentication**: Server includes auth middleware
- **File Access**: File operations are sandboxed to user permissions
- **Port Proxying**: Cloudflare tunnel provides secure access

## Troubleshooting

### Build Issues
- **Node version**: Ensure Node.js 18+ is installed
- **Dependencies**: Try removing `node_modules/` and `package-lock.json`, then run `npm install` again
- **TypeScript errors**: Run `npm run build` to see detailed compilation errors

### Runtime Issues
- **Port already in use**: Change the port in `server/index.ts`
- **WebSocket connection fails**: Check firewall settings and CORS configuration
- **Terminal not responding**: Check browser console for errors, restart server

### Desktop App Issues
- **Rust not found**: Install Rust from [rustup.rs](https://rustup.rs/)
- **Build fails**: Ensure all dependencies are installed with `npm install`
- **App won't launch**: Check `src-tauri/target/release/` for error logs

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under a **Non-Commercial License**. You are free to use, modify, and distribute this software for non-commercial purposes. Commercial use requires explicit permission from the author.

See the LICENSE file for details.

## Acknowledgments

- Built with [React](https://react.dev/)
- Terminal emulation by [xterm.js](https://xtermjs.org/)
- Desktop framework by [Tauri](https://tauri.app/)
- Real-time communication via [Socket.io](https://socket.io/)

## Support

For issues, questions, or suggestions, please open an issue on GitHub: [https://github.com/kerpopule/TerminalTunnel/issues](https://github.com/kerpopule/TerminalTunnel/issues)

---

Made with ❤️ for developers who want terminal access anywhere
