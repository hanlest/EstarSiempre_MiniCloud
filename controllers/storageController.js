/**
 * Controlador de Storage compatible con la API REST de GCS.
 * Expone los 5 endpoints que usa el backend (PrivateSite) con la misma firma y formato de entrada/salida.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// STORAGE_DATA_DIR puede ser absoluta (C:\Cloud\Storage) o relativa; en .env usar C:\\Cloud\\Storage o /ruta para evitar escapes
const rawDataDir = (process.env.STORAGE_DATA_DIR || 'data').replace(/^["']|["']$/g, '').trim();
const DATA_DIR = path.isAbsolute(rawDataDir) ? path.normalize(rawDataDir) : path.resolve(__dirname, '..', rawDataDir);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/** Crea el directorio base de storage al arrancar si no existe (p. ej. C:\\Cloud\\Storage). */
export async function ensureStorageDataDir() {
  await ensureDir(DATA_DIR);
  console.log('[Storage]   DATA_DIR:', DATA_DIR);
}

const objectPathToFs = (bucket, objectName) => {
  const decoded = decodeURIComponent(String(objectName || '').replace(/^\/+/, ''));
  return path.join(DATA_DIR, bucket, decoded);
};

const metaPath = (filePath) => `${filePath}.meta.json`;

async function readMeta(filePath) {
  try {
    const raw = await fs.readFile(metaPath(filePath), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMeta(filePath, contentType, customMetadata) {
  const meta = {
    contentType: contentType || 'application/octet-stream',
    metadata: customMetadata || {}
  };
  await fs.writeFile(metaPath(filePath), JSON.stringify(meta, null, 0), 'utf-8');
}

/** Formato GCS-like para metadata de objeto */
function toGcsObjectMeta(bucket, objectName, stats, contentType, customMetadata) {
  const name = decodeURIComponent(String(objectName || '').replace(/^\/+/, ''));
  const gcs = {
    kind: 'storage#object',
    id: bucket + '/' + name + '/0',
    name: name,
    bucket: bucket,
    contentType: contentType || 'application/octet-stream',
    size: String(stats.size),
    metadata: customMetadata || {},
    updated: stats.mtime ? new Date(stats.mtime).toISOString() : undefined
  };
  return gcs;
}

/** GET /storage/v1/b/:bucket/o/:object — Metadatos del objeto (sin ?alt=media) */
export const getObjectMetadata = async (req, res) => {
  try {
    const { bucket, object: objectName } = req.params;
    console.log('[Storage]   GET metadata — bucket:', bucket, 'object:', objectName);
    const filePath = objectPathToFs(bucket, objectName);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found' }
      });
    }
    const meta = await readMeta(filePath);
    const gcs = toGcsObjectMeta(bucket, objectName, stat, meta?.contentType, meta?.metadata);
    res.json(gcs);
  } catch (err) {
    console.error('getObjectMetadata:', err);
    res.status(500).json({ error: { code: 500, message: err.message } });
  }
};

/** GET /storage/v1/b/:bucket/o/:object?alt=media — Contenido del objeto (opcional Range) */
export const getObjectMedia = async (req, res) => {
  try {
    const { bucket, object: objectName } = req.params;
    console.log('[Storage]   GET media — bucket:', bucket, 'object:', objectName);
    const filePath = objectPathToFs(bucket, objectName);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return res.status(404).send('Not Found');
    }
    const meta = await readMeta(filePath);
    const contentType = meta?.contentType || 'application/octet-stream';
    const size = stat.size;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : size - 1;
        const len = end - start + 1;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', len);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
        res.status(206);
        const buf = await fs.readFile(filePath);
        res.send(buf.subarray(start, end + 1));
        return;
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const buf = await fs.readFile(filePath);
    res.send(buf);
  } catch (err) {
    console.error('getObjectMedia:', err);
    if (!res.headersSent) res.status(500).send(err.message);
  }
};

/** GET /storage/v1/b/:bucket/o?prefix=...&pageToken=... — Listar objetos */
export const listObjects = async (req, res) => {
  try {
    const { bucket } = req.params;
    const prefix = (req.query.prefix || '').replace(/\/+$/, '');
    const pageToken = req.query.pageToken || null;
    const maxResults = Math.min(parseInt(req.query.maxResults, 10) || 1000, 1000);

    const bucketDir = path.join(DATA_DIR, bucket);
    try {
      await fs.access(bucketDir);
    } catch {
      return res.json({ kind: 'storage#objects', items: [], nextPageToken: null });
    }

    const collected = [];
    async function walk(dir, basePath) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const rel = basePath ? `${basePath}/${e.name}` : e.name;
        if (prefix && !rel.startsWith(prefix)) continue;
        if (e.isDirectory()) {
          await walk(path.join(dir, e.name), rel);
        } else if (e.isFile() && !e.name.endsWith('.meta.json')) {
          const fullPath = path.join(dir, e.name);
          const stat = await fs.stat(fullPath).catch(() => null);
          const meta = await readMeta(fullPath);
          collected.push({
            kind: 'storage#object',
            id: `${bucket}/${rel}/0`,
            name: rel,
            bucket,
            contentType: meta?.contentType || 'application/octet-stream',
            size: String(stat?.size || 0),
            metadata: meta?.metadata || {},
            updated: stat?.mtime ? new Date(stat.mtime).toISOString() : undefined
          });
        }
      }
    }
    await walk(bucketDir, '');

    collected.sort((a, b) => a.name.localeCompare(b.name));
    let start = 0;
    if (pageToken) {
      const idx = collected.findIndex((o) => o.name === pageToken);
      start = idx < 0 ? 0 : idx + 1;
    }
    const page = collected.slice(start, start + maxResults);
    const nextPageToken = start + maxResults < collected.length ? page[page.length - 1]?.name : null;

    res.json({
      kind: 'storage#objects',
      items: page,
      nextPageToken: nextPageToken || undefined
    });
  } catch (err) {
    console.error('listObjects:', err);
    res.status(500).json({ error: { code: 500, message: err.message } });
  }
};

