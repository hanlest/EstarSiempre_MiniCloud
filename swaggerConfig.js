import swaggerJsdoc from 'swagger-jsdoc';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = process.env.PORT || 8009;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mini Cloud Private Site API',
      version: '1.0.0',
      description: 'API mínima con endpoint de health y documentación Swagger.',
    },
    servers: [{ url: baseUrl }],
  },
  apis: [
    join(__dirname, './index.js'),
    join(__dirname, './routes/*.js'),
  ],
};

const specs = swaggerJsdoc(options);
export default specs;
