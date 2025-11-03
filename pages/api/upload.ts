import { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // For now, use local storage (FTP implementation later)
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');

    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      filter: (part) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        return allowedTypes.includes(part.mimetype || '');
      }
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error('Form parsing error:', err);
        return res.status(500).json({ error: 'Failed to parse form data' });
      }

      const file = files.file?.[0] as formidable.File;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Generate unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const originalName = file.originalFilename || 'unknown';
      const extension = path.extname(originalName);
      const baseName = path.basename(originalName, extension).replace(/[^a-zA-Z0-9]/g, '_');
      const uniqueName = `${baseName}_${timestamp}_${random}${extension}`;

      const oldPath = file.filepath;
      const newPath = path.join(uploadDir, uniqueName);

      // Move file to final location
      fs.rename(oldPath, newPath, (err) => {
        if (err) {
          console.error('File move error:', err);
          return res.status(500).json({ error: 'Failed to save file' });
        }

        // Clean up temp file
        fs.unlink(oldPath, (unlinkErr) => {
          if (unlinkErr) {
            console.warn('Failed to clean up temp file:', unlinkErr);
          }
        });

        // Return local URL for now (FTP will change this to Hostinger URL)
        const url = `/uploads/${uniqueName}`;
        res.status(200).json({
          success: true,
          url: url,
          filename: uniqueName,
          originalName: originalName,
          size: file.size,
          mimetype: file.mimetype
        });
      });
    });

  } catch (error) {
    console.error('Upload handler error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
