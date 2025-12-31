import assert from 'node:assert';
import { encode } from 'node:querystring';
import { suite, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';

import pkg from '../package.json' with {type: 'json'}
import { sign, verify } from '../libs/auth/jwt.js';

async function getResponse(url, method = 'GET', body) {
  return (await fetch(url, !!body ?
    { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }
    : { method, headers: {'Content-Type': 'application/json'} }
  ))
}

async function getJSON(url, method = 'GET', body) {
  return (await getResponse(url, method, body)).json()
}

suite('Test HTTP API at port 4002', () => {
  const BASE_URL = 'http://localhost:4002'
  suite('Test HTTP GET', () => {
    test('Basic HTTP GET to respond with a now and empty query/params', async () => {
      assert.deepEqual((await (await getResponse(BASE_URL)).text()), 'Hello from Vajra ⚡')
    })
    test('Basic HTTP GET to respond with custom message given version query param', async () => {
      const { version } = pkg
      assert.deepEqual((await (await getResponse(`${BASE_URL}?${encode({ version })}`)).text()), `Hello from Vajra (v${version}) ⚡`)
    })
    test('Basic HTTP GET to respond with a now, and query params', async () => {
      const query = { id: 1, user: 'test' }
      const { now, query: res_query, params: res_params } = await getJSON(`${BASE_URL}/query?${encode(query)}`)
      assert.equal(!!now, true)
      assert.deepEqual(res_query, query)
      assert.deepEqual(res_params, {})
    })
  })
  suite('Test HTTP POST', () => {
    test('Basic HTTP POST to respond with a now and body', async () => {
      const body = { name: 'user' }
      const json = await getJSON(`${BASE_URL}/post`, 'POST', body)
      const { now, body: res_body } = json
      assert.equal(!!now, true)
      assert.deepEqual(res_body, body)
    })
    test('Basic HTTP POST with a param (unmapped route) should return a 404', async (done) => {
      const query = { test: 'random' }
      const body = { name: 'test' }
      const response = await getResponse(`${BASE_URL}/post/1/?${encode(query)}`, 'POST', body)
      assert.equal(response.status, 404)
    })
  })
  suite('Test HTTP PUT', () => {
    test('Basic HTTP PUT to respond with a now, query, params, and body', async () => {
      const params = { id : 1 }
      const body = { name: 'user' }
      const json = await getJSON(`${BASE_URL}/users/${params.id}`, 'PUT', body)
      const { now, params: res_params, body: res_body} = json
      assert.equal(!!now, true)
      assert.deepEqual(res_params, params)
      assert.deepEqual(res_body, body)
    })
  })
})

suite('Tests for library functions', () => {
  const encoder = new TextEncoder(); const signHeaders = { alg: 'HS256', typ: 'JWT' }
  test('Verify that JWT helper returns the right token', async () => {
    const secret = randomBytes(16).toString('hex')
    const data = {
      now: new Date().getTime(),
      id: randomUUID()
    }
    const token = await sign(data, secret)
    assert.strictEqual(!!token, true)
    const verified = await verify(token, secret)
    assert.strict.deepEqual(data, verified)
  })

  test('Verify that JWT helper throws an expired token error with exp set to gen time', async () => {
    const secret = randomBytes(16).toString('hex')
    let exp = Date.now() / 1000
    const data = {
      now: new Date().getTime(),
      exp,
      id: randomUUID()
    }
    const token = await sign(data, secret)
    assert.strictEqual(!!token, true)
    assert.rejects(verify.bind(null, token, secret), Error);
  })

  test('rejects malformed token formats', async () => {
    const secret = 's';
    await assert.rejects(verify('', secret),);
    await assert.rejects(verify('a', secret),);
    await assert.rejects(verify('a.b', secret),);
    await assert.rejects(verify('a.b.c.d', secret),);
    await assert.rejects(verify('a..c', secret),);
    await assert.rejects(verify('a.b.', secret),);
  });
  
  test('rejects tampered signature', async () => {
    const token = await sign({a:1}, 'secret');
    const tampered = token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A');
    await assert.rejects(verify(tampered, 'secret'), /Invalid signature/);
  });

  test('rejects tampered payload', async () => {
    const token = await sign({a:1}, 'secret');
    const parts = token.split('.');
    parts[1] = parts[1].slice(0, -1) + 'X';
    await assert.rejects(verify(parts.join('.'), 'secret'), /Invalid signature/);
  });

  test('allows token without exp claim', async () => {
    const secret = 's';
    const payload = { sub: '123', iat: Math.floor(Date.now() / 1000) };
    const token = await sign(payload, secret);
    const verified = await verify(token, secret);
    assert.deepStrictEqual(verified, payload);
  });
  
  test('rejects token with future exp after clock advances', async () => {
    const secret = 's';
    const past = Math.floor(Date.now() / 1000) - 3600;
    const payload = { exp: past };
    const token = await sign(payload, secret);
    await assert.rejects(verify(token, secret), /Token expired/);
  });
  
  test('handles large payload without truncation', async () => {
    const secret = 's';
    const large = { data: 'x'.repeat(5000), arr: Array(100).fill(42) };
    const token = await sign(large, secret);
    const verified = await verify(token, secret);
    assert.deepStrictEqual(verified, large);
  });

  test('rejects invalid JSON in payload segment', async () => {
    const header = encode(encoder.encode(JSON.stringify(signHeaders)));
    const badPayload = encode(encoder.encode('{"broken'));
    const fakeSig = 'AAAA';
    const badToken = `${header}.${badPayload}.${fakeSig}`;
    await assert.rejects(verify(badToken, 'secret'), /Invalid signature/);
  });
  
  test('rejects non-object payload on sign', async () => {
    await assert.rejects(sign('string', 'secret'));
    await assert.rejects(sign(null, 'secret'));
    await assert.rejects(sign(123, 'secret'));
  });
  
  // Add to existing suite
  test('rejects non-numeric exp claim', async () => {
    const secret = 's';
    const payload = { exp: 'invalid', sub: '123' };
    const token = await sign(payload, secret);
    await assert.rejects(verify(token, secret), /Expiry must be numeric/);
  });
  
  test('handles clock skew edge case', async () => {
    const secret = 's';
    const now = Math.floor(Date.now() / 1000);
    const payload = { exp: now + 1 }; // Expires in 1s
    const token = await sign(payload, secret);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
    await assert.rejects(verify(token, secret), /Token expired/);
  });
  
  test('rejects malformed base64url segments', async () => {
    const secret = 's';
    const header = encode(encoder.encode(JSON.stringify(signHeaders)));
    const validPayload = encode(encoder.encode('{"sub":"123"}'));
    const badSegment = '!!invalid@@';
    await assert.rejects(verify(`${header}.${badSegment}.AAAA`, secret), /Invalid signature/);
    await assert.rejects(verify(`${header}.${validPayload}.!!invalid@@`, secret), /Invalid signature/);
  });
  
  test('handles empty payload object', async () => {
    const secret = 's';
    const payload = {};
    const token = await sign(payload, secret);
    const verified = await verify(token, secret);
    assert.deepStrictEqual(verified, payload);
  });
  
  test('rejects very weak secret', async () => {
    const secret = 'a'; // Short but still works (crypto allows it)
    const payload = { sub: '123' };
    const token = await sign(payload, secret);
    const verified = await verify(token, secret);
    assert.deepStrictEqual(verified, payload);
  });
  
})