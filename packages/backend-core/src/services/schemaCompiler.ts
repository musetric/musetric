import { type SwaggerTransform } from '@fastify/swagger';
import { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyInstance {
    schemaTransform: SwaggerTransform;
  }
}

export const registerSchemaCompiler = (app: FastifyInstance) => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('schemaTransform', jsonSchemaTransform);
};
