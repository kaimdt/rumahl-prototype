/**
 * Runtime Validation Helpers
 *
 * Utilities for validating data at runtime to catch errors early
 */

import { IoraError } from './client';

/**
 * Validation error with field context
 */
export class ValidationError extends Error {
  constructor(
    public field: string,
    message: string,
    public value?: any
  ) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
  }
}

/**
 * Validate that a value is a non-empty string
 */
export function validateString(value: any, fieldName: string, options: {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  required?: boolean;
} = {}): asserts value is string {
  if (options.required !== false && (value === undefined || value === null)) {
    throw new ValidationError(fieldName, 'is required');
  }

  if (value !== undefined && value !== null) {
    if (typeof value !== 'string') {
      throw new ValidationError(fieldName, `must be a string, got ${typeof value}`, value);
    }

    if (options.minLength !== undefined && value.length < options.minLength) {
      throw new ValidationError(
        fieldName,
        `must be at least ${options.minLength} characters, got ${value.length}`,
        value
      );
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      throw new ValidationError(
        fieldName,
        `must be at most ${options.maxLength} characters, got ${value.length}`,
        value
      );
    }

    if (options.pattern && !options.pattern.test(value)) {
      throw new ValidationError(
        fieldName,
        `does not match required pattern ${options.pattern}`,
        value
      );
    }
  }
}

/**
 * Validate that a value is a number
 */
export function validateNumber(value: any, fieldName: string, options: {
  min?: number;
  max?: number;
  integer?: boolean;
  required?: boolean;
} = {}): asserts value is number {
  if (options.required !== false && (value === undefined || value === null)) {
    throw new ValidationError(fieldName, 'is required');
  }

  if (value !== undefined && value !== null) {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError(fieldName, `must be a number, got ${typeof value}`, value);
    }

    if (options.integer && !Number.isInteger(value)) {
      throw new ValidationError(fieldName, `must be an integer, got ${value}`, value);
    }

    if (options.min !== undefined && value < options.min) {
      throw new ValidationError(fieldName, `must be at least ${options.min}, got ${value}`, value);
    }

    if (options.max !== undefined && value > options.max) {
      throw new ValidationError(fieldName, `must be at most ${options.max}, got ${value}`, value);
    }
  }
}

/**
 * Validate that a value is a boolean
 */
export function validateBoolean(value: any, fieldName: string, options: {
  required?: boolean;
} = {}): asserts value is boolean {
  if (options.required !== false && (value === undefined || value === null)) {
    throw new ValidationError(fieldName, 'is required');
  }

  if (value !== undefined && value !== null && typeof value !== 'boolean') {
    throw new ValidationError(fieldName, `must be a boolean, got ${typeof value}`, value);
  }
}

/**
 * Validate that a value is an array
 */
export function validateArray<T>(value: any, fieldName: string, options: {
  minLength?: number;
  maxLength?: number;
  itemValidator?: (item: any, index: number) => void;
  required?: boolean;
} = {}): asserts value is T[] {
  if (options.required !== false && (value === undefined || value === null)) {
    throw new ValidationError(fieldName, 'is required');
  }

  if (value !== undefined && value !== null) {
    if (!Array.isArray(value)) {
      throw new ValidationError(fieldName, `must be an array, got ${typeof value}`, value);
    }

    if (options.minLength !== undefined && value.length < options.minLength) {
      throw new ValidationError(
        fieldName,
        `must have at least ${options.minLength} items, got ${value.length}`,
        value
      );
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      throw new ValidationError(
        fieldName,
        `must have at most ${options.maxLength} items, got ${value.length}`,
        value
      );
    }

    if (options.itemValidator) {
      value.forEach((item, index) => {
        try {
          options.itemValidator!(item, index);
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new ValidationError(
              `${fieldName}[${index}].${error.field}`,
              error.message.split(': ')[1],
              error.value
            );
          }
          throw error;
        }
      });
    }
  }
}

/**
 * Validate that a value is an object
 */
