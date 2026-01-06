/**
 * Custom error classes for yuque-exporter
 */

export class YuqueExporterError extends Error {
  suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = 'YuqueExporterError';
    this.suggestion = suggestion;
  }
}

export class YuqueAPIError extends YuqueExporterError {
  statusCode: number;

  constructor(statusCode: number, message: string, suggestion?: string) {
    super(message, suggestion);
    this.name = 'YuqueAPIError';
    this.statusCode = statusCode;
  }
}
