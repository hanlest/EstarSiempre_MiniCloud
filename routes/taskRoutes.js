import express from 'express';
import {
  listQueues,
  getQueue,
  listTasks,
  createTask,
  deleteTask,
} from '../controllers/taskController.js';

const router = express.Router();

/**
 * @openapi
 * /task/queues:
 *   get:
 *     summary: Lista colas de tareas
 *     tags: [Task]
 *     responses:
 *       200:
 *         description: Lista de colas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 queues:
 *                   type: array
 */
router.get('/queues', listQueues);

/**
 * @openapi
 * /task/queues/{queueName}:
 *   get:
 *     summary: Obtiene una cola por nombre
 *     tags: [Task]
 *     parameters:
 *       - in: path
 *         name: queueName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detalle de la cola
 *       404:
 *         description: Cola no encontrada
 */
router.get('/queues/:queueName', getQueue);

/**
 * @openapi
 * /task/queues/{queueName}/tasks:
 *   get:
 *     summary: Lista tareas de una cola
 *     tags: [Task]
 *     parameters:
 *       - in: path
 *         name: queueName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de tareas
 */
router.get('/queues/:queueName/tasks', listTasks);

/**
 * @openapi
 * /task/queues/{queueName}/tasks:
 *   post:
 *     summary: Crea una tarea en la cola
 *     tags: [Task]
 *     parameters:
 *       - in: path
 *         name: queueName
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [relativeUri]
 *             properties:
 *               relativeUri:
 *                 type: string
 *                 description: Ruta del handler (ej. /api/process)
 *               payload:
 *                 type: object
 *               scheduleTime:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Tarea creada
 *       400:
 *         description: Faltan campos requeridos
 */
router.post('/queues/:queueName/tasks', createTask);

/**
 * @openapi
 * /task/queues/{queueName}/tasks/{taskName}:
 *   delete:
 *     summary: Elimina una tarea
 *     tags: [Task]
 *     parameters:
 *       - in: path
 *         name: queueName
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: taskName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tarea eliminada
 */
router.delete('/queues/:queueName/tasks/:taskName', deleteTask);

export default router;