export function validateObject(value: any, fieldName: string, options: {
  shape?: Record<string, (val: any, field: string) => void>;
  required?: boolean;
} = {}): asserts value is Record<string, any> {
  if (options.required !== false && (value === undefined || value === null)) {
    throw new ValidationError(fieldName, 'is required');
  }

  if (value !== undefined && value !== null) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationError(fieldName, `must be an object, got ${typeof value}`, value);
    }

    if (options.shape) {
      for (const [key, validator] of Object.entries(options.shape)) {
        try {
          validator(value[key], key);
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new ValidationError(
              `${fieldName}.${error.field}`,
              error.message.split(': ')[1],
              error.value
            );
          }
          throw error;
        }
      }
    }
  }
}

/**
 * Validate that a value is one of allowed values
 */
export function validateEnum<T extends string | number>(
  value: any,
  fieldName: string,
  allowedValues: T[],
  options: {
    required?: boolean;
  } = {}
): asserts value is T {
  if (options.required !== false && (value === undefined || value === null)) {
    throw new ValidationError(fieldName, 'is required');
  }

  if (value !== undefined && value !== null) {
    if (!allowedValues.includes(value)) {
      throw new ValidationError(
        fieldName,
        `must be one of [${allowedValues.join(', ')}], got ${value}`,
        value
      );
    }
  }
}

/**
 * Validate manifest structure
 */
export function validateManifest(manifest: any): void {
  validateString(manifest.id, 'id', { required: true, minLength: 1, maxLength: 100 });
  validateString(manifest.name, 'name', { required: true, minLength: 1 });
  validateString(manifest.version, 'version', {
    required: true,
    pattern: /^\d+\.\d+\.\d+$/
  });
  validateString(manifest.developer, 'developer', { required: true });
  validateString(manifest.description, 'description', { required: true });
  validateEnum(manifest.type, 'type', ['app', 'plugin'], { required: true });

  if (manifest.permissions) {
    validateArray(manifest.permissions, 'permissions', {
      itemValidator: (item, idx) => validateString(item, `permission[${idx}]`)
    });
  }
}

/**
 * Validate entity ID format
 */
export function validateEntityId(entityId: any, fieldName: string = 'entityId'): asserts entityId is string {
  validateString(entityId, fieldName, {
    required: true,
    pattern: /^[a-z_]+\.[a-z0-9_]+$/,
  });
}

/**
 * Validate app ID format
 */
export function validateAppId(appId: any, fieldName: string = 'appId'): asserts appId is string {
  validateString(appId, fieldName, {
    required: true,
    pattern: /^[a-z0-9-_]+$/,
    minLength: 1,
    maxLength: 100
  });
}

/**
 * Validate URL format
 */
export function validateUrl(url: any, fieldName: string = 'url'): asserts url is string {
  validateString(url, fieldName, { required: true });

  try {
    new URL(url);
  } catch {
    throw new ValidationError(fieldName, 'must be a valid URL', url);
  }
}

/**
 * Validate email format
 */
export function validateEmail(email: any, fieldName: string = 'email'): asserts email is string {
  validateString(email, fieldName, {
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  });
}

/**
 * Safe validation wrapper that returns a result instead of throwing
 */
export function trySafeValidate<T>(
  validator: () => void,
  value: any
): { valid: true; value: T } | { valid: false; error: ValidationError } {
  try {
    validator();
    return { valid: true, value: value as T };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { valid: false, error };
    }
    throw error;
  }
}

/**
 * Example usage patterns
 */

// Validate user input
export function validateUserInput(input: any): void {
  validateObject(input, 'input', {
    required: true,
    shape: {
      name: (val, field) => validateString(val, field, { required: true, minLength: 3 }),
      age: (val, field) => validateNumber(val, field, { required: true, min: 0, max: 150, integer: true }),
      email: (val, field) => validateEmail(val, field)
    }
  });
}

// Validate app configuration
export function validateAppConfig(config: any): void {
  validateObject(config, 'config', {
    required: true
  });

  if (config.timeout !== undefined) {
    validateNumber(config.timeout, 'config.timeout', { min: 0, max: 300000 });
  }

  if (config.retries !== undefined) {
    validateNumber(config.retries, 'config.retries', { min: 0, max: 10, integer: true });
  }
}

/**
 * Helper to validate function parameters
 */
export function validateParams(params: Record<string, any>, validators: Record<string, (val: any, field: string) => void>): void {
  for (const [key, validator] of Object.entries(validators)) {
    validator(params[key], key);
  }
}
