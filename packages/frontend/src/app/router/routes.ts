import { createSpaRoute } from '@musetric/spa-router';
import { z } from 'zod';

const toNumber = z.string().transform(Number).pipe(z.number());

const projectIdSchema = z.object({ projectId: toNumber });

export const routes = {
  home: createSpaRoute({
    path: { pattern: '/' },
  }),
  projects: createSpaRoute({
    path: { pattern: '/projects/*' },
  }),
  projectsCreate: createSpaRoute({
    path: { pattern: '/projects/create' },
  }),
  projectsEdit: createSpaRoute({
    path: {
      pattern: '/projects/rename/:projectId',
      parseNativeParams: projectIdSchema.parse,
    },
  }),
  projectsPreview: createSpaRoute({
    path: {
      pattern: '/projects/preview/:projectId',
      parseNativeParams: projectIdSchema.parse,
    },
  }),
  projectsDelete: createSpaRoute({
    path: {
      pattern: '/projects/delete/:projectId',
      parseNativeParams: projectIdSchema.parse,
    },
  }),
  project: createSpaRoute({
    path: {
      pattern: '/project/:projectId',
      parseNativeParams: projectIdSchema.parse,
    },
  }),
  notFound: createSpaRoute({
    path: { pattern: '/not-found' },
  }),
  any: createSpaRoute({
    path: { pattern: '*' },
  }),
} as const;
