/**
 * Controlador que emula la API REST v2 de Google Cloud Tasks.
 * Endpoints compatibles con cloudTasksApi.js del backend (TASKS_API_BASE_URL).
 * Persistencia: data/tasks/queues.json (colas) y data/tasks/queues/<queueId>/tasks.json (tareas).
 *
 * Ejecución de tareas:
 * - Tarea inmediata (sin scheduleTime o scheduleTime <= now): al crearla se quita de la cola y se ejecuta en background (HTTP a httpRequest.url).
 * - Tarea programada (scheduleTime futuro): un proceso cada 10 segundos revisa todas las colas y ejecuta las tareas cuya scheduleTime ya pasó.
 * - Precisión: como el tick es cada 10 s, la ejecución puede retrasarse hasta ~10 s respecto al scheduleTime.
 * - Reintentos: si el HTTP falla, la tarea permanece en cola con scheduleTime = ahora + backoff (min/max de retryConfig
 *   de la cola). Por defecto reintentos indefinidos; opcional MINI_CLOUD_TASKS_MAX_ATTEMPTS>0 para abandonar tras N fallos.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(path.dirname(__dirname), 'data', 'tasks');
const QUEUES_FILE = path.join(DATA_DIR, 'queues.json');

/** Colas por nombre completo (projects/.../locations/.../queues/...) */
const queuesStore = new Map();
/** Tareas por parent de cola (projects/.../locations/.../queues/queueId) → array de tareas */
const tasksStore = new Map();

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function queueIdFromName(fullName) {
  const parts = fullName.split('/');
  return parts[parts.length - 1] || fullName;
}

/**
 * Carga colas desde disco al arranque.
 */
export async function loadQueuesFromDisk() {
  try {
    await ensureDir(DATA_DIR);
    try {
      const raw = await fs.readFile(QUEUES_FILE, 'utf8');
      const arr = JSON.parse(raw);
      queuesStore.clear();
      for (const q of arr) {
        if (q.name) queuesStore.set(q.name, q);
      }
      console.log(`[Tasks]     Cargadas ${queuesStore.size} cola(s) desde ${QUEUES_FILE}`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[Tasks]     Error al cargar colas:', e.message);
    }
  } catch (err) {
    console.error('[Tasks]     loadQueuesFromDisk:', err.message);
  }
}

async function saveQueuesToDisk() {
  await ensureDir(DATA_DIR);
  const arr = Array.from(queuesStore.values());
  await fs.writeFile(QUEUES_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

function getTasksFilePath(parent) {
  const qid = parent.split('/').pop();
  return path.join(DATA_DIR, 'queues', `${qid}.tasks.json`);
}

async function loadTasksForQueue(parent) {
  const filePath = getTasksFilePath(parent);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const arr = JSON.parse(raw);
    tasksStore.set(parent, arr);
    return arr;
  } catch (e) {
    if (e.code === 'ENOENT') {
      tasksStore.set(parent, []);
      return [];
    }
    throw e;
  }
}

function getTasksForQueueSync(parent) {
  if (tasksStore.has(parent)) return tasksStore.get(parent);
  const arr = [];
  tasksStore.set(parent, arr);
  return arr;
}

async function saveTasksForQueue(parent) {
  const tasks = tasksStore.get(parent) || [];
  const filePath = getTasksFilePath(parent);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), 'utf8');
}

/** Elimina una tarea de la cola (por nombre completo) y persiste. */
async function removeTaskFromQueue(parent, taskName) {
  let tasks = tasksStore.get(parent);
  if (!tasks) tasks = await loadTasksForQueue(parent);
  const before = tasks.length;
  const filtered = tasks.filter((t) => t.name !== taskName);
  if (filtered.length === before) return;
  tasksStore.set(parent, filtered);
  await saveTasksForQueue(parent);
}

const TASKS_LOOP_INTERVAL_MS = 10 * 1000; // 10 segundos
let tasksLoopIntervalId = null;

