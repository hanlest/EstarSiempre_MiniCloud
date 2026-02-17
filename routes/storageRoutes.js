/**
 * Rutas de Storage compatibles con la API REST de GCS.
 * Misma firma que usa el backend (PrivateSite) para poder alternar GCS / mini-cloud.
 *
 * 1. GET  /storage/v1/b/:bucket/o/:object         → metadatos (sin ?alt=media)
 * 2. GET  /storage/v1/b/:bucket/o/:object?alt=media → contenido (opcional Range)
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
router.get('/v1/b/:bucket/o', listObjects);

/**
 * @openapi
 * /storage/v1/b/{bucket}/o/{object}:
 *   get:
 *     summary: Metadatos o contenido del objeto (compatible GCS)
 *     description: Sin ?alt=media devuelve JSON de metadatos. Con ?alt=media devuelve el archivo (soporta Range).
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: bucket
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: object
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre del objeto (puede ir URL-encoded, ej. clips%2Ffile.mp4)
 *       - in: query
 *         name: alt
 *         schema:
 *           type: string
 *           enum: [media]
 *         description: Si es "media", devuelve el contenido del archivo
 *     responses:
 *       200:
 *         description: Metadatos (JSON) o contenido binario
 *       404:
 *         description: Objeto no encontrado
 */
router.get('/v1/b/:bucket/o/:object', (req, res, next) => {
  if (req.query.alt === 'media') {
    return getObjectMedia(req, res, next);
  }
  return getObjectMetadata(req, res, next);
});

/**
 * @openapi
 * /storage/v1/b/{bucket}/o/{object}:
 *   delete:
 *     summary: Eliminar objeto (compatible GCS)
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: bucket
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: object
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Objeto eliminado
 *       404:
 *         description: Objeto no encontrado
 */
router.delete('/v1/b/:bucket/o/:object', deleteObject);

export default router;
