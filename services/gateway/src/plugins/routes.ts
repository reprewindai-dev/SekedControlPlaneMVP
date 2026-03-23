import { FastifyInstance } from 'fastify';
import { billingRoutes } from '../routes/billing';
import { usageRoutes } from '../routes/usage';
import { runsRoutes } from '../routes/runs';
import { policiesRoutes } from '../routes/policies';
import { keysRoutes } from '../routes/keys';

export default async function routesPlugin(app: FastifyInstance) {
  await billingRoutes(app);
  await usageRoutes(app);
  await runsRoutes(app);
  await policiesRoutes(app);
  await keysRoutes(app);
}
