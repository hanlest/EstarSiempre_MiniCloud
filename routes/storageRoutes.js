/**
 * Rutas de Storage compatibles con la API REST de GCS.
 * Misma firma que usa el backend (PrivateSite) para poder alternar GCS / mini-cloud.
 *
 * 1. GET  /storage/v1/b/:bucket/o/:object         → metadatos (sin ?alt=media) — :object puede ser un segmento (encoded) o usar ruta con *
 * 2. GET  /storage/v1/b/:bucket/o/*objectPath    → objeto con path con barras (users/userId/profile.jpg)
 * 3. GET  /storage/v1/b/:bucket/o?prefix=&pageToken= → listar objetos
 * 4. POST /upload/storage/v1/b/:bucket/o?uploadType=multipart → subir objeto
 * 5. DELETE /storage/v1/b/:bucket/o/:object      → eliminar objeto
 */

import express from 'express';
import {
  getObjectMetadata,
  getObjectMedia,
  listObjects,
  uploadObject,
  deleteObject,
} from '../controllers/storageController.js';

const router = express.Router();

/** Extrae bucket y object del path (Express a veces no rellena req.params en rutas con RegExp) */
function withParamsFromRegex(req, res, next) {
  let bucket = req.params[0];
  let object = req.params[1];
  if (bucket == null || object == null) {
    const match = req.path.match(/^\/storage\/v1\/b\/([^/]+)\/o\/(.*)$/);
    if (match) {
      bucket = match[1];
      object = match[2];
    }
  }
  if (bucket != null && object != null) {
    req.params = { ...req.params, bucket, object };
  }
  next();
}

/**
 * @openapi
 * /storage/v1/b/{bucket}/o:
 *   get:
 *     summary: Listar objetos (compatible GCS)
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: bucket
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *       - in: query
 *         name: pageToken
 *         schema:
 *           type: string
 *       - in: query
 *         name: maxResults
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de objetos (kind, items, nextPageToken)
 */
router.get('/storage/v1/b/:bucket/o', listObjects);

/**
 * GET metadatos o contenido del objeto. Ruta con regex para que :object pueda contener barras.
 * Prefijo /storage para coincidir con backend (STORAGE_API_BASE_URL + /storage/v1 → /storage/storage/v1; mount /storage → path /storage/v1/...).
 */
router.get(/^\/storage\/v1\/b\/([^/]+)\/o\/(.*)$/, withParamsFromRegex, (req, res, next) => {
  if (req.query.alt === 'media') {
    return getObjectMedia(req, res, next);
  }
  return getObjectMetadata(req, res, next);
});

/** DELETE objeto; misma ruta con regex para object con barras */
router.delete(/^\/storage\/v1\/b\/([^/]+)\/o\/(.*)$/, withParamsFromRegex, deleteObject);

export default router;
