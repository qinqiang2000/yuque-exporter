import assert from 'assert/strict';
import { request, Dispatcher } from 'undici';
import { YuqueAPIError } from './errors.js';
import { config } from '../config.js';

export interface User {
  id: number;
  type: string;
  login: string;
  name: string;
  description: string;
  avatar_url: string;
  books_count: number;
  public_books_count: number;
  followers_count: number;
  following_count: number;
  public: number;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: number;
  type: string;
  namespace: string;
  slug: string;
  name: string;
  description: string;
  creator_id: number;
  public: number;
  items_count: number;
  likes_count: number;
  watches_count: number;
  content_updated_at: Date;
  updated_at: Date;
  created_at: Date;
  user_id: number;
  user: User;
}

export interface RepoDetail extends Repo {
  toc: string;
  toc_yml: string;
}

export interface Doc {
  id: number;
  slug: string;
  title: string;
  description: string;
  user_id: number;
  book_id: number;
  format: string;
  public: number;
  status: number;
  view_status: number;
  read_status: number;
  likes_count: number;
  read_count: number;
  comments_count: number;
  content_updated_at: string;
  created_at: string;
  updated_at: string;
  published_at: string;
  first_published_at: string;
  draft_version: number;
  last_editor_id: number;
  word_count: number;
  cover?: any;
  custom_description?: any;
  last_editor: User;
  book: Repo;
}

export interface DocDetail extends Doc {
  body: string;
  body_draft: string;
  body_html: string;
  body_lake: string;
  body_draft_lake: string;
  body_sheet: string; // JSON string for lakesheet format
}

export interface SDKOptions {
  token: string;
  host?: string;
  userAgent?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface ResponseData<T> {
  data?: T;
  message?: string;
  code?: number;
  meta?: {
    total?: number;
  };
}

export class SDK {
  private token: string;
  private host: string;
  private userAgent: string;
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;

  constructor(opts: SDKOptions) {
    this.token = opts.token;
    this.host = opts.host || 'https://www.yuque.com';
    this.userAgent = opts.userAgent || 'yuque-sdk';
    this.timeout = opts.timeout || 60000;
    this.maxRetries = opts.maxRetries || 3;
    this.retryDelay = opts.retryDelay || 1000;
    assert(this.token, 'Missing yuque token, see https://www.yuque.com/yuque/developer/api for more detail.');
  }

  async getUser(user = '') {
    const api = user ? `users/${user}` : 'user';
    return await this.requestAPI<User>(api);
  }

  async getRepos(user: string) {
    return await this.requestAPI<Repo[]>(`users/${user}/repos`);
  }

  async getRepoDetail(namespace: string) {
    return await this.requestAPI<RepoDetail>(`repos/${namespace}`);
  }

  async getDocs(namespace: string, onProgress?: (loaded: number, total: number) => void) {
    const allDocs: Doc[] = [];
    let offset = 0;
    const limit = 100; // Yuque API limit per page

    while (true) {
      const response = await this.request<Doc[]>(`repos/${namespace}/docs?offset=${offset}&limit=${limit}`);
      const docs = response.data || [];
      allDocs.push(...docs);

      // Check if we've fetched all documents
      const total = response.meta?.total || docs.length;

      // Report progress if callback provided
      if (onProgress) {
        onProgress(allDocs.length, total);
      }

      if (allDocs.length >= total || docs.length === 0) {
        break;
      }

      offset += limit;
    }

    return allDocs;
  }

  async getDocDetail(namespace: string, slug: string) {
    return await this.requestAPI<DocDetail>(`repos/${namespace}/docs/${slug}`);
  }

  async request<T>(api: string, retryCount = 0): Promise<ResponseData<T>> {
    const opts: Dispatcher.RequestOptions = {
      method: 'GET',
      path: `/api/v2/${api}`,
      headers: {
        'X-Auth-Token': this.token,
        'User-Agent': this.userAgent || 'yuque-sdk',
      },
      maxRedirections: 5,
      headersTimeout: this.timeout,
      bodyTimeout: this.timeout,
    };

    try {
      const { statusCode, body } = await request(this.host, opts);
      const json: ResponseData<T> = await body.json();

      if (statusCode !== 200) {
        const apiMessage = json?.message || 'Unknown error';
        switch (statusCode) {
          case 401:
            throw new YuqueAPIError(401,
              `Authentication failed: ${apiMessage}`,
              'Please check your YUQUE_TOKEN is valid and not expired.\n' +
              'Get a new token at: https://www.yuque.com/settings/tokens'
            );
          case 403:
            throw new YuqueAPIError(403,
              `Access denied: ${apiMessage}`,
              'You may not have permission to access this repository.'
            );
          case 404:
            throw new YuqueAPIError(404,
              `Resource not found: ${api}`,
              'Please check the repository path is correct (format: user/repo).'
            );
          case 429:
            throw new YuqueAPIError(429,
              'Rate limit exceeded',
              'Please wait a while before retrying. API limit: 5000 requests/hour.'
            );
          default:
            throw new YuqueAPIError(statusCode,
              `API request failed (${statusCode}): ${apiMessage}`
            );
        }
      }
      return json;
    } catch (error: any) {
      // Retry on network errors (timeout, connection refused, etc.)
      const isNetworkError = error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                            error.code === 'UND_ERR_HEADERS_TIMEOUT' ||
                            error.code === 'UND_ERR_BODY_TIMEOUT' ||
                            error.code === 'ECONNREFUSED' ||
                            error.code === 'ENOTFOUND' ||
                            error.code === 'ETIMEDOUT';

      if (isNetworkError && retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retryCount); // Exponential backoff
        console.error(`Request failed (${error.code}), retrying in ${delay}ms... (${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.request<T>(api, retryCount + 1);
      }

      // Don't retry on API errors (401, 403, 404, etc.)
      if (error instanceof YuqueAPIError) {
        throw error;
      }

      // Throw network error if max retries exceeded
      throw new YuqueAPIError(
        0,
        `Network error after ${retryCount} retries: ${error.message}`,
        'Please check your network connection and try again.'
      );
    }
  }

  async requestAPI<T>(api: string): Promise<T> {
    return await this.request<T>(api).then(x => x.data);
  }
}
