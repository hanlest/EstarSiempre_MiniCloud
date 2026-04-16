/**
 * Rutas compatibles con la API REST v2 de Google Cloud Tasks.
 * El backend usa TASKS_API_BASE_URL (ej. http://localhost:8009/tasks) y llama a /v2/projects/.../locations/.../queues...
 *
 * Endpoints:
 *   GET    /v2/projects/:projectId/locations/:location/queues
 *   GET    /v2/projects/:projectId/locations/:location/queues/:queueId
 *   POST   /v2/projects/:projectId/locations/:location/queues
 *   GET    /v2/projects/:projectId/locations/:location/queues/:queueId/tasks
 *   POST   /v2/projects/:projectId/locations/:location/queues/:queueId/tasks
 *   DELETE /v2/projects/:projectId/locations/:location/queues/:queueId/tasks/:taskId
 *   POST   /v2/projects/:projectId/locations/:location/queues/:queueId/purge
 */

import express from 'express';
import {
  listQueuesCloud,
  getQueueCloud,
  createQueueCloud,
  listTasksCloud,
  createTaskCloud,
  deleteTaskCloud,
  purgeQueueCloud,
} from '../controllers/tasksCloudController.js';

const router = express.Router({ mergeParams: true });

router.get('/projects/:projectId/locations/:location/queues', listQueuesCloud);
router.get('/projects/:projectId/locations/:location/queues/:queueId', getQueueCloud);
router.post('/projects/:projectId/locations/:location/queues', createQueueCloud);
router.get('/projects/:projectId/locations/:location/queues/:queueId/tasks', listTasksCloud);
router.post('/projects/:projectId/locations/:location/queues/:queueId/tasks', createTaskCloud);
router.delete('/projects/:projectId/locations/:location/queues/:queueId/tasks/:taskId', deleteTaskCloud);
router.post('/projects/:projectId/locations/:location/queues/:queueId/purge', purgeQueueCloud);

export default router;
