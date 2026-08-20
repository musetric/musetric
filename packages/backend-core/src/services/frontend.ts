import { fastifyStatic } from '@fastify/static';
import { type FastifyInstance, type FastifyRequest } from 'fastify';

const isApiPath = (path: string) =>
  path.startsWith('/api') ||
  path.startsWith('/docs') ||
  path.startsWith('/swagger');

const isFrontendRequest = (request: FastifyRequest) => {
  const method = request.raw.method ?? 'GET';
  const [pathname] = String(request.raw.url ?? '/').split('?');
  const isGet = method === 'GET' || method === 'HEAD';
  const isAsset = pathname.includes('.');
  const isApi = isApiPath(pathname);
  return isGet && !isAsset && !isApi;
};

export const registerFrontend = (app: FastifyInstance) => {
  app.register(fastifyStatic, {
    root: app.config.publicPath,
    prefix: '/',
    index: ['index.html'],
  });
  app.setNotFoundHandler((request, reply) => {
    if (isFrontendRequest(request)) {
      return reply.sendFile('index.html');
    }
    return reply.callNotFound();
  });
};
