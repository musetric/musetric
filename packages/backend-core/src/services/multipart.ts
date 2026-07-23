import { fastifyMultipart } from '@fastify/multipart';
import { type FastifyInstance } from 'fastify';

// @see https://github.com/fastify/fastify-multipart/issues/574
declare module '@fastify/multipart' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface MultipartFile {
    value: File;
  }
}

export const registerMultipart = (app: FastifyInstance) => {
  app.register(fastifyMultipart, {
    attachFieldsToBody: 'keyValues',
    limits: {
      fileSize: 200 * 1024 * 1024,
    },
    onFile: async (part) => {
      const buff = await part.toBuffer();
      const bytes = new Uint8Array(buff.length);
      bytes.set(buff);
      const file = new File([bytes], part.filename, {
        type: part.mimetype,
      });
      part.value = file;
    },
  });
};
