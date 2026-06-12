import path from 'path';
import { request } from 'undici';
import { logger } from './utils.js';
import { config } from '../config.js';

const API_BASE = 'https://open.feishu.cn/open-apis';

export interface FeishuSDKOptions {
  appId: string;
  appSecret: string;
}

export interface WikiNode {
  space_id: string;
  node_token: string;
  obj_token: string;
  obj_type: string;
  parent_node_token: string;
  node_type: string;
  has_child: boolean;
  title: string;
  obj_create_time: string;
  obj_edit_time: string;
  node_create_time: string;
  creator: string;
  owner: string;
  url?: string;
}

export interface WikiSpace {
  space_id: string;
  name: string;
  description: string;
  space_type: string;
  visibility: string;
}

export interface TextElementStyle {
  bold: boolean;
  inline_code: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  link?: { url: string };
}

export interface TextRun {
  content: string;
  text_element_style: TextElementStyle;
}

export interface MentionDoc {
  token: string;
  obj_type: string;
  url: string;
  title: string;
}

export interface BlockElement {
  text_run?: TextRun;
  mention_doc?: MentionDoc;
}

export interface BlockStyle {
  align?: number;
  folded?: boolean;
  language?: number;
  wrap?: boolean;
}

export interface Block {
  block_id: string;
  block_type: number;
  parent_id: string;
  children?: string[];
  page?: { elements: BlockElement[]; style: BlockStyle };
  text?: { elements: BlockElement[]; style: BlockStyle };
  heading1?: { elements: BlockElement[]; style: BlockStyle };
  heading2?: { elements: BlockElement[]; style: BlockStyle };
  heading3?: { elements: BlockElement[]; style: BlockStyle };
  heading4?: { elements: BlockElement[]; style: BlockStyle };
  heading5?: { elements: BlockElement[]; style: BlockStyle };
  heading6?: { elements: BlockElement[]; style: BlockStyle };
  heading7?: { elements: BlockElement[]; style: BlockStyle };
  heading8?: { elements: BlockElement[]; style: BlockStyle };
  heading9?: { elements: BlockElement[]; style: BlockStyle };
  bullet?: { elements: BlockElement[]; style: BlockStyle };
  ordered?: { elements: BlockElement[]; style: BlockStyle };
  code?: { elements: BlockElement[]; style: BlockStyle };
  quote?: { elements: BlockElement[]; style: BlockStyle };
  todo?: { elements: BlockElement[]; style: BlockStyle; done: boolean };
  divider?: Record<string, never>;
  image?: { token: string; width: number; height: number };
  table?: { cells: string[]; property: { row_size: number; column_size: number } };
  table_cell?: Record<string, never>;
  callout?: { emoji_id: string; background_color: number; border_color: number };
  file?: { token: string; name: string };
}


function contentTypeToExt(contentType: string | undefined): string {
  if (!contentType) return 'png';
  const mime = contentType.split(';')[0].trim();
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/zip': 'zip',
  };
  return map[mime] || '';
}



export class FeishuSDK {
  private appId: string;
  private appSecret: string;
  private tenantToken: string = '';
  private tenantTokenExpireAt: number = 0;

  constructor(opts: FeishuSDKOptions) {
    this.appId = opts.appId;
    this.appSecret = opts.appSecret;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantToken && Date.now() < this.tenantTokenExpireAt) {
      return this.tenantToken;
    }
    const { body } = await request(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    const json: any = await body.json();
    if (json.code !== 0) throw new Error(`Feishu app auth failed: ${json.msg}`);
    this.tenantToken = json.tenant_access_token;
    this.tenantTokenExpireAt = Date.now() + (json.expire - 60) * 1000;
    return this.tenantToken;
  }

  async authorize(): Promise<void> {
    await this.getTenantAccessToken();
    logger.info('[Feishu] Token refreshed successfully');
  }

  private async getToken(): Promise<string> {
    return this.getTenantAccessToken();
  }