/** Si > 0, se deja de reintentar tras N fallos consecutivos. 0 o ausente = indefinido. */
function maxRetryAttemptsEnv() {
  const v = parseInt(process.env.MINI_CLOUD_TASKS_MAX_ATTEMPTS || '0', 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function parseDurationToMs(input) {
  if (input == null) return 1000;
  if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, input * 1000);
  const s = String(input).trim();
  const sec = /^(\d+(?:\.\d+)?)s$/i.exec(s);
  if (sec) return Math.max(0, parseFloat(sec[1], 10) * 1000);
  const min = /^(\d+(?:\.\d+)?)m$/i.exec(s);
  if (min) return Math.max(0, parseFloat(min[1], 10) * 60 * 1000);
  const h = /^(\d+(?:\.\d+)?)h$/i.exec(s);
  if (h) return Math.max(0, parseFloat(h[1], 10) * 3600 * 1000);
  return 1000;
}

/**
 * Backoff exponencial al estilo Cloud Tasks: minBackoff * 2^(failures-1), tope maxBackoff.
 * @param {number} consecutiveFailures contador tras incrementar (1 = primer fallo)
 */
function computeBackoffMs(consecutiveFailures, retryConfig) {
  const minMs = parseDurationToMs(retryConfig?.minBackoff ?? '0.1s');
  const maxMs = parseDurationToMs(retryConfig?.maxBackoff ?? '3600s');
  const exp = Math.min(Math.max(0, consecutiveFailures - 1), 28);
  const raw = minMs * 2 ** exp;
  return Math.min(maxMs, Math.max(minMs, Math.round(raw)));
}

function getRetryConfigForParent(parent) {
  const q = queuesStore.get(parent);
  return (
    q?.retryConfig || {
      maxAttempts: 100,
      maxRetryDuration: '3600s',
      minBackoff: '0.1s',
      maxBackoff: '3600s',
    }
  );
}

async function upsertTaskInQueue(parent, task) {
  let tasks = tasksStore.get(parent);
  if (!tasks) tasks = await loadTasksForQueue(parent);
  const idx = tasks.findIndex((t) => t.name === task.name);
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  tasksStore.set(parent, tasks);
  await saveTasksForQueue(parent);
}

/**
 * Tras fallo HTTP: reintento con nuevo scheduleTime o abandono si hay tope de intentos.
 */
async function scheduleTaskRetryAfterFailure(parent, task, result) {
  const req = task.httpRequest || {};
  const method = (req.httpMethod || 'POST').toUpperCase();
  const url = req.url || '?';
  const id = task.name ? task.name.split('/').pop() : '';

  const failures = (task._miniCloudFailures || 0) + 1;
  task._miniCloudFailures = failures;

  const maxA = maxRetryAttemptsEnv();
  if (maxA > 0 && failures >= maxA) {
    console.error(
      `[Tasks] ABANDON ${method} ${url}${id ? ` #${id}` : ''} tras ${failures} fallos (MINI_CLOUD_TASKS_MAX_ATTEMPTS=${maxA}) → ${result.message}`
    );
    await removeTaskFromQueue(parent, task.name);
    return;
  }

  const retryConfig = getRetryConfigForParent(parent);
  const backoffMs = computeBackoffMs(failures, retryConfig);
  const when = new Date(Date.now() + backoffMs).toISOString();
  task.scheduleTime = when;

  await upsertTaskInQueue(parent, task);
  const extra = result.status != null ? ` (${result.status})` : '';
  console.warn(
    `[Tasks] RETRY en ${Math.round(backoffMs / 1000)}s intento ${failures}${maxA > 0 ? `/${maxA}` : '/∞'} ${method} ${url}${id ? ` #${id}` : ''}${extra}`
  );
}

/** Indica si la tarea debe ejecutarse ya (inmediata o scheduleTime <= now). */
function isTaskDue(task) {
  if (!task.scheduleTime) return true;
  const t = new Date(task.scheduleTime).getTime();
  return t <= Date.now();
}

function logTaskResult(task, result) {
  const req = task.httpRequest || {};
  const method = (req.httpMethod || 'POST').toUpperCase();
  const url = req.url || '?';
  const id = task.name ? task.name.split('/').pop() : '';
  if (result.ok) {
    console.log(`[Tasks] OK ${method} ${url}${id ? ` #${id}` : ''}`);
    return;
  }
  console.error(`[Tasks] FAIL ${method} ${url}${id ? ` #${id}` : ''} → ${result.message}`);
  if (result.status === 401) {
    console.error('[Tasks] (401) Revisa URL del API, CLOUD_TASKS_INVOKER_SECRET y Cloud Run sin auth pública');
  }
}

/**
 * Ejecuta la petición HTTP de una tarea (httpRequest.url, body base64, etc.).
 * En local no se usa OIDC; se hace la petición directa.
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function executeTaskHttp(task) {
  const req = task.httpRequest || {};
  const url = req.url;
  if (!url) return { ok: false, message: 'La tarea no tiene httpRequest.url' };

  const method = (req.httpMethod || 'POST').toUpperCase();
  const incoming = { ...(req.headers || {}) };
  const invokerFromTask =
    incoming['x-cloud-tasks-invoker-secret'] ?? incoming['X-Cloud-Tasks-Invoker-Secret'];
  delete incoming.authorization;
  delete incoming.Authorization;
  delete incoming['x-cloud-tasks-invoker-secret'];
  delete incoming['X-Cloud-Tasks-Invoker-Secret'];
  const headers = { 'Content-Type': 'application/json', ...incoming };
  const envInvoker = process.env.CLOUD_TASKS_INVOKER_SECRET;
  const envTrimmed = envInvoker != null ? String(envInvoker).trim() : '';
  if (envTrimmed !== '') {
    headers['X-Cloud-Tasks-Invoker-Secret'] = envTrimmed;
  } else if (invokerFromTask != null && String(invokerFromTask).trim() !== '') {
    headers['X-Cloud-Tasks-Invoker-Secret'] = String(invokerFromTask).trim();
  }
  headers['User-Agent'] = headers['User-Agent'] || 'mini-cloud-tasks/1.0';
  let body = req.body;
  if (body && method !== 'GET') {
    try {
      body = Buffer.from(body, 'base64').toString('utf8');
    } catch {
      body = req.body;
    }
  }

  try {
    const opts = { method, headers };
    if (body != null && method !== 'GET') opts.body = body;
    const res = await fetch(url, opts);
    if (!res.ok) {
      let bodyPreview = '';
      try {
        const text = await res.text();
        bodyPreview = text.length > 200 ? text.slice(0, 200) + '…' : text;
      } catch {}
      return {
        ok: false,
        message: `${res.status} ${res.statusText}`,
        status: res.status,
        statusText: res.statusText,
        bodyPreview: bodyPreview || undefined,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err.message || 'Error desconocido',
      errorCode: err.code,
    };
  }
}

/**
 * Revisión periódica: para cada cola, carga tareas, ejecuta las debidas (sin scheduleTime o scheduleTime <= now) y las elimina de la cola.
 */
async function tasksTick() {
  let executed = 0;
  const parents = Array.from(queuesStore.keys());
  for (const parent of parents) {
    let tasks;
    try {
      tasks = await loadTasksForQueue(parent);
    } catch (_) {
      continue;
    }
    const due = tasks.filter(isTaskDue);
    if (due.length === 0) continue;

    const queueId = parent.split('/').pop();
    for (const task of due) {
      const result = await executeTaskHttp(task);
      logTaskResult(task, result);
      executed++;
      if (result.ok) {
        await removeTaskFromQueue(parent, task.name);
      } else {
        await scheduleTaskRetryAfterFailure(parent, task, result);
      }
    }
  }
}

/**
 * Inicia el proceso que cada 10 segundos revisa y ejecuta tareas debidas.
 * Independiente del loop del Scheduler (cron).
 */
export function startTasksLoop() {
  if (tasksLoopIntervalId != null) return;
  tasksTick(); // primera revisión al arrancar
  tasksLoopIntervalId = setInterval(tasksTick, TASKS_LOOP_INTERVAL_MS);
  console.log('[Tasks]     Proceso de ejecución iniciado (revisión cada 10 segundos)');
}

// --- Handlers (rutas bajo /tasks/v2/...)

/**
 * GET projects/:projectId/locations/:location/queues
 * Respuesta: { queues: [...] }
 */
export async function listQueuesCloud(req, res) {
  try {
    const { projectId, location } = req.params;
    const parent = `projects/${projectId}/locations/${location}`;
    const queues = Array.from(queuesStore.values()).filter((q) => q.name && q.name.startsWith(parent + '/queues/'));
    res.json({ queues });
  } catch (err) {
    console.error('[Tasks]     listQueuesCloud:', err);
    res.status(500).json({ error: { message: err.message } });
  }
}

/**
 * GET projects/:projectId/locations/:location/queues/:queueId
 * Respuesta: objeto Queue
 */
export async function getQueueCloud(req, res) {
  try {
    const { projectId, location, queueId } = req.params;
    const fullName = `projects/${projectId}/locations/${location}/queues/${queueId}`;
    const queue = queuesStore.get(fullName);
    if (!queue) {
      return res.status(404).json({ error: { code: 5, message: 'Queue not found', status: 'NOT_FOUND' } });
    }
    res.json(queue);
  } catch (err) {
    console.error('[Tasks]     getQueueCloud:', err);
    res.status(500).json({ error: { message: err.message } });
  }
}

/**
 * POST projects/:projectId/locations/:location/queues
 * Body: { queue: { name?, rateLimits?, retryConfig?, ... } }
 * Si queue.name no viene, se genera: parent/queues/default-<timestamp>
 */
export async function createQueueCloud(req, res) {
  try {
    const { projectId, location } = req.params;
    const parent = `projects/${projectId}/locations/${location}`;
    let queue = req.body?.queue || req.body;
    if (!queue || typeof queue !== 'object') {
      return res.status(400).json({ error: { message: 'Missing or invalid body.queue' } });
    }
    const fullName = queue.name || `${parent}/queues/default-${Date.now()}`;
    const queueId = queueIdFromName(fullName);
    const canonicalName = fullName.includes('/queues/') ? fullName : `${parent}/queues/${queueId}`;
    const created = {
      name: canonicalName,
      rateLimits: queue.rateLimits || { maxDispatchesPerSecond: 500, maxBurstSize: 100 },
      retryConfig: queue.retryConfig || { maxAttempts: 100, maxRetryDuration: '3600s', minBackoff: '0.1s', maxBackoff: '3600s' },
      state: 'RUNNING',
    };
    queuesStore.set(canonicalName, created);
    await saveQueuesToDisk();
    res.status(201).json(created);
  } catch (err) {
    console.error('[Tasks]     createQueueCloud:', err);
    res.status(500).json({ error: { message: err.message } });
  }
}

/**
 * GET projects/:projectId/locations/:location/queues/:queueId/tasks
 * Query: responseView, pageSize, pageToken (page* ignorados en emulador; se devuelve todo lo pendiente en cola)
 * Respuesta alineada con Cloud Tasks v2: { tasks: [...], nextPageToken? }
 */
export async function listTasksCloud(req, res) {
  try {
    const { projectId, location, queueId } = req.params;
    const parent = `projects/${projectId}/locations/${location}/queues/${queueId}`;
    const fullName = `projects/${projectId}/locations/${location}/queues/${queueId}`;
    if (!queuesStore.has(fullName)) {
      return res.status(404).json({ error: { code: 5, message: 'Queue not found', status: 'NOT_FOUND' } });
    }
    let tasks;
    try {
      tasks = await loadTasksForQueue(parent);
    } catch (_) {
      tasks = getTasksForQueueSync(parent);
    }
    // Homólogo a GCP: si piden página, recortamos (en local suele ser poco volumen)
    const pageSizeRaw = req.query.pageSize;
    const pageToken = req.query.pageToken;
    let pageSize = pageSizeRaw != null ? parseInt(String(pageSizeRaw), 10) : 100;
    if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 100;
    pageSize = Math.min(pageSize, 1000);
    let start = 0;
    if (pageToken) {
      const idx = tasks.findIndex((t) => t.name === pageToken);
      start = idx >= 0 ? idx + 1 : 0;
    }
    const slice = tasks.slice(start, start + pageSize);
    const nextPageToken =
      start + pageSize < tasks.length && slice.length > 0 ? slice[slice.length - 1].name : null;
    res.json({ tasks: slice, ...(nextPageToken ? { nextPageToken } : {}) });
  } catch (err) {
    console.error('[Tasks]     listTasksCloud:', err);
    res.status(500).json({ error: { message: err.message } });
  }
}

/**
 * POST projects/:projectId/locations/:location/queues/:queueId/tasks
 * Body: { task: { name?, scheduleTime?, httpRequest }, responseView? }
 * Respuesta: tarea creada (con name asignado si no venía)
 */
export async function createTaskCloud(req, res) {
  try {
    const { projectId, location, queueId } = req.params;
    const parent = `projects/${projectId}/locations/${location}/queues/${queueId}`;
    const fullQueueName = parent;
    // Si la cola no existe (p. ej. primera vez en local), crearla automáticamente para no fallar
    if (!queuesStore.has(fullQueueName)) {
      const newQueue = {
        name: fullQueueName,
        rateLimits: { maxDispatchesPerSecond: 500, maxBurstSize: 100 },
        retryConfig: { maxAttempts: 100, maxRetryDuration: '3600s', minBackoff: '0.1s', maxBackoff: '3600s' },
        state: 'RUNNING',
      };
      queuesStore.set(fullQueueName, newQueue);
      await saveQueuesToDisk();
      console.log(`[Tasks]     Cola creada automáticamente: ${queueId}`);
    }
    const body = req.body || {};
    let task = body.task || body;
    if (!task || typeof task !== 'object') {
      return res.status(400).json({ error: { message: 'Missing or invalid body.task' } });
    }
    const taskId = task.name ? task.name.split('/').pop() : `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const taskName = `${parent}/tasks/${taskId}`;
    const scheduleTime = task.scheduleTime
      ? (typeof task.scheduleTime === 'string' ? task.scheduleTime : new Date(task.scheduleTime).toISOString())
      : undefined;
    const created = {
      name: taskName,
      ...(scheduleTime && { scheduleTime }),
      httpRequest: task.httpRequest || {},
    };
    let tasks;
    try {
      tasks = await loadTasksForQueue(parent);
    } catch (_) {
      tasks = getTasksForQueueSync(parent);
    }
    tasks.push(created);
    tasksStore.set(parent, tasks);
    await saveTasksForQueue(parent);
    const url = (created.httpRequest || {}).url || '';
    const tipo = scheduleTime ? 'scheduled' : 'now';
    console.log(`[Tasks] +${queueId} ${tipo} → ${url}`);
    res.status(201).json(created);

    // Si la tarea es inmediata (sin scheduleTime o ya vencida), quitarla de la cola y ejecutarla en background (evita doble ejecución con el tick)
    if (isTaskDue(created)) {
      removeTaskFromQueue(parent, created.name)
        .then(() => executeTaskHttp(created))
        .then(async (result) => {
          logTaskResult(created, result);
          if (!result.ok) {
            await scheduleTaskRetryAfterFailure(parent, created, result);
          }
        })
        .catch((err) => console.error('[Tasks] FAIL (excepción)', err.message));
    }
  } catch (err) {
    console.error('[Tasks]     createTaskCloud:', err);
    res.status(500).json({ error: { message: err.message } });
  }
}

/**
 * DELETE projects/:projectId/locations/:location/queues/:queueId/tasks/:taskId
 * Homólogo a Cloud Tasks v2 (elimina una tarea pendiente).
 */
export async function deleteTaskCloud(req, res) {
  try {
    const { projectId, location, queueId, taskId } = req.params;
    const parent = `projects/${projectId}/locations/${location}/queues/${queueId}`;
    const fullQueueName = parent;
    if (!queuesStore.has(fullQueueName)) {
      return res.status(404).json({ error: { code: 5, message: 'Queue not found', status: 'NOT_FOUND' } });
    }
    const decodedTaskId = decodeURIComponent(taskId);
    const taskFullName = `${parent}/tasks/${decodedTaskId}`;
    let tasks;
    try {
      tasks = await loadTasksForQueue(parent);
    } catch (_) {
      tasks = getTasksForQueueSync(parent);
    }
    const idx = tasks.findIndex((t) => t.name === taskFullName || t.name.endsWith(`/tasks/${decodedTaskId}`));
    if (idx < 0) {
      return res.status(404).json({ error: { code: 5, message: 'Task not found', status: 'NOT_FOUND' } });
    }
    tasks.splice(idx, 1);
    tasksStore.set(parent, tasks);
    await saveTasksForQueue(parent);
    console.log(`[Tasks]     Eliminada tarea ${decodedTaskId} de ${queueId}`);
    res.status(200).json({});
  } catch (err) {
    console.error('[Tasks]     deleteTaskCloud:', err);
    res.status(500).json({ error: { message: err.message } });
  }
}

/**
 * POST projects/:projectId/locations/:location/queues/:queueId/purge
 * Vacía todas las tareas pendientes de la cola (ruta alternativa a …:purge de GCP para Express).
 */
export async function purgeQueueCloud(req, res) {
  try {
    const { projectId, location, queueId } = req.params;
    const parent = `projects/${projectId}/locations/${location}/queues/${queueId}`;
    const fullQueueName = parent;
    if (!queuesStore.has(fullQueueName)) {
      return res.status(404).json({ error: { code: 5, message: 'Queue not found', status: 'NOT_FOUND' } });
    }
    tasksStore.set(parent, []);
    await saveTasksForQueue(parent);
    console.log(`[Tasks]     Cola purgada: ${queueId}`);
    res.status(200).json({});
  } catch (err) {
    console.error('[Tasks]     purgeQueueCloud:', err);
    res.status(500).json({ error: { message: err.message } });
  }
}
