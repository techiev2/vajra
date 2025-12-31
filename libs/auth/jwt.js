import { subtle } from 'node:crypto';const hasBuffer = typeof Buffer !== 'undefined';
const DATA = { encoder: new TextEncoder(), decoder: new TextDecoder(), keys: {}, headers: { sign: { alg: 'HS256', typ: 'JWT' }, verify: { name: 'HMAC', hash: 'SHA-256' } } };
const ENCODED_HEADERS = {}
function encode(buf) { if (hasBuffer) return Buffer.from(buf).toString('base64url'); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function decode(str) { if (hasBuffer) return Buffer.from(str, 'base64url'); str = str.replace(/-/g,'+').replace(/_/g,'/'); while (str.length % 4) str += '='; const bin = atob(str); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;}
async function populateKeyCache(secret) {
  let { sign: signKey, verify: verifyKey } = DATA.keys[`${secret}`] || {};
  if (!signKey || !verifyKey) { [signKey, verifyKey] = await Promise.all([subtle.importKey('raw', DATA.encoder.encode(secret), DATA.headers.verify, false, ['sign']), subtle.importKey('raw', DATA.encoder.encode(secret), DATA.headers.verify, false, ['verify'])]); Object.assign(DATA.keys, { [secret]: { sign: signKey, verify: verifyKey } }) }
  return { signKey, verifyKey }
}
export async function sign(payload, secret, options = {}) {
  if (!payload || typeof payload !== 'object') throw new Error("Payload to sign must be an object"); if (typeof secret !== 'string') throw new Error("Secret must be a string")
  const { signKey } = await populateKeyCache(secret); const { alg = 'HS256' } = options;
  ENCODED_HEADERS[alg] = ENCODED_HEADERS[alg] || DATA.encoder.encode({ ...DATA.headers.sign, alg }); const encodedPayload = encode(DATA.encoder.encode(JSON.stringify({ ...payload, _gen_ts: Math.floor(Date.now() / 1000) })))
  const encodedSignature = encode(await subtle.sign('HMAC', signKey, DATA.encoder.encode(`${ENCODED_HEADERS[alg]}.${encodedPayload}`))); return `${ENCODED_HEADERS[alg]}.${encodedPayload}.${encodedSignature}`;
}
export async function verify(token, secret) {
  if (!token || typeof token != 'string') throw new Error("Token must be a string"); if (!secret || typeof secret !== "string") throw new Error("Secret must be a string")
  const [encodedHeader, encodedPayload, encodedSignature, ..._] = token.split('.'); if (!encodedPayload || !encodedSignature || _.length) throw new Error('Invalid token format');
  const { verifyKey } = await populateKeyCache(secret); const valid = await subtle.verify('HMAC', verifyKey, decode(encodedSignature), DATA.encoder.encode(`${encodedHeader}.${encodedPayload}`));
  if (!valid) throw new Error('Invalid signature'); const payload = JSON.parse(DATA.decoder.decode(decode(encodedPayload)));
  const genTs = payload._gen_ts; const now = Math.floor(Date.now() / 1000); const maxBackwardDrift = 300;
  if (typeof genTs === 'number' && (now + maxBackwardDrift < genTs)) { throw new Error('System clock appears to have moved backward — token rejected'); }
  delete payload._gen_ts; if (payload.exp && isNaN(+payload.exp)) throw new Error("Expiry must be numeric."); if (payload.exp && Date.now() >= payload.exp * 1000) { throw new Error('Token expired'); } return payload;
}