import 'dotenv/config';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerSpecs from './swaggerConfig.js';
import schedulerRoutes from './routes/schedulerRoutes.js';
import storageRoutes from './routes/storageRoutes.js';
import uploadStorageRoutes from './routes/uploadStorageRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import { loadJobsFromDisk, startSchedulerLoop } from './controllers/schedulerController.js';
import { ensureStorageDataDir } from './controllers/storageController.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Rutas por recurso
app.use('/scheduler', schedulerRoutes);
app.use('/storage', storageRoutes);
// POST multipart para subida (body raw); misma firma que GCS
app.use('/upload', express.raw({ type: '*/*', limit: '500mb' }), uploadStorageRoutes);
app.use('/task', taskRoutes);

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
  startSchedulerLoop();
});
