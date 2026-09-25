import * as z from 'zod';

export const schema = z.object({
  PORT: z.coerce.number().int().gt(0).max(65535),
  CONFIG_SOURCE: z.enum(['file', 'infisical']).default('file'),
  DB_URL: z.string().refine(isPostgresUrl, 'Expected a PostgreSQL URL with user, password and database').optional(),
  INFISICAL_API_URL: z.url().optional(),
  INFISICAL_PROJECT_ID: z.string().trim().nonempty().optional(),
  INFISICAL_ENVIRONMENT: z.enum(['dev', 'prod']).optional(),
  INFISICAL_TOKEN_FILE: z.string().trim().nonempty().optional(),
  DB_HOST: z.string().trim().nonempty().optional(),
  DB_USER: z.string().trim().nonempty().optional(),
  DB_NAME: z.string().trim().nonempty().optional(),
  DB_PORT: z.coerce.number().int().gt(0).max(65535).default(5432),
  DB_PASSWORD_FILE: z.string().trim().nonempty().optional()
}).superRefine((config, context) => {
  const required = config.CONFIG_SOURCE === 'infisical'
    ? ['DB_URL', 'INFISICAL_API_URL', 'INFISICAL_PROJECT_ID', 'INFISICAL_ENVIRONMENT', 'INFISICAL_TOKEN_FILE'] as const
    : ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD_FILE'] as const;
  for (const key of required) {
    if (!config[key]) context.addIssue({ code: 'custom', path: [key], message: 'Required for selected CONFIG_SOURCE' });
  }
});

export function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && !!url.hostname && !!url.username && !!url.password
      && url.pathname.length > 1 && !url.search && !url.hash;
  } catch { return false; }
}

export function ignoreLocalEnv(): boolean {
  return process.env.CONFIG_SOURCE === 'infisical';
}

export type Env = z.infer<typeof schema>

export function validate(config: Record<string,unknown>) {
    const parseResult = schema.safeParse(config);
    
    if(!parseResult.success) {
        throw new Error(parseResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'))
    }

    return parseResult.data;
}
