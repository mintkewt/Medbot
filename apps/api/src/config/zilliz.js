const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
require('dotenv').config();

const rawAddress = process.env.ZILLIZ_ENDPOINT;
const token = process.env.ZILLIZ_TOKEN;

if (!rawAddress || !token) {
  throw new Error('ZILLIZ_ENDPOINT and ZILLIZ_TOKEN must be set in .env');
}

/**
 * Zilliz Serverless: HTTPS on 443. Bare hostname or https without port → SDK often uses :19530 (wrong).
 * Also fix mistaken :19530 on *.cloud.zilliz.com / *serverless* hosts.
 */
function normalizeZillizAddress(address) {
  let s = address.trim().replace(/^["']|["']$/g, '');
  if (!s.includes('://')) {
    s = `https://${s.replace(/^\//, '')}`;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return address.trim();
  }
  const host = u.hostname.toLowerCase();
  const isServerless =
    host.includes('serverless') || host.endsWith('.cloud.zilliz.com');
  const portNum = u.port === '' ? null : Number(u.port);
  let protocol = u.protocol;
  if (protocol === 'http:' && isServerless) {
    protocol = 'https:';
  }
  if (protocol === 'https:' && isServerless) {
    const p = process.env.ZILLIZ_HTTPS_PORT || '443';
    const effective = portNum === null || portNum === 19530 ? p : String(portNum);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `https://${u.hostname}:${effective}${path}${u.search}${u.hash}`;
  }
  return s;
}

const address = normalizeZillizAddress(rawAddress);

const milvusClient = new MilvusClient({
  address: process.env.ZILLIZ_ENDPOINT,
  token: process.env.ZILLIZ_TOKEN,
  // Thêm đoạn này để nới lỏng thời gian chờ lên 60 giây (60000 ms)
  timeout: 60000 
});

module.exports = milvusClient;
