import path from 'path';

export const config = {
  host: 'https://www.yuque.com',
  token: process.env.YUQUE_TOKEN,
  userAgent: 'yuque-exporter',
  outputDir: './storage',
  repoDir: undefined as string | undefined,
  clean: false,
  skipDraft: true,
  // Network settings
  timeout: 60000, // Request timeout in milliseconds (default: 60s)
  concurrency: 10, // Number of concurrent requests (default: 10)
  maxRetries: 3, // Maximum number of retries on failure (default: 3)
  retryDelay: 1000, // Initial delay between retries in milliseconds (default: 1s)
  get metaDir() {
    return path.join(config.outputDir, '.meta');
  },
};

