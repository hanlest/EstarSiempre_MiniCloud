/**
 * Rutas compatibles con la API REST de Google Cloud Scheduler.
 * Permite que el backend use SCHEDULER_API_BASE_URL apuntando a mini-cloud
 * (ej. http://localhost:8009/v1) en lugar de https://cloudscheduler.googleapis.com/v1.
 *
 * Los 6 endpoints:
 *   GET    /v1/projects/:projectId/locations/:location/jobs
 *   POST   /v1/projects/:projectId/locations/:location/jobs
 *   GET    /v1/projects/:projectId/locations/:location/jobs/:jobName
 *   PATCH  /v1/projects/:projectId/locations/:location/jobs/:jobName
 *   DELETE /v1/projects/:projectId/locations/:location/jobs/:jobName
 *   POST   /v1/projects/:projectId/locations/:location/jobs/:jobName  (jobName = "nombre:run" para ejecutar)
 *
 * Jobs persistidos en data/scheduler/jobs/*.json
 */

import express from 'express';
import {
  listJobsCloud,
  getJobCloud,
  createJobCloud,
  updateJobCloud,
  deleteJobCloud,
  runJobCloud,
} from '../controllers/schedulerController.js';

const router = express.Router({ mergeParams: true });

router.get('/projects/:projectId/locations/:location/jobs', listJobsCloud);
router.post('/projects/:projectId/locations/:location/jobs', createJobCloud);
router.get('/projects/:projectId/locations/:location/jobs/:jobName', getJobCloud);
router.patch('/projects/:projectId/locations/:location/jobs/:jobName', updateJobCloud);
router.delete('/projects/:projectId/locations/:location/jobs/:jobName', deleteJobCloud);
router.post('/projects/:projectId/locations/:location/jobs/:jobName', runJobCloud);

export default router;
