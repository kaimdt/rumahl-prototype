/**
 * Test setup for Bun.
 * Mocks necessary browser globals that are used in the application but
 * unavailable in the Node/Bun environment during testing.
 */

(globalThis as any).window = {
  location: {
    origin: 'http://backend.test',
    protocol: 'http:',
    pathname: '/',
    search: '',
    hash: ''
  }
};

// import.meta.env is partially supported by Bun, but we can ensure
// VITE_BACKEND_URL is set via process.env for the tests.
process.env.VITE_BACKEND_URL = 'http://backend.test';
