type JsonObject = Record<string, unknown>;

const MAX_SCHEMA_HINT_LENGTH = 12000;

export function validateToolArguments(args: unknown, schema: unknown): string[] {
    if (!isPlainObject(args)) {
        return ['arguments must be a JSON object. Use {} when the tool has no arguments.'];
    }

    if (!isPlainObject(schema)) {
        return ['This tool does not expose an inputSchema, so webcode cannot validate its arguments strictly.'];
    }

    return validateValue(args, schema, 'arguments');
}

export function formatToolArgumentValidationError(toolName: string, schema: unknown, errors: string[]): string {
    const schemaHint = JSON.stringify(schema ?? {}, null, 2);
    const clippedSchemaHint = schemaHint.length > MAX_SCHEMA_HINT_LENGTH
        ? `${schemaHint.slice(0, MAX_SCHEMA_HINT_LENGTH)}\n... schema truncated ...`
        : schemaHint;

    return [
        `Invalid arguments for tool "${toolName}". The tool was not executed.`,
        '',
        'Problems:',
        ...errors.map(error => `- ${error}`),
        '',
        'Correct the tool call so "arguments" exactly matches this tool inputSchema. Remove unknown fields, add every required field, and use the required JSON types.',
        '',
        'Expected arguments inputSchema:',
        '```json',
        clippedSchemaHint,
        '```',
        '',
        'Return one corrected tool call as a JSON code block:',
        '```json',
        JSON.stringify({
            mcp_action: 'call',
            name: toolName,
            purpose: 'Brief justification for this action',
            arguments: {}
        }, null, 2),
        '```'
    ].join('\n');
}

function validateValue(value: unknown, schema: JsonObject, path: string): string[] {
    const compositeErrors = validateCompositeSchemas(value, schema, path);
    if (compositeErrors) {
        return compositeErrors;
    }

    const enumErrors = validateEnum(value, schema, path);
    if (enumErrors.length > 0) {
        return enumErrors;
    }

    const constErrors = validateConst(value, schema, path);
    if (constErrors.length > 0) {
        return constErrors;
    }

    const typeErrors = validateType(value, schema, path);
    if (typeErrors.length > 0) {
        return typeErrors;
    }

    const errors: string[] = [];
    if (shouldValidateObjectMembers(value, schema)) {
        errors.push(...validateObjectMembers(value as JsonObject, schema, path));
    }
    if (Array.isArray(value)) {
        errors.push(...validateArrayMembers(value, schema, path));
    }
    errors.push(...validateScalarConstraints(value, schema, path));
    return errors;
}

function validateCompositeSchemas(
    value: unknown,
    schema: JsonObject,
    path: string
): string[] | null {
    const allOf = asSchemaArray(schema.allOf);
    if (allOf) {
        const errors = allOf.flatMap(subSchema => validateValue(value, subSchema, path));
        if (errors.length > 0) {
            return errors;
        }
    }

    const anyOf = asSchemaArray(schema.anyOf);
    if (anyOf) {
        if (anyOf.some(subSchema => validateValue(value, subSchema, path).length === 0)) {
            return null;
        }
        return [`${path} does not match any allowed schema variant.`];
    }

    const oneOf = asSchemaArray(schema.oneOf);
    if (oneOf) {
        const matchCount = oneOf.filter(subSchema => validateValue(value, subSchema, path).length === 0).length;
        return matchCount === 1 ? null : [`${path} must match exactly one allowed schema variant; matched ${matchCount}.`];
    }

    return null;
}

function validateEnum(value: unknown, schema: JsonObject, path: string): string[] {
    if (!Array.isArray(schema.enum)) {
        return [];
    }

    const matches = schema.enum.some(candidate => deepEqualJson(value, candidate));
    return matches ? [] : [`${path} must be one of: ${schema.enum.map(formatValue).join(', ')}.`];
}

function validateConst(value: unknown, schema: JsonObject, path: string): string[] {
    if (!Object.prototype.hasOwnProperty.call(schema, 'const')) {
        return [];
    }

    return deepEqualJson(value, schema.const) ? [] : [`${path} must be exactly ${formatValue(schema.const)}.`];
}

function validateType(value: unknown, schema: JsonObject, path: string): string[] {
    const expectedTypes = getExpectedTypes(schema);
    if (expectedTypes.length === 0 || expectedTypes.some(type => matchesJsonType(value, type))) {
        return [];
    }

    return [`${path} must be ${formatTypeList(expectedTypes)}, got ${getJsonType(value)}.`];
}

