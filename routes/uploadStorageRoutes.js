/**
 * Ruta de subida (POST) compatible con GCS: multipart/related.
 * POST /upload/storage/v1/b/:bucket/o?uploadType=multipart
 */

import express from 'express';
import { uploadObject } from '../controllers/storageController.js';

const router = express.Router();

/**
 * @openapi
 * /upload/storage/v1/b/{bucket}/o:
 *   post:
 *     summary: Subir objeto (compatible GCS, multipart/related)
 *     description: Body multipart/related; primera parte JSON con name, contentType, metadata; segunda parte binaria.
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: bucket
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: uploadType
 *         schema:
 *           type: string
 *           example: multipart
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/related:
 *           schema:
 *             type: string
 *             format: binary
 *     responses:
 *       200:
 *         description: Objeto creado (JSON en formato GCS)
 *       400:
 *         description: Boundary o partes inválidas
 */
router.post('/storage/v1/b/:bucket/o', uploadObject);

export default router;
