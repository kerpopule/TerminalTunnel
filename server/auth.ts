import { Request, Response, NextFunction, Express } from 'express';
import crypto from 'crypto';

export const AUTH_COOKIE_NAME = 'mt_auth';

// Default password if not set in environment
const DEFAULT_PASSWORD = 'terminal123';
const PASSWORD = process.env.TERMINAL_PASSWORD || DEFAULT_PASSWORD;

// Skip auth in development mode for easier testing
const SKIP_AUTH_IN_DEV = process.env.NODE_ENV !== 'production';

// Generate a session token
const AUTH_TOKEN = process.env.AUTH_TOKEN || crypto.randomBytes(32).toString('hex');

// Store the token for validation
process.env.AUTH_TOKEN = AUTH_TOKEN;

export function setupAuth(app: Express): void {
  // Login page (serves static HTML for simplicity)
  app.get('/login', (req: Request, res: Response) => {
    // Check if already authenticated
    if (req.cookies[AUTH_COOKIE_NAME] === AUTH_TOKEN) {
      return res.redirect('/');
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <meta name="theme-color" content="#1a1a2e">
        <title>Terminal Tunnel - Login</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .login-container {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 40px;
            width: 100%;
            max-width: 360px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          h1 {
            color: #fff;
            font-size: 24px;
            margin-bottom: 8px;
            text-align: center;
          }
          .subtitle {
            color: rgba(255, 255, 255, 0.6);
            font-size: 14px;
            text-align: center;
            margin-bottom: 32px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            color: rgba(255, 255, 255, 0.8);
            font-size: 14px;
            margin-bottom: 8px;
          }
          input[type="password"] {
            width: 100%;
            padding: 14px 16px;
            font-size: 16px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.3);
            color: #fff;
            outline: none;
            transition: border-color 0.2s;
          }
          input[type="password"]:focus {
            border-color: #4f46e5;
          }
          button {
            width: 100%;
            padding: 14px;
            font-size: 16px;
            font-weight: 600;
            color: #fff;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: transform 0.1s, box-shadow 0.2s;
          }
          button:hover {
            box-shadow: 0 4px 20px rgba(79, 70, 229, 0.4);
          }
          button:active {
            transform: scale(0.98);
          }
          .error {
            color: #ef4444;
            font-size: 14px;
            text-align: center;
            margin-top: 16px;
            display: none;
          }
          .terminal-icon {
            font-size: 48px;
            text-align: center;
            margin-bottom: 16px;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <div class="terminal-icon">></div>
          <h1>Terminal Tunnel</h1>
          <p class="subtitle">Enter password to continue</p>
          <form method="POST" action="/api/auth/login">
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required autofocus autocomplete="current-password">
            </div>
            <button type="submit">Login</button>
            <p class="error" id="error">Invalid password</p>
          </form>
        </div>
        <script>
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('error') === '1') {
            document.getElementById('error').style.display = 'block';
          }
        </script>
      </body>
      </html>
    `);
  });

  // Login endpoint
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { password } = req.body;

    if (password === PASSWORD) {
      res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
      res.redirect('/');
    } else {
      res.redirect('/login?error=1');
    }
  });

  // Logout endpoint
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    res.clearCookie(AUTH_COOKIE_NAME);
    res.redirect('/login');
  });

  // Check auth status
  app.get('/api/auth/status', (req: Request, res: Response) => {
    const isAuthenticated = req.cookies[AUTH_COOKIE_NAME] === AUTH_TOKEN;
    res.json({ authenticated: isAuthenticated });
  });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in development mode
  if (SKIP_AUTH_IN_DEV) {
    return next();
  }

  const token = req.cookies[AUTH_COOKIE_NAME];

  // Skip auth for login page and static assets
  if (req.path === '/login' || req.path.startsWith('/api/auth/')) {
    return next();
  }

  if (!token || token !== AUTH_TOKEN) {
    // For API requests, return 401
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    // For page requests, redirect to login
    res.redirect('/login');
    return;
  }

  next();
}