  private async get<T>(path: string, params: Record<string, string> = {}, retryCount = 0): Promise<T> {
    const token = await this.getToken();
    const query = new URLSearchParams(params).toString();
    const url = `${API_BASE}${path}${query ? '?' + query : ''}`;
    const { body, statusCode } = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json: any = await body.json();
    if (json.code !== 0) {
      // rate limit: wait and retry
      if ((json.code === 99991400 || statusCode === 400) && json.msg?.includes('frequency limit') && retryCount < 5) {
        const delay = 2000 * Math.pow(2, retryCount);
        logger.warn(`[Feishu] Rate limited, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return this.get<T>(path, params, retryCount + 1);
      }
      throw new Error(`Feishu API error [${statusCode}] ${path}: ${json.msg}`);
    }
    return json.data as T;
  }

  async getSpaces(): Promise<WikiSpace[]> {
    const spaces: WikiSpace[] = [];
    let pageToken = '';
    while (true) {
      const params: Record<string, string> = { page_size: '50' };
      if (pageToken) params.page_token = pageToken;
      const data = await this.get<{ items: WikiSpace[]; has_more: boolean; page_token: string }>(
        '/wiki/v2/spaces',
        params,
      );
      spaces.push(...(data.items || []));
      if (!data.has_more) break;
      pageToken = data.page_token;
    }
    return spaces;
  }

  async getNodeInfo(nodeToken: string): Promise<WikiNode> {
    const data = await this.get<{ node: WikiNode }>('/wiki/v2/spaces/get_node', { token: nodeToken });
    return data.node;
  }

  async getTopNodes(spaceId: string): Promise<WikiNode[]> {
    const nodes: WikiNode[] = [];
    let pageToken = '';
    while (true) {
      const params: Record<string, string> = { page_size: '50' };
      if (pageToken) params.page_token = pageToken;
      const data = await this.get<{ items: WikiNode[]; has_more: boolean; page_token: string }>(
        `/wiki/v2/spaces/${spaceId}/nodes`,
        params,
      );
      nodes.push(...(data.items || []));
      if (!data.has_more) break;
      pageToken = data.page_token;
    }
    return nodes;
  }

  async getChildNodes(spaceId: string, parentNodeToken: string): Promise<WikiNode[]> {
    const nodes: WikiNode[] = [];
    let pageToken = '';
    while (true) {
      const params: Record<string, string> = {
        parent_node_token: parentNodeToken,
        page_size: '50',
      };
      if (pageToken) params.page_token = pageToken;
      const data = await this.get<{ items: WikiNode[]; has_more: boolean; page_token: string }>(
        `/wiki/v2/spaces/${spaceId}/nodes`,
        params,
      );
      nodes.push(...(data.items || []));
      if (!data.has_more) break;
      pageToken = data.page_token;
    }
    return nodes;
  }

  async getDocBlocks(docToken: string): Promise<Block[]> {
    const blocks: Block[] = [];
    let pageToken = '';
    while (true) {
      const params: Record<string, string> = { page_size: '500' };
      if (pageToken) params.page_token = pageToken;
      const data = await this.get<{ items: Block[]; has_more: boolean; page_token: string }>(
        `/docx/v1/documents/${docToken}/blocks`,
        params,
      );
      blocks.push(...(data.items || []));
      if (!data.has_more) break;
      pageToken = data.page_token;
    }
    return blocks;
  }

  async downloadMedia(mediaToken: string, destPath: string): Promise<string> {
    return this.downloadDriveResource(`${API_BASE}/drive/v1/medias/${mediaToken}/download`, destPath);
  }

  async downloadFile(fileToken: string, destPath: string): Promise<string> {
    return this.downloadDriveResource(`${API_BASE}/drive/v1/files/${fileToken}/download`, destPath);
  }

  async downloadFileWithCookie(fileToken: string, destPath: string, cookie: string): Promise<string> {
    const url = `https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/all/${fileToken}`;
    const { body, statusCode, headers } = await request(url, {
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (statusCode !== 200) {
      let errMsg = `status ${statusCode}`;
      try { const t = await body.text(); errMsg = `status ${statusCode}, body: ${t.slice(0, 200)}`; } catch {}
      throw new Error(`Feishu cookie download failed: ${errMsg}`);
    }
    const contentType = headers['content-type'] as string | undefined;
    const destExt = path.extname(destPath).slice(1).toLowerCase();
    const ctExt = contentTypeToExt(contentType);
    const ext = destExt || ctExt || 'bin';
    const finalPath = destPath.replace(/\.[^.]+$/, '') + '.' + ext;
    const { mkdir } = await import('./utils.js');
    const { createWriteStream } = await import('fs');
    const { pipeline } = await import('stream/promises');
    await mkdir(path.dirname(finalPath));
    await pipeline(body as any, createWriteStream(finalPath));
    return finalPath;
  }

  private async downloadDriveResource(url: string, destPath: string): Promise<string> {
    const token = await this.getToken();
    const { body, statusCode, headers } = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (statusCode !== 200) {
      let errMsg = `status ${statusCode}`;
      try {
        const json: any = await body.json();
        errMsg = json.msg || errMsg;
      } catch {
        const text = await body.text().catch(() => '');
        errMsg = `status ${statusCode}, body: ${text.slice(0, 200)}`;
      }
      throw new Error(`Feishu download failed [${statusCode}]: ${errMsg}`);
    }
    const contentType = headers['content-type'] as string | undefined;
    const destExt = path.extname(destPath).slice(1).toLowerCase();
    const ctExt = contentTypeToExt(contentType);
    // prefer original filename extension; fall back to content-type; default png for images
    const ext = destExt || ctExt || 'png';
    const finalPath = destPath.replace(/\.[^.]+$/, '') + '.' + ext;
    const { mkdir } = await import('./utils.js');
    const { createWriteStream } = await import('fs');
    const { pipeline } = await import('stream/promises');
    await mkdir(path.dirname(finalPath));
    await pipeline(body as any, createWriteStream(finalPath));
    return finalPath;
  }
}
