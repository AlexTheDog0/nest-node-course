import { readFile } from 'node:fs/promises'
import { schema } from '../dist/config/env.schema.js'

async function readEnvExample() {
    const PATH = './.env.example';
    const fileText = await readFile(PATH,'utf8');
    const lines = fileText.split('\n');

    const variablesName = [];
    lines.forEach(line => {
        line = line.trim();
        if(line.length === 0 || line.startsWith('#')) return;

        const splittedLine = line.split('=');
        variablesName.push(splittedLine[0].trim());
    })

    return variablesName;
}

async function matchSchemas(schema) {
    const zodSchemaKeys = Object.keys(schema.shape);
    const envExampleVariables = await readEnvExample();

    const missingKeys = zodSchemaKeys.filter(key => !envExampleVariables.includes(key));
    if(missingKeys.length > 0) throw new Error(`Missing keys in .env.example:${missingKeys}`);
};

await matchSchemas(schema);