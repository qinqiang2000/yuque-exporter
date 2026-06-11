import path from 'path';
import { FeishuSDK, WikiNode } from './feishu-sdk.js';
import { writeFile, readJSON, exists, logger } from './utils.js';
import { config } from '../config.js';

export interface FeishuCrawlResult {
  spaceId: string;
  spaceName: string;
  nodes: WikiNode[];
  newEditTimeMap: Record<string, string>;
}

function getMetaDir() {
  return path.join(config.metaDir, 'feishu');
}

function getEditTimeMapPath(spaceId: string) {
  return path.join(getMetaDir(), `nodes-edit-time-${spaceId}.json`);
}

function getNodesPath() {
  return path.join(getMetaDir(), 'nodes.json');
}

async function loadEditTimeMap(spaceId: string): Promise<Record<string, string>> {
  const p = getEditTimeMapPath(spaceId);
  if (await exists(p)) return readJSON(p);
  return {};
}

async function collectNodes(sdk: FeishuSDK, spaceId: string, parentNodeToken?: string): Promise<WikiNode[]> {
  const children = parentNodeToken
    ? await sdk.getChildNodes(spaceId, parentNodeToken)
    : await sdk.getTopNodes(spaceId);

  const result: WikiNode[] = [];
  for (const node of children) {
    result.push(node);
    if (node.has_child) {
      const descendants = await collectNodes(sdk, spaceId, node.node_token);
      result.push(...descendants);
    }
  }
  return result;
}

export async function feishuCrawl(input: string): Promise<FeishuCrawlResult> {
  const sdk = new FeishuSDK({ appId: config.feishuAppId, appSecret: config.feishuAppSecret });
  await sdk.authorize();

  let spaceId: string;
  let spaceName: string;
  let allNodes: WikiNode[];

  // input can be a space_id (numeric) or a node_token (wiki/...)
  if (/^\d+$/.test(input)) {
    spaceId = input;
    logger.info(`[Feishu] Collecting all nodes from space: ${spaceId}`);
    allNodes = await collectNodes(sdk, spaceId);
  } else {
    logger.info(`[Feishu] Fetching root node: ${input}`);
    const rootNode = await sdk.getNodeInfo(input);
    spaceId = rootNode.space_id;
    logger.info(`[Feishu] Collecting nodes from space: ${spaceId}, root: ${rootNode.title}`);
    allNodes = [rootNode];
    if (rootNode.has_child) {
      const descendants = await collectNodes(sdk, spaceId, rootNode.node_token);
      allNodes.push(...descendants);
    }
    if (!rootNode.parent_node_token) {
      const topNodes = await collectNodes(sdk, spaceId);
      const seen = new Set(allNodes.map(n => n.node_token));
      for (const n of topNodes) {
        if (!seen.has(n.node_token)) allNodes.push(n);
      }
    }
  }

  // get space name
  const spaces = await sdk.getSpaces();
  const space = spaces.find(s => s.space_id === spaceId);
  spaceName = space?.name || spaceId;

  logger.info(`[Feishu] Found ${allNodes.length} nodes total`);

  // load old edit time map for incremental detection
  const oldEditTimeMap = await loadEditTimeMap(spaceId);
  const newEditTimeMap: Record<string, string> = {};
  for (const node of allNodes) {
    newEditTimeMap[node.node_token] = node.obj_edit_time;
  }

  // only fetch doc content for changed nodes
  const changedNodes = allNodes.filter(node =>
    (node.obj_type === 'docx' || node.obj_type === 'doc') &&
    oldEditTimeMap[node.node_token] !== node.obj_edit_time
  );

  logger.info(`[Feishu] ${changedNodes.length} documents changed, fetching blocks...`);

  for (const node of changedNodes) {
    logger.info(`[Feishu] Fetching: ${node.title}`);
    const blocks = await sdk.getDocBlocks(node.obj_token);
    await writeFile(
      path.join(getMetaDir(), 'docs', `${node.node_token}.json`),
      blocks,
    );
  }

  // save node list
  await writeFile(getNodesPath(), allNodes);

  return { spaceId, spaceName, nodes: allNodes, newEditTimeMap };
}
