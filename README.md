# Mini Cloud Private Site API

API mínima en Node.js con endpoint de health y documentación Swagger.

## Requisitos

- Node.js 18+

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
```

En desarrollo con recarga automática:

```bash
npm run dev
```

## Endpoints

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/health` | GET | Comprueba que la API está en ejecución |
| `/api-docs` | GET | Documentación Swagger UI |
| `/scheduler/jobs` | GET, POST, etc. | Scheduler estilo propio (lista, crea, etc. por nombre corto) |
| `/scheduler/v1/projects/.../locations/.../jobs` | GET, POST | **API compatible Google Cloud Scheduler** (listar, crear) |
| `/scheduler/v1/projects/.../locations/.../jobs/:jobName` | GET, PATCH, DELETE, POST | Get, actualizar, eliminar, ejecutar (POST con `:jobName` = `nombre:run`) |

Por defecto el servidor escucha en el puerto **8080** (configurable con `PORT`; en este proyecto suele usarse `8009`).

## Scheduler (compatible con Google Cloud Scheduler)

Para usar el backend apuntando a mini-cloud en lugar de Google:

1. En el **backend** (.env), para diferenciar storage y scheduler con mini-cloud:  
   `STORAGE_API_BASE_URL=http://localhost:8009/storage`  
   `SCHEDULER_API_BASE_URL=http://localhost:8009/scheduler`  
   (el backend agrega `/v1` al path del scheduler; opcionalmente `GCP_PROJECT_ID=local`, `GCP_LOCATION=local`.)

2. Los jobs se persisten en **`data/scheduler/jobs/*.json`** (un JSON por job). El proceso en segundo plano evalúa cron cada minuto y llama a la URI configurada de cada job.

3. Los 6 endpoints (bajo `/scheduler/v1/...`) con la misma firma que la API de Google:
   - **GET** `.../scheduler/v1/projects/.../locations/.../jobs` → `{ jobs: [...] }`
   - **POST** `.../scheduler/v1/projects/.../locations/.../jobs` → cuerpo: job; respuesta: job creado
   - **GET** `.../scheduler/v1/.../jobs/:jobName` → objeto job
   - **PATCH** `.../scheduler/v1/.../jobs/:jobName` → objeto job actualizado
   - **DELETE** `.../scheduler/v1/.../jobs/:jobName` → 200 sin cuerpo
   - **POST** `.../scheduler/v1/.../jobs/:jobName` con `:jobName` = `nombre:run` → ejecuta y devuelve el job

## Variables de entorno

- `PORT` – Puerto del servidor (por defecto 8080)
- `BASE_URL` – URL base para Swagger (por defecto `http://localhost:PORT`)
- `STORAGE_DATA_DIR` – Directorio para objetos de storage (opcional)