function validateObjectMembers(value: JsonObject, schema: JsonObject, path: string): string[] {
    const errors: string[] = [];
    const properties = getObjectMap(schema.properties);
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];

    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            errors.push(`${formatPath(path, key)} is required.`);
        }
    }

    const additionalProperties = schema.additionalProperties;
    for (const key of Object.keys(value)) {
        const propertySchema = properties[key];
        if (isPlainObject(propertySchema)) {
            errors.push(...validateValue(value[key], propertySchema, formatPath(path, key)));
            continue;
        }

        if (additionalProperties === false || additionalProperties === undefined) {
            errors.push(`${formatPath(path, key)} is not allowed by this tool's inputSchema.`);
            continue;
        }
        if (additionalProperties === true) {
            continue;
        }
        if (isPlainObject(additionalProperties)) {
            errors.push(...validateValue(value[key], additionalProperties, formatPath(path, key)));
        }
    }

    return errors;
}

function validateArrayMembers(value: unknown[], schema: JsonObject, path: string): string[] {
    const errors: string[] = [];
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        errors.push(`${path} must contain at least ${schema.minItems} item(s).`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
        errors.push(`${path} must contain at most ${schema.maxItems} item(s).`);
    }

    if (isPlainObject(schema.items)) {
        value.forEach((item, index) => {
            errors.push(...validateValue(item, schema.items as JsonObject, `${path}[${index}]`));
        });
    }

    return errors;
}

function validateScalarConstraints(value: unknown, schema: JsonObject, path: string): string[] {
    if (typeof value === 'string') {
        return validateStringConstraints(value, schema, path);
    }
    if (typeof value === 'number') {
        return validateNumberConstraints(value, schema, path);
    }
    return [];
}

function validateStringConstraints(value: string, schema: JsonObject, path: string): string[] {
    const errors: string[] = [];

    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        errors.push(`${path} must be at least ${schema.minLength} character(s).`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
        errors.push(`${path} must be at most ${schema.maxLength} character(s).`);
    }
    if (typeof schema.pattern === 'string' && !matchesPattern(value, schema.pattern)) {
        errors.push(`${path} must match pattern ${JSON.stringify(schema.pattern)}.`);
    }

    return errors;
}

function validateNumberConstraints(value: number, schema: JsonObject, path: string): string[] {
    const errors: string[] = [];

    if (typeof schema.minimum === 'number' && value < schema.minimum) {
        errors.push(`${path} must be >= ${schema.minimum}.`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
        errors.push(`${path} must be <= ${schema.maximum}.`);
    }

    return errors;
}

function shouldValidateObjectMembers(value: unknown, schema: JsonObject): boolean {
    return isPlainObject(value) && (
        isPlainObject(schema.properties) ||
        Array.isArray(schema.required) ||
        Object.prototype.hasOwnProperty.call(schema, 'additionalProperties') ||
        getExpectedTypes(schema).includes('object')
    );
}

function getExpectedTypes(schema: JsonObject): string[] {
    if (typeof schema.type === 'string') {
        return [schema.type];
    }
    if (Array.isArray(schema.type)) {
        return schema.type.filter((type): type is string => typeof type === 'string');
    }
    if (
        isPlainObject(schema.properties) ||
        Array.isArray(schema.required) ||
        Object.prototype.hasOwnProperty.call(schema, 'additionalProperties')
    ) {
        return ['object'];
    }
    if (isPlainObject(schema.items)) {
        return ['array'];
    }
    return [];
}

function matchesJsonType(value: unknown, type: string): boolean {
    switch (type) {
        case 'object':
            return isPlainObject(value);
        case 'array':
            return Array.isArray(value);
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'null':
            return value === null;
        default:
            return true;
    }
}

function getJsonType(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
}

function formatTypeList(types: string[]): string {
    return types.length === 1 ? `type "${types[0]}"` : `one of types ${types.map(type => `"${type}"`).join(', ')}`;
}

function getObjectMap(value: unknown): Record<string, unknown> {
    return isPlainObject(value) ? value : {};
}

function asSchemaArray(value: unknown): JsonObject[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const schemas = value.filter(isPlainObject);
    return schemas.length > 0 ? schemas : null;
}

function matchesPattern(value: string, pattern: string): boolean {
    try {
        return new RegExp(pattern).test(value);
    } catch {
        return false;
    }
}

function formatPath(parent: string, key: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function formatValue(value: unknown): string {
    return JSON.stringify(value) ?? String(value);
}

function deepEqualJson(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((item, index) => deepEqualJson(item, right[index]));
    }

    if (isPlainObject(left) || isPlainObject(right)) {
        if (!isPlainObject(left) || !isPlainObject(right)) {
            return false;
        }

        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        return leftKeys.length === rightKeys.length
            && leftKeys.every(key => (
                Object.prototype.hasOwnProperty.call(right, key)
                && deepEqualJson(left[key], right[key])
            ));
    }

    return false;
}

function isPlainObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