/** POST /upload/storage/v1/b/:bucket/o?uploadType=multipart — Subir objeto (multipart/related) */
export const uploadObject = async (req, res) => {
  try {
    const { bucket } = req.params;
    const contentTypeHeader = req.headers['content-type'] || '';
    const boundaryMatch = contentTypeHeader.match(/boundary=([^;\s]+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: { code: 400, message: 'Missing multipart boundary' } });
    }
    const boundary = boundaryMatch[1].trim();
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || raw.length === 0) {
      return res.status(400).json({ error: { code: 400, message: 'Empty body' } });
    }

    const delim = Buffer.from(`\r\n--${boundary}`, 'utf-8');
    const parts = [];
    let start = 0;
    const firstBoundary = Buffer.from(`--${boundary}\r\n`, 'utf-8');
    const firstIdx = raw.indexOf(firstBoundary);
    if (firstIdx !== -1) {
      start = firstIdx + firstBoundary.length;
    }
    while (start < raw.length) {
      const idx = raw.indexOf(delim, start);
      if (idx === -1) break;
      parts.push(raw.subarray(start, idx));
      start = idx + delim.length;
      if (raw.subarray(start, start + 2).toString() === '--') break;
    }
    if (start < raw.length && parts.length > 0) {
      const tail = raw.subarray(start);
      const closing = Buffer.from(`--${boundary}--`, 'utf-8');
      const endMark = tail.indexOf(closing);
      if (endMark !== -1) parts.push(tail.subarray(0, endMark));
      else parts.push(tail);
    }
    let metaPart = null;
    let bodyPart = null;
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      const headerEnd = chunk.indexOf(Buffer.from('\r\n\r\n', 'utf-8'));
      if (headerEnd === -1) continue;
      const headers = chunk.subarray(0, headerEnd).toString('utf-8');
      const rest = chunk.subarray(headerEnd + 4);
      if (headers.includes('application/json')) {
        const end = rest.indexOf(Buffer.from('\r\n', 'utf-8'));
        const body = end >= 0 ? rest.subarray(0, end) : rest;
        try {
          metaPart = JSON.parse(body.toString('utf-8'));
        } catch (_) {}
      } else if (headers.includes('Content-Type:') && rest.length > 0) {
        bodyPart = rest;
      }
    }
    if (!metaPart || !metaPart.name) {
      return res.status(400).json({ error: { code: 400, message: 'Invalid multipart: missing JSON part with name' } });
    }
    if (!bodyPart) {
      return res.status(400).json({ error: { code: 400, message: 'Invalid multipart: missing content part' } });
    }
    const len = bodyPart.length;
    if (len >= 2 && bodyPart[len - 2] === 0x0d && bodyPart[len - 1] === 0x0a) {
      bodyPart = bodyPart.subarray(0, len - 2);
    }

    const objectName = metaPart.name;
    const filePath = objectPathToFs(bucket, objectName);
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, bodyPart);
    await writeMeta(filePath, metaPart.contentType || 'application/octet-stream', metaPart.metadata || {});

    const stat = await fs.stat(filePath);
    const gcs = toGcsObjectMeta(bucket, objectName, stat, metaPart.contentType, metaPart.metadata);
    res.status(200).json(gcs);
  } catch (err) {
    console.error('uploadObject:', err);
    res.status(500).json({ error: { code: 500, message: err.message } });
  }
};

/** DELETE /storage/v1/b/:bucket/o/:object — Eliminar objeto */
export const deleteObject = async (req, res) => {
  try {
    const { bucket, object: objectName } = req.params;
    const filePath = objectPathToFs(bucket, objectName);
    try {
      await fs.unlink(filePath);
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).send();
      throw e;
    }
    await fs.unlink(metaPath(filePath)).catch(() => {});
    res.status(204).send();
  } catch (err) {
    console.error('deleteObject:', err);
    if (!res.headersSent) res.status(500).json({ error: { code: 500, message: err.message } });
  }
};
