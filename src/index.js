// 服务入口。

import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp({ dbPath: config.dbPath });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}

app
  .listen({ port: config.port, host: config.host })
  .then((address) => {
    console.log(`muskingum-service listening at ${address}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
