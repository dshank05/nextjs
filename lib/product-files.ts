import type { NextApiRequest } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { Client } from 'basic-ftp';

/**
 * Product image and barcode files: parse the multipart form, upload to the
 * Hostinger FTP, delete a replaced file. One copy (PQ-54) - these were written
 * out twice, in products/index.ts and products/[id].ts, and the two parsers
 * already differed.
 */

const UPLOAD_DIR = '/public_html/uploads';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function connect(): Promise<Client> {
  const client = new Client();
  await client.access({
    host: process.env.FTP_HOST,
    port: parseInt(process.env.FTP_PORT || '', 10) || 21,
    user: process.env.FTP_USERNAME,
    password: process.env.FTP_PASSWORD,
    secure: false
  });
  return client;
}

/** The multipart body: `productData` (JSON) plus optional `image` and `barcode` files. */
export function parseProductForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024,
      filter: (part) => ALLOWED_TYPES.includes(part.mimetype || '')
    });
    const timeout = setTimeout(() => reject(new Error('Form parsing timed out after 30s')), 30000);
    form.parse(req, (err, fields, files) => {
      clearTimeout(timeout);
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

/** The parsed `productData` JSON, or null if it is missing or malformed. */
export function readProductData(fields: formidable.Fields): any | null {
  const raw = Array.isArray(fields.productData) ? fields.productData[0] : fields.productData;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Upload a file; returns its public URL. Throws on failure. */
export async function uploadProductFile(file: formidable.File): Promise<string> {
  const client = await connect();
  try {
    await client.ensureDir(UPLOAD_DIR);
    const original = file.originalFilename || 'unknown';
    const ext = path.extname(original);
    const base = path.basename(original, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const name = `${base}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    await client.uploadFrom(file.filepath, `${UPLOAD_DIR}/${name}`);
    fs.unlink(file.filepath, (err) => {
      if (err) console.error('Failed to remove temp upload file:', file.filepath, err);
    });
    return `${process.env.HOSTINGER_DOMAIN || 'https://baijnathsons.com'}/uploads/${name}`;
  } finally {
    client.close();
  }
}

/**
 * Delete a stored file by its URL. Best effort: a file that is already gone is
 * not an error, and a failure is logged rather than failing the request.
 */
export async function deleteProductFile(fileUrl: string): Promise<void> {
  const filename = fileUrl.split('/').pop();
  if (!filename) return;
  let client: Client | null = null;
  try {
    client = await connect();
    await client.remove(`${UPLOAD_DIR}/${filename}`);
  } catch (error) {
    console.error('Could not delete product file:', fileUrl, error);
  } finally {
    client?.close();
  }
}
