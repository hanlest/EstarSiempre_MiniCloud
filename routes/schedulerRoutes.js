import express from 'express';
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  runJob,
} from '../controllers/schedulerController.js';

const router = express.Router();

/**
 * @openapi
 * /scheduler/jobs:
 *   get:
 *     summary: Lista todos los jobs (compatible GCP)
 *     tags: [Scheduler]
 *     responses:
 *       200:
 *         description: Lista de jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 jobs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       schedule:
 *                         type: string
 *                       timeZone:
 *                         type: string
 *                       state:
 *                         type: string
 *                       lastAttemptTime:
 *                         type: string
 *                         nullable: true
 *                       httpTarget:
 *                         type: object
 *                         properties:
 *                           uri:
 *                             type: string
 *                           httpMethod:
 *                             type: string
 */
router.get('/jobs', listJobs);

/**
 * @openapi
 * /scheduler/jobs/{name}:
 *   get:
 *     summary: Obtiene un job por nombre (compatible GCP)
 *     tags: [Scheduler]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detalle del job
 *       404:
 *         description: Job no encontrado
 */
router.get('/jobs/:name', getJob);

/**
 * @openapi
 * /scheduler/jobs:
 *   post:
 *     summary: Crea un job (compatible GCP)
 *     tags: [Scheduler]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, schedule, uri]
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               schedule:
 *                 type: string
 *                 description: Expresión cron (ej. "30 10 * * 3")
 *               timeZone:
 *                 type: string
 *                 default: America/Santiago
 *               uri:
 *                 type: string
 *               httpMethod:
 *                 type: string
 *                 enum: [GET, POST, PUT, PATCH, DELETE]
 *                 default: POST
 *               headers:
 *                 type: object
 *               body:
 *                 type: object
 *               oidcServiceAccountEmail:
 *                 type: string
 *               secretHeaders:
 *                 type: object
 *     responses:
 *       201:
 *         description: Job creado
 *       400:
 *         description: Validación fallida
 *       409:
 *         description: El job ya existe
 */
router.post('/jobs', createJob);

/**
 * @openapi
 * /scheduler/jobs/{name}:
 *   patch:
 *     summary: Actualiza un job (compatible GCP)
 *     tags: [Scheduler]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               schedule:
 *                 type: string
 *               timeZone:
 *                 type: string
 *               httpMethod:
 *                 type: string
 *               uri:
 *                 type: string
 *               headers:
 *                 type: object
 *               body:
 *                 type: object
 *               oidcServiceAccountEmail:
 *                 type: string
 *               secretHeaders:
 *                 type: object
 *     responses:
 *       200:
 *         description: Job actualizado
 *       404:
 *         description: Job no encontrado
 */
router.patch('/jobs/:name', updateJob);

/**
 * @openapi
 * /scheduler/jobs/{name}:
 *   delete:
 *     summary: Elimina un job (compatible GCP)
 *     tags: [Scheduler]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job eliminado
 *       404:
 *         description: Job no encontrado
 */
router.delete('/jobs/:name', deleteJob);

/**
 * @openapi
 * /scheduler/jobs/{name}/run:
 *   post:
 *     summary: Ejecuta el job ahora (compatible GCP)
 *     tags: [Scheduler]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job ejecutado
 *       404:
 *         description: Job no encontrado
 *       500:
 *         description: Error al llamar a la URI del job
 */
router.post('/jobs/:name/run', runJob);

export default router;
