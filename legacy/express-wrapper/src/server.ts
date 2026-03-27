import http from 'http';
import app from './app';
import { env } from './config/env';
import { disconnectPrisma } from './lib/prisma';

const server = http.createServer(app);

const port = env.port;
server.listen(port, () => {
  console.log(`Seked Control Plane listening on :${port}`);
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  server.close(async () => {
    try {
      await disconnectPrisma();
      console.log('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown', err);
      process.exit(1);
    }
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
