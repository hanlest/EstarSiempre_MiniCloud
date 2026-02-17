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

Por defecto el servidor escucha en el puerto **8080** (configurable con `PORT`).

## Variables de entorno

- `PORT` – Puerto del servidor (por defecto 8080)
- `BASE_URL` – URL base para Swagger (por defecto `http://localhost:PORT`)
