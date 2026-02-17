/**
 * Controlador de Scheduler.
 * Emula Cloud Scheduler en local: misma entrada y respuesta que GCP.
 * Incluye un proceso en segundo plano que cada minuto evalúa cron y ejecuta los jobs.
 * Persistencia: un JSON por job en data/scheduler/jobs/ y ejecuciones en data/scheduler/executions.json.
 */

import cronParser from 'cron-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT = 'local';
const LOCATION = 'local';
const FULL_NAME_PREFIX = `projects/${PROJECT}/locations/${LOCATION}/jobs/`;

const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CRON_PATTERN = /^(\*|([0-9]|[1-5][0-9])|\*\/([0-9]|[1-5][0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|[12][0-9]|3[01])|\*\/([1-9]|[12][0-9]|3[01])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;

const DATA_DIR = path.join(path.dirname(__dirname), 'data', 'scheduler');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const EXECUTIONS_FILE = path.join(DATA_DIR, 'executions.json');
const MAX_EXECUTIONS = 500;

/** Almacenamiento en memoria (mismo formato que GCP) */
const jobsStore = new Map();

/** Nombre de archivo seguro: solo alfanuméricos, guión, guión bajo, punto */
function safeJobFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json';
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function saveJobToDisk(shortName, job) {
  await ensureDir(JOBS_DIR);
  const filePath = path.join(JOBS_DIR, safeJobFilename(shortName));
  await fs.writeFile(filePath, JSON.stringify(job, null, 2), 'utf8');
}

async function deleteJobFile(shortName) {
  const filePath = path.join(JOBS_DIR, safeJobFilename(shortName));
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/**
 * Carga todos los jobs desde data/scheduler/jobs/ al arranque.
 */
export async function loadJobsFromDisk() {
  try {
    await ensureDir(JOBS_DIR);
    const files = await fs.readdir(JOBS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(JOBS_DIR, file);
      const content = await fs.readFile(filePath, 'utf8');
      const job = JSON.parse(content);
      const shortName = job.name.split('/').pop();
      jobsStore.set(shortName, job);
    }
    console.log(`[Scheduler] Cargados ${jobsStore.size} job(s) desde ${JOBS_DIR}`);
  } catch (err) {
    console.error('[Scheduler] Error al cargar jobs desde disco:', err.message);
  }
}

/**
 * Añade una ejecución al historial (data/scheduler/executions.json).
 */
async function logExecution({ jobName, at, ok, message }) {
  try {
    await ensureDir(DATA_DIR);
    let list = [];
    try {
      const content = await fs.readFile(EXECUTIONS_FILE, 'utf8');
      list = JSON.parse(content);
    } catch {
      // archivo no existe o vacío
    }
    list.push({ jobName, at: at || new Date().toISOString(), ok, message: message || null });
    list = list.slice(-MAX_EXECUTIONS);
    await fs.writeFile(EXECUTIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('[Scheduler] Error al guardar ejecución:', err.message);
  }
}

function fullName(shortName) {
  return `${FULL_NAME_PREFIX}${shortName}`;
}

function toListJob(job) {
  return {
    name: job.name.split('/').pop(),
    description: job.description ?? '',
    schedule: job.schedule,
    timeZone: job.timeZone ?? 'America/Santiago',
    state: job.state ?? 'ENABLED',
    lastAttemptTime: job.lastAttemptTime ?? null,
    httpTarget: {
      uri: job.httpTarget?.uri,
      httpMethod: job.httpTarget?.httpMethod ?? 'POST',
    },
  };
}

function toDetailJob(job) {
  return {
    name: job.name,
    description: job.description ?? '',
    schedule: job.schedule,
    timeZone: job.timeZone ?? 'America/Santiago',
    state: job.state ?? 'ENABLED',
    lastAttemptTime: job.lastAttemptTime ?? null,
    httpTarget: {
      uri: job.httpTarget?.uri,
      httpMethod: job.httpTarget?.httpMethod ?? 'POST',
      headers: job.httpTarget?.headers ?? {},
    },
  };
}

function validateCron(schedule) {
  if (!CRON_PATTERN.test(schedule)) {
    return { valid: false, message: 'El schedule debe ser una expresión cron válida (ej: "30 10 * * 3")' };
  }
  return { valid: true };
}

function validateHttpMethod(method) {
  if (!VALID_HTTP_METHODS.includes((method || 'POST').toUpperCase())) {
    return { valid: false, message: `El método debe ser uno de: ${VALID_HTTP_METHODS.join(', ')}` };
  }
  return { valid: true };
}

/**
 * Ejecuta la petición HTTP de un job (usado por runJob y por el loop de cron).
 * Actualiza job.lastAttemptTime. No lanza; devuelve { ok, message }.
 */
async function executeJobHttp(job) {
  const { uri, httpMethod, headers = {}, body: bodyB64 } = job.httpTarget || {};
  if (!uri) return { ok: false, message: 'El job no tiene URI configurada' };

  const method = (httpMethod || 'POST').toUpperCase();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (bodyB64 && method !== 'GET') {
    try {
      opts.body = Buffer.from(bodyB64, 'base64').toString('utf8');
    } catch {
      opts.body = bodyB64;
    }
  }

  try {
    const res = await fetch(uri, opts);
    job.lastAttemptTime = new Date().toISOString();
    if (!res.ok) {
      let bodyPreview = '';
      try {
        const text = await res.text();
        bodyPreview = text.length > 200 ? text.slice(0, 200) + '…' : text;
      } catch {}
      return {
        ok: false,
        message: `La URI respondió con ${res.status}: ${res.statusText}`,
        uri,
        status: res.status,
        statusText: res.statusText,
        bodyPreview: bodyPreview || undefined,
      };
    }
    return { ok: true };
  } catch (err) {
    job.lastAttemptTime = new Date().toISOString();
    return {
      ok: false,
      message: err.message || 'Error desconocido',
      uri,
      errorCode: err.cause?.code || err.code,
    };
  }
}

/**
 * Comprueba si, según el cron y la timezone del job, toca ejecutar en el minuto actual.
 */
function shouldRunThisMinute(job) {
  try {
    const now = new Date();
    const startOfMinute = new Date(now);
    startOfMinute.setSeconds(0, 0);
    startOfMinute.setMilliseconds(0);
    const tz = job.timeZone || 'America/Santiago';
    const parser = cronParser.parseExpression(job.schedule, {
      currentDate: startOfMinute,
      tz,
    });
    const next = parser.next().toDate();
    const minStart = startOfMinute.getTime();
    const minEnd = minStart + 60000;
    // Incluir next === minEnd: para "* * * * *" cron-parser devuelve el inicio del siguiente minuto
    return next.getTime() >= minStart && next.getTime() <= minEnd;
  } catch {
    return false;
  }
}

const INTERVAL_MS = 60 * 1000; // 1 minuto

function tick() {
  const toRun = [];
  for (const [shortName, job] of jobsStore) {
    if (job.state !== 'ENABLED' || !job.httpTarget?.uri) continue;
    if (!shouldRunThisMinute(job)) continue;
    toRun.push({ shortName, job });
  }

  if (toRun.length === 0) {
    console.log('[Scheduler] Revisión de cron: no se ejecutó ningún job.');
    return;
  }

  const timeLabel = new Date().toISOString().slice(0, 19).replace('T', ' ');
  Promise.allSettled(
    toRun.map(({ shortName, job }) =>
      executeJobHttp(job).then((r) => ({ shortName, at: job.lastAttemptTime, ...r }))
    )
  ).then(async (results) => {
    const ok = [];
    const failed = [];
    for (let i = 0; i < results.length; i++) {
      const { shortName } = toRun[i];
      const out = results[i];
      if (out.status === 'fulfilled') {
        const { at, ok: success, message, uri, status, statusText, bodyPreview, errorCode } = out.value;
        await logExecution({ jobName: shortName, at, ok: success, message: success ? null : message });
        if (success) ok.push(shortName);
        else failed.push({ shortName, message, uri, status, statusText, bodyPreview, errorCode });
      } else {
        const msg = out.reason?.message || 'excepción';
        await logExecution({
          jobName: shortName,
          at: new Date().toISOString(),
          ok: false,
          message: msg,
        });
        failed.push({
          shortName,
          message: msg,
          errorCode: out.reason?.cause?.code ?? out.reason?.code,
        });
      }
    }
    if (ok.length) {
      console.log(`[Scheduler] ${timeLabel} — Ejecutados: ${ok.join(', ')}.`);
    }
    failed.forEach(({ shortName, message, uri, status, statusText, bodyPreview, errorCode }) => {
      console.error(`[Scheduler] ${timeLabel} — "${shortName}" falló:`);
      console.error(`      Mensaje: ${message}`);
      if (uri) console.error(`      URI: ${uri}`);
      if (status) console.error(`      HTTP: ${status} ${statusText || ''}`);
      if (errorCode) console.error(`      Código: ${errorCode}`);
      if (bodyPreview) console.error(`      Respuesta: ${bodyPreview}`);
    });
    if (ok.length === 0 && failed.length > 0) {
      console.log(`[Scheduler] ${timeLabel} — Revisión de cron: ${failed.length} job(s) fallaron.`);
    }
  });
}

let schedulerIntervalId = null;

/**
 * Inicia el proceso que cada minuto revisa los jobs y ejecuta los que coinciden con el cron.
 * Se puede llamar desde index.js al arrancar la API.
 */
export function startSchedulerLoop() {
  if (schedulerIntervalId != null) return;
  tick(); // primera revisión al arrancar
  schedulerIntervalId = setInterval(tick, INTERVAL_MS);
  console.log('[Scheduler] Proceso de cron iniciado (revisión cada 1 minuto)');
}

/**
 * Detiene el proceso de cron (útil para tests o shutdown graceful).
 */
export function stopSchedulerLoop() {
  if (schedulerIntervalId != null) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    console.log('[Scheduler] Proceso de cron detenido');
  }
}

/**
 * Lista todos los jobs (misma respuesta que GCP).
 * GET /scheduler/jobs
 */
export const listJobs = async (req, res) => {
  try {
    const jobs = Array.from(jobsStore.values()).map(toListJob);
    return res.json({
      success: true,
      count: jobs.length,
      jobs,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Error al listar jobs de Cloud Scheduler',
      message: err.message || 'Error desconocido',
    });
  }
};

/**
 * Obtiene un job por nombre (misma respuesta que GCP).
 * GET /scheduler/jobs/:name
 */
export const getJob = async (req, res) => {
  try {
    const { name } = req.params;
    if (!name) {
      return res.status(400).json({
        error: 'Nombre del job requerido',
        message: 'Se requiere el parámetro name en la URL',
      });
    }
    const job = jobsStore.get(name);
    if (!job) {
      return res.status(404).json({
        error: 'Job no encontrado',
        message: `No se encontró un job con el nombre "${name}"`,
      });
    }
    return res.json({
      success: true,
      job: toDetailJob(job),
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Error al obtener job de Cloud Scheduler',
      message: err.message || 'Error desconocido',
    });
  }
};

/**
 * Crea un job (misma entrada y respuesta que GCP).
 * POST /scheduler/jobs
 */
export const createJob = async (req, res) => {
  try {
    const {
      name,
      description,
      schedule,
      timeZone = 'America/Santiago',
      httpMethod = 'POST',
      uri,
      headers = {},
      body = null,
      oidcServiceAccountEmail = null,
      secretHeaders = null,
    } = req.body;

    if (!name || !schedule || !uri) {
      return res.status(400).json({
        error: 'Campos requeridos faltantes',
        message: 'Se requieren: name, schedule, uri',
      });
    }

    const cronCheck = validateCron(schedule);
    if (!cronCheck.valid) {
      return res.status(400).json({
        error: 'Formato de schedule inválido',
        message: cronCheck.message,
      });
    }

    const methodCheck = validateHttpMethod(httpMethod);
    if (!methodCheck.valid) {
      return res.status(400).json({
        error: 'Método HTTP inválido',
        message: methodCheck.message,
      });
    }

    if (jobsStore.has(name)) {
      return res.status(409).json({
        error: 'El job ya existe',
        message: `Un job con el nombre "${name}" ya existe en esta ubicación`,
      });
    }

    const httpTarget = {
      uri,
      httpMethod: httpMethod.toUpperCase(),
      headers: { ...headers },
    };
    if (body != null) {
      httpTarget.body = typeof body === 'string'
        ? Buffer.from(body).toString('base64')
        : Buffer.from(JSON.stringify(body)).toString('base64');
    }
    if (oidcServiceAccountEmail) {
      httpTarget.oidcToken = { serviceAccountEmail: oidcServiceAccountEmail };
    }
    if (secretHeaders) {
      httpTarget.secretHeaders = secretHeaders;
    }

    const job = {
      name: fullName(name),
      description: description ?? '',
      schedule,
      timeZone,
      state: 'ENABLED',
      lastAttemptTime: null,
      httpTarget,
    };
    jobsStore.set(name, job);
    await saveJobToDisk(name, job);

    return res.status(201).json({
      success: true,
      message: 'Job de Cloud Scheduler creado exitosamente',
      job: {
        name: job.name,
        description: job.description,
        schedule: job.schedule,
        timeZone: job.timeZone,
        state: job.state,
        httpTarget: {
          uri: job.httpTarget.uri,
          httpMethod: job.httpTarget.httpMethod,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Error al crear job de Cloud Scheduler',
      message: err.message || 'Error desconocido',
    });
  }
};

/**
 * Actualiza un job (misma entrada y respuesta que GCP).
 * PATCH /scheduler/jobs/:name
 */
export const updateJob = async (req, res) => {
  try {
    const { name } = req.params;
    const {
      description,
      schedule,
      timeZone,
      httpMethod,
      uri,
      headers,
      body,
      oidcServiceAccountEmail,
      secretHeaders,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'Nombre del job requerido',
        message: 'Se requiere el parámetro name en la URL',
      });
    }

    const existing = jobsStore.get(name);
    if (!existing) {
      return res.status(404).json({
        error: 'Job no encontrado',
        message: `No se encontró un job con el nombre "${name}"`,
      });
    }

    if (schedule !== undefined) {
      const cronCheck = validateCron(schedule);
      if (!cronCheck.valid) {
        return res.status(400).json({
          error: 'Formato de schedule inválido',
          message: cronCheck.message,
        });
      }
      existing.schedule = schedule;
    }
    if (description !== undefined) existing.description = description;
    if (timeZone !== undefined) existing.timeZone = timeZone;

    if (existing.httpTarget) {
      if (httpMethod !== undefined) {
        const methodCheck = validateHttpMethod(httpMethod);
        if (!methodCheck.valid) {
          return res.status(400).json({
            error: 'Método HTTP inválido',
            message: methodCheck.message,
          });
        }
        existing.httpTarget.httpMethod = httpMethod.toUpperCase();
      }
      if (uri !== undefined) existing.httpTarget.uri = uri;
      if (headers !== undefined) existing.httpTarget.headers = { ...existing.httpTarget.headers, ...headers };
      if (body !== undefined) {
        existing.httpTarget.body = typeof body === 'string'
          ? Buffer.from(body).toString('base64')
          : Buffer.from(JSON.stringify(body)).toString('base64');
      }
      if (oidcServiceAccountEmail !== undefined) {
        if (oidcServiceAccountEmail) {
          existing.httpTarget.oidcToken = { serviceAccountEmail: oidcServiceAccountEmail };
        } else {
          delete existing.httpTarget.oidcToken;
        }
      }
      if (secretHeaders !== undefined) existing.httpTarget.secretHeaders = secretHeaders;
    }

    await saveJobToDisk(name, existing);

    return res.json({
      success: true,
      message: 'Job de Cloud Scheduler actualizado exitosamente',
      job: {
        name: existing.name,
        description: existing.description,
        schedule: existing.schedule,
        timeZone: existing.timeZone,
        state: existing.state,
        httpTarget: {
          uri: existing.httpTarget?.uri,
          httpMethod: existing.httpTarget?.httpMethod,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Error al actualizar job de Cloud Scheduler',
      message: err.message || 'Error desconocido',
    });
  }
};

/**
 * Elimina un job (misma respuesta que GCP).
 * DELETE /scheduler/jobs/:name
 */
export const deleteJob = async (req, res) => {
  try {
    const { name } = req.params;
    if (!name) {
      return res.status(400).json({
        error: 'Nombre del job requerido',
        message: 'Se requiere el parámetro name en la URL',
      });
    }
    if (!jobsStore.has(name)) {
      return res.status(404).json({
        error: 'Job no encontrado',
        message: `No se encontró un job con el nombre "${name}"`,
      });
    }
    jobsStore.delete(name);
    await deleteJobFile(name);
    return res.json({
      success: true,
      message: 'Job de Cloud Scheduler eliminado exitosamente',
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Error al eliminar job de Cloud Scheduler',
      message: err.message || 'Error desconocido',
    });
  }
};

/**
 * Ejecuta un job ahora: hace la petición HTTP a la URI del job (misma respuesta que GCP).
 * POST /scheduler/jobs/:name/run
 */
export const runJob = async (req, res) => {
  try {
    const { name } = req.params;
    if (!name) {
      return res.status(400).json({
        error: 'Nombre del job requerido',
        message: 'Se requiere el parámetro name en la URL',
      });
    }
    const job = jobsStore.get(name);
    if (!job) {
      return res.status(404).json({
        error: 'Job no encontrado',
        message: `No se encontró un job con el nombre "${name}"`,
      });
    }

    const result = await executeJobHttp(job);
    await logExecution({
      jobName: name,
      at: job.lastAttemptTime,
      ok: result.ok,
      message: result.ok ? null : result.message,
    });
    if (!result.ok) {
      return res.status(500).json({
        error: 'Error al ejecutar job de Cloud Scheduler',
        message: result.message,
      });
    }
    return res.json({
      success: true,
      message: 'Job de Cloud Scheduler ejecutado manualmente',
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Error al ejecutar job de Cloud Scheduler',
      message: err.message || 'Error desconocido',
    });
  }
};
