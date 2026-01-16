import { Express, Request, Response, RequestHandler } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import multer from 'multer';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  isHidden: boolean;
}

// Validate path to prevent directory traversal
function validatePath(requestedPath: string): string | null {
  const normalized = path.normalize(requestedPath);

  // Block obvious traversal attempts
  if (normalized.includes('..')) {
    return null;
  }

  // Ensure path starts with home directory or common safe paths
  const home = os.homedir();
  const safePaths = [home, '/tmp', '/var/tmp'];

  const isUnderSafePath = safePaths.some(safePath =>
    normalized === safePath || normalized.startsWith(safePath + path.sep)
  );

  if (!isUnderSafePath) {
    return null;
  }

  return normalized;
}

export function setupFileApi(app: Express, authMiddleware: RequestHandler): void {
  // List directory contents
  app.get('/api/files/list', authMiddleware, async (req: Request, res: Response) => {
    try {
      const requestedPath = (req.query.path as string) || os.homedir();
      const validPath = validatePath(requestedPath);

      if (!validPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const entries = await fs.readdir(validPath, { withFileTypes: true });
      const files: FileEntry[] = [];

      for (const entry of entries) {
        try {
          const fullPath = path.join(validPath, entry.name);
          const stats = await fs.stat(fullPath);

          files.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stats.size,
            mtime: stats.mtimeMs,
            isHidden: entry.name.startsWith('.')
          });
        } catch {
          // Skip files we can't stat (permission errors, etc.)
        }
      }

      res.json({
        path: validPath,
        parent: path.dirname(validPath),
        entries: files
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'Directory not found' });
      } else if (err.code === 'EACCES') {
        res.status(403).json({ error: 'Permission denied' });
      } else {
        res.status(500).json({ error: 'Failed to list directory' });
      }
    }
  });

  // Read file contents
  app.get('/api/files/read', authMiddleware, async (req: Request, res: Response) => {
    try {
      const requestedPath = req.query.path as string;
      if (!requestedPath) {
        res.status(400).json({ error: 'Path required' });
        return;
      }

      const validPath = validatePath(requestedPath);
      if (!validPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const stats = await fs.stat(validPath);

      // Limit file size to 5MB for reading
      if (stats.size > 5 * 1024 * 1024) {
        res.status(413).json({ error: 'File too large to read' });
        return;
      }

      const content = await fs.readFile(validPath, 'utf-8');
      res.json({ path: validPath, content });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.status(500).json({ error: 'Failed to read file' });
      }
    }
  });

  // Write file contents
  app.post('/api/files/write', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { path: requestedPath, content } = req.body;

      if (!requestedPath || content === undefined) {
        res.status(400).json({ error: 'Path and content required' });
        return;
      }

      const validPath = validatePath(requestedPath);
      if (!validPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      await fs.writeFile(validPath, content, 'utf-8');
      res.json({ success: true, path: validPath });
    } catch (error) {
      res.status(500).json({ error: 'Failed to write file' });
    }
  });

  // Create directory
  app.post('/api/files/mkdir', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { path: requestedPath } = req.body;

      if (!requestedPath) {
        res.status(400).json({ error: 'Path required' });
        return;
      }

      const validPath = validatePath(requestedPath);
      if (!validPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      await fs.mkdir(validPath, { recursive: true });
      res.json({ success: true, path: validPath });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create directory' });
    }
  });

  // Upload files
  // Configure multer to store files temporarily
  const upload = multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (_req, file, cb) => {
        // Use unique temp filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
      }
    }),
    limits: {
      fileSize: 100 * 1024 * 1024 // 100MB limit per file
    }
  });

  app.post('/api/files/upload', authMiddleware, upload.array('files', 20), async (req: Request, res: Response) => {
    try {
      const targetPath = req.body.path;
      if (!targetPath) {
        res.status(400).json({ error: 'Target path required' });
        return;
      }

      const validPath = validatePath(targetPath);
      if (!validPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
      }

      const uploaded: { name: string; path: string; size: number }[] = [];

      for (const file of files) {
        const destPath = path.join(validPath, file.originalname);

        // Move file from temp to destination
        await fs.rename(file.path, destPath);

        uploaded.push({
          name: file.originalname,
          path: destPath,
          size: file.size
        });
      }

      res.json({ success: true, files: uploaded });
    } catch (error) {
      // Clean up temp files on error
      const files = req.files as Express.Multer.File[] | undefined;
      if (files) {
        for (const file of files) {
          try {
            await fs.unlink(file.path);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
      res.status(500).json({ error: 'Failed to upload files' });
    }
  });

  // Terminal upload - uploads file to configurable path (default: ~/Desktop/TerminalTunnel/)
  app.post('/api/terminal-upload', authMiddleware, upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // Get custom path from request or use default
      const uploadPath = req.body.uploadPath || 'Desktop/TerminalTunnel';
      const home = os.homedir();
      const uploadDir = path.join(home, uploadPath);

      // Validate path is under home directory (security)
      const normalizedPath = path.normalize(uploadDir);
      if (!normalizedPath.startsWith(home + path.sep) && normalizedPath !== home) {
        res.status(403).json({ error: 'Invalid upload path' });
        return;
      }

      // Create directory if it doesn't exist
      await fs.mkdir(uploadDir, { recursive: true });

      // Generate unique filename to avoid collisions
      const timestamp = Date.now();
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const finalName = `${safeBaseName}_${timestamp}${ext}`;

      const destPath = path.join(uploadDir, finalName);

      // Move file from temp to destination
      await fs.rename(file.path, destPath);

      res.json({
        success: true,
        filePath: destPath,
        fileName: finalName
      });
    } catch (error) {
      // Clean up temp file on error
      const file = req.file;
      if (file) {
        try {
          await fs.unlink(file.path);
        } catch { /* ignore cleanup errors */ }
      }
      console.error('Terminal upload error:', error);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  });

  // Delete file or directory
  app.delete('/api/files/delete', authMiddleware, async (req: Request, res: Response) => {
    try {
      const requestedPath = req.query.path as string;

      if (!requestedPath) {
        res.status(400).json({ error: 'Path required' });
        return;
      }

      const validPath = validatePath(requestedPath);
      if (!validPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Extra safety: don't allow deleting home directory or root
      if (validPath === os.homedir() || validPath === '/') {
        res.status(403).json({ error: 'Cannot delete this directory' });
        return;
      }

      const stats = await fs.stat(validPath);
      if (stats.isDirectory()) {
        await fs.rm(validPath, { recursive: true });
      } else {
        await fs.unlink(validPath);
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete' });
    }
  });

  // Rename file or directory
  app.post('/api/files/rename', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { oldPath, newName } = req.body;

      if (!oldPath || !newName) {
        res.status(400).json({ error: 'Old path and new name required' });
        return;
      }

      // Validate the new name doesn't contain path separators
      if (newName.includes('/') || newName.includes('\\')) {
        res.status(400).json({ error: 'Invalid file name' });
        return;
      }

      const validOldPath = validatePath(oldPath);
      if (!validOldPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Construct new path (same directory, new name)
      const parentDir = path.dirname(validOldPath);
      const newPath = path.join(parentDir, newName);

      const validNewPath = validatePath(newPath);
      if (!validNewPath) {
        res.status(403).json({ error: 'Invalid new name' });
        return;
      }

      // Check if new path already exists
      try {
        await fs.access(validNewPath);
        res.status(409).json({ error: 'A file with that name already exists' });
        return;
      } catch {
        // Good - file doesn't exist
      }

      await fs.rename(validOldPath, validNewPath);
      res.json({ success: true, path: validNewPath });
    } catch (error) {
      res.status(500).json({ error: 'Failed to rename' });
    }
  });

  // Download file
  app.get('/api/files/download', authMiddleware, async (req: Request, res: Response) => {
    try {
      const requestedPath = req.query.path as string;

      if (!requestedPath) {
        res.status(400).json({ error: 'Path required' });
        return;
      }

      const validPath = validatePath(requestedPath);
      if (!validPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const stats = await fs.stat(validPath);
      if (stats.isDirectory()) {
        res.status(400).json({ error: 'Cannot download directory' });
        return;
      }

      res.download(validPath);
    } catch (error) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  });

  // Get shortcuts (common directories)
  app.get('/api/files/shortcuts', authMiddleware, (req: Request, res: Response) => {
    const home = os.homedir();

    res.json({
      shortcuts: [
        { name: 'Home', path: home, icon: 'home' },
        { name: 'Desktop', path: path.join(home, 'Desktop'), icon: 'desktop' },
        { name: 'Downloads', path: path.join(home, 'Downloads'), icon: 'download' },
        { name: 'Projects', path: path.join(home, 'Projects'), icon: 'code' }
      ]
    });
  });
}
