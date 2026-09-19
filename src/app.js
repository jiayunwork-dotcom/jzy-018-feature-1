// HTTP 层：Fastify 路由 + 统一错误说明。

import Fastify from 'fastify';
import { openDatabase } from './storage/db.js';
import { createReachRepo } from './storage/reaches.js';
import { createJobRepo } from './storage/jobs.js';
import { submitJob } from './jobService.js';
import { validateReachPayload } from './validation.js';
import { seedDemoJob } from './demo.js';
import { AppError } from './errors.js';

export function buildApp({ dbPath = ':memory:' } = {}) {
  const db = openDatabase(dbPath);
  const reachRepo = createReachRepo(db);
  const jobRepo = createJobRepo(db);
  seedDemoJob(jobRepo);

  const app = Fastify({ logger: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const body = { error: { type: err.type, message: err.message } };
      if (err.details !== undefined) body.error.details = err.details;
      return reply.code(err.statusCode).send(body);
    }
    if (err.statusCode === 400) {
      const type = err.code === 'FST_ERR_CTP_INVALID_JSON' ? 'BAD_JSON' : 'BAD_REQUEST';
      return reply.code(400).send({ error: { type, message: err.message } });
    }
    if (err.statusCode === 404) {
      return reply.code(404).send({ error: { type: 'NOT_FOUND', message: err.message } });
    }
    app.log.error(err);
    return reply.code(500).send({ error: { type: 'INTERNAL', message: '服务内部错误' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // —— 河段档 ——
  app.post('/reaches', async (req, reply) => {
    const payload = validateReachPayload(req.body);
    const reach = reachRepo.add(payload.name, payload.K, payload.X);
    return reply.code(201).send(reach);
  });

  app.get('/reaches', async () => ({ reaches: reachRepo.list() }));

  app.get('/reaches/:name', async (req) => {
    const reach = reachRepo.get(req.params.name);
    if (!reach) {
      throw new AppError('UNKNOWN_REACH', `河段档「${req.params.name}」未登记`, 404);
    }
    return reach;
  });

  // —— 演算作业：交一份过程线，取回一份过程线 ——
  app.post('/jobs', async (req, reply) => {
    const job = submitJob(req.body, { reachRepo, jobRepo });
    return reply.code(201).send(job);
  });

  app.get('/jobs', async () => ({ jobs: jobRepo.list() }));

  app.get('/jobs/:id', async (req) => {
    const job = jobRepo.getById(req.params.id);
    if (!job) {
      throw new AppError('NOT_FOUND', `作业 ${req.params.id} 不存在`, 404);
    }
    return job;
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  return app;
}
