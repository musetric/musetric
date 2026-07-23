import { type FastifyInstance } from 'fastify';

export const disableRequestLogging = true;

export const registerApiLogger = (app: FastifyInstance) => {
  app.addHook('onRequest', (request, _reply, done) => {
    request.log.debug(
      {
        req: {
          method: request.method,
          url: request.url,
          host: request.headers.host,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
        },
      },
      'incoming request',
    );
    done();
  });
  app.addHook('onResponse', (request, reply, done) => {
    request.log.debug(
      {
        res: {
          statusCode: reply.statusCode,
        },
        responseTime: reply.elapsedTime,
      },
      'request completed',
    );
    done();
  });
};
