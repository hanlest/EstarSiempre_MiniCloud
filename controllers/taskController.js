/**
 * Controlador de Tasks.
 * Endpoints para colas y tareas (stub; integración con Cloud Tasks opcional).
 */

export const listQueues = async (req, res) => {
  try {
    // Stub: colas vacías. Sustituir por listQueues de Cloud Tasks.
    const queues = [];
    res.json({ success: true, count: queues.length, queues });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getQueue = async (req, res) => {
  try {
    const { queueName } = req.params;
    // Stub: cola no encontrada. Sustituir por getQueue de Cloud Tasks.
    res.status(404).json({
      success: false,
      error: 'Cola no encontrada',
      queueName,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const listTasks = async (req, res) => {
  try {
    const { queueName } = req.params;
    // Stub: tareas vacías. Sustituir por listTasks de Cloud Tasks.
    const tasks = [];
    res.json({ success: true, queueName, count: tasks.length, tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createTask = async (req, res) => {
  try {
    const { queueName } = req.params;
    const { payload, relativeUri, scheduleTime } = req.body;
    if (!relativeUri) {
      return res.status(400).json({
        success: false,
        error: 'Falta campo requerido: relativeUri (ruta del handler)',
      });
    }
    // Stub: tarea “creada”. Sustituir por createTask de Cloud Tasks.
    res.status(201).json({
      success: true,
      task: {
        queueName,
        relativeUri,
        payload: payload || null,
        scheduleTime: scheduleTime || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const { queueName, taskName } = req.params;
    // Stub: eliminada. Sustituir por deleteTask de Cloud Tasks.
    res.json({ success: true, message: 'Tarea eliminada', queueName, taskName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
