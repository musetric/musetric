import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fastifySwagger } from '@fastify/swagger';
import { fastify } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';
import { api, type ApiRoute, type RequestMethod } from '../src/index.js';
import { fastifyRoute } from '../src/index.node.js';

const documentPath = fileURLToPath(new URL('../openapi.json', import.meta.url));

const documentInfo = {
  title: 'Musetric API',
  description: 'API documentation for Musetric',
  version: 'contract',
};

const requestMethods: RequestMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && Boolean(value);

type UnknownApiRoute = ApiRoute<
  RequestMethod,
  string,
  unknown,
  unknown,
  unknown
>;

const isApiRoute = (value: unknown): value is UnknownApiRoute => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  const method: unknown = Reflect.get(value, 'method');
  const path: unknown = Reflect.get(value, 'path');
  return (
    typeof path === 'string' &&
    requestMethods.some((candidate) => candidate === method)
  );
};

const collectRoutes = (): UnknownApiRoute[] => {
  const routes: UnknownApiRoute[] = [];
  Object.values(api).forEach((domain) => {
    Object.values(domain).forEach((operation) => {
      if (typeof operation !== 'object' || !operation) {
        return;
      }
      const base: unknown = Reflect.get(operation, 'base');
      if (isApiRoute(base)) {
        routes.push(base);
      }
    });
  });
  return routes.sort((left, right) =>
    `${left.path} ${left.method}`.localeCompare(
      `${right.path} ${right.method}`,
    ),
  );
};

const collectEventSchemas = (): Record<string, unknown> => {
  const schema = z.toJSONSchema(api.project.status.event.schema, {
    io: 'output',
  });
  Reflect.deleteProperty(schema, '$schema');
  return { ProjectStatusEvent: schema };
};

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value !== 'object' || !value) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => {
      sorted[key] = sortKeys(Reflect.get(value, key));
    });
  return sorted;
};

const buildDocument = async (): Promise<string> => {
  const app = fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifySwagger, {
    openapi: { info: documentInfo },
    transform: jsonSchemaTransform,
  });
  collectRoutes().forEach((route) => {
    app.route({
      ...fastifyRoute(route),
      handler: () => undefined,
    });
  });
  await app.ready();
  const document: Record<string, unknown> = { ...app.swagger() };
  await app.close();

  const { components } = document;
  const withEvents = {
    ...document,
    components: {
      ...(isRecord(components) ? components : undefined),
      schemas: {
        ...(isRecord(components) && isRecord(components.schemas)
          ? components.schemas
          : undefined),
        ...collectEventSchemas(),
      },
    },
  };
  const options = await resolveConfig(documentPath);
  return await format(JSON.stringify(sortKeys(withEvents)), {
    ...options,
    filepath: documentPath,
  });
};

const readDocument = async (): Promise<string | undefined> => {
  try {
    return await readFile(documentPath, 'utf8');
  } catch {
    return undefined;
  }
};

const run = async (): Promise<void> => {
  const document = await buildDocument();
  if (!process.argv.includes('--check')) {
    await writeFile(documentPath, document);
    console.log(`Wrote ${documentPath}`);
    return;
  }
  if ((await readDocument()) === document) {
    console.log('The OpenAPI document is up to date');
    return;
  }
  console.error(
    'The OpenAPI document is out of date. Run `yarn fix:openapi` and commit the result.',
  );
  process.exitCode = 1;
};

await run();
