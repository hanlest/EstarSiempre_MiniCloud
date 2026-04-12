import 'dotenv/config';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerSpecs from './swaggerConfig.js';
import schedulerCloudRoutes from './routes/schedulerCloudRoutes.js';
import storageRoutes from './routes/storageRoutes.js';
import uploadStorageRoutes from './routes/uploadStorageRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import tasksCloudRoutes from './routes/tasksCloudRoutes.js';
import { loadJobsFromDisk, startSchedulerLoop } from './controllers/schedulerController.js';
import { ensureStorageDataDir } from './controllers/storageController.js';
import { loadQueuesFromDisk, startTasksLoop } from './controllers/tasksCloudController.js';

const app = express();
const PORT = process.env.PORT || 8009;

app.use(express.json());

// Rutas por recurso (bases: STORAGE_API_BASE_URL=http://localhost:8009/storage, SCHEDULER_API_BASE_URL=http://localhost:8009/scheduler)
app.use('/scheduler/v1', schedulerCloudRoutes);
app.use('/storage', storageRoutes);
const uploadMiddleware = express.raw({ type: '*/*', limit: '500mb' });
app.use('/storage/upload', uploadMiddleware, uploadStorageRoutes);
app.use('/task', taskRoutes);
// API REST v2 Cloud Tasks (TASKS_API_BASE_URL = http://localhost:8009/tasks)
app.use('/tasks/v2', tasksCloudRoutes);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Comprueba que la API está en ejecución.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Servicio operativo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Redirigir raíz a la documentación
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

app.listen(PORT, async () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Swagger: http://localhost:${PORT}/api-docs`);
  await ensureStorageDataDir();
  await loadJobsFromDisk();
  await loadQueuesFromDisk();
  startTasksLoop();
  startSchedulerLoop();
});
