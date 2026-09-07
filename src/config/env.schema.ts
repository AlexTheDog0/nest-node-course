import * as z from 'zod';

export const schema = z.object({
  PORT: z.coerce.number().int().gt(0).max(65535),
  DB_HOST: z.string().trim().nonempty(),
  DB_USER: z.string().trim().nonempty(),
  DB_NAME: z.string().trim().nonempty(),
  DB_PORT: z.coerce.number().int().gt(0).max(65535).default(5432),
  DB_PASSWORD_FILE: z.string().trim().nonempty()
});

export type Env = z.infer<typeof schema>

export function validate(config: Record<string,unknown>) {
    const parseResult = schema.safeParse(config);
    
    if(!parseResult.success) {
        throw new Error(parseResult.error.message)
    }

    return parseResult.data;
}
