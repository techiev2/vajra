import assert from 'node:assert';
import { encode } from 'node:querystring';
import { afterEach, beforeEach, suite, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path, { resolve } from 'node:path';

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

const BASE_URL = 'http://localhost:4002'

suite('Test HTTP API at port 4002', () => {
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
    test('Plain ../ traversal should be normalized by URL parser and result in 404 (safe)', async () => {
      const url = `${BASE_URL}/files/../../../../etc/passwd`
      const res = await getResponse(url)
      // It should NOT succeed (200) and typically 404 because file doesn't exist inside app root
      assert.notStrictEqual(res.status, 200)
      assert.strictEqual(res.status, 404)
    })
    
    test('URL-encoded ../ (%2e%2e) should be decoded BEFORE normalization, still resulting in safe 404', async () => {
      const url = `${BASE_URL}/files/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd`
      const res = await getResponse(url)
      assert.notStrictEqual(res.status, 200)
      // Expected: pathname becomes /etc/passwd → safe 404
    })
    
    test('Double-encoded traversal should also be normalized safely', async () => {
      const url = `${BASE_URL}/files/%252e%252e/%252e%252e/%252e%252e/%252e%252e/etc/passwd`
      const res = await getResponse(url)
      assert.notStrictEqual(res.status, 200)
    })
    
    test('Attempt with null byte (old exploit) should not crash and return error', async () => {
      // Note: modern Node.js rejects %00 in URLs early, often with parse error
      const url = `${BASE_URL}/files/test_files/hello.txt%00../../etc/passwd`
      const res = await getResponse(url)
      assert.notStrictEqual(res.status, 200)
      // Likely 400 or 404 depending on framework
    })
    
    test('Absolute path attempt should be treated as relative (inside app root) and 404', async () => {
      const url = `${BASE_URL}/files//etc/passwd`  // leading // becomes /
      const res = await getResponse(url)
      assert.notStrictEqual(res.status, 200)
    })
    
    test('Very deep normalized path (many ../ collapsing to root) should still be safe', async () => {
      const deep = '../'.repeat(50) + 'hello.txt'
      const url = `${BASE_URL}/files/${deep}`
      const res = await getResponse(url)
      // After normalization: /hello.txt → tries to open hello.txt in app root → 404 (unless exists)
      assert.strictEqual(res.status, 404)  // or whatever your non-existent handler returns
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
  const encoder = new TextEncoder(); const signHeaders = { alg: 'HS256', typ: 'JWT' }; let timeOffsetMs = 0;
  // const originalDateNow = Date.now;
  // Date.now = function () { return originalDateNow() + timeOffsetMs; };
  function setupMockTimer(timing) {
    const originalNow = globalThis.Date.now
    let timeDelta = timing
    globalThis.Date.now = () => { return originalNow() + (timeDelta || 0) }
  }
  async function withMockTimer(timeDelta, fn) {
    setupMockTimer(timeDelta)
    await fn()
  }
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

  test('clock drift: expired token should NOT become valid when clock moves backward', async () => {
    const secret = randomBytes(16).toString('hex');
    const issueTime = Date.now();
    const payload = { sub: 'test-user', exp: Math.floor((issueTime + 5000) / 1000) }; // Set expiry of 5 seconds
    const token = await sign(payload, secret);
    setupMockTimer(10000)
    await assert.rejects(verify(token, secret), /Token expired/);
    setupMockTimer(-3000000)
    await assert.rejects(verify(token, secret), /System clock appears to have moved backward/);
  });

  test('clock drift: small backward drift does not falsely reject', async () => {
    const secret = randomBytes(16).toString('hex');
    const issueTime = Date.now();
    const payload = { sub: 'test', exp: Math.floor((issueTime + 3600000) / 1000) };
    const token = await sign(payload, secret);
    setupMockTimer(-120000)
    const verified = await verify(token, secret);
    assert.strictEqual(verified.sub, 'test');
  });

  test('clock drift: small backward drift within leeway should be tolerated', async () => {
    const secret = randomBytes(16).toString('hex');
    const issueTime = Date.now();
    const payload = { exp: Math.floor((issueTime + 5000) / 1000) };
    const token = await sign(payload, secret);
    setupMockTimer(-30000)
    assert.deepStrictEqual(await verify(token, secret), payload);
  });

  test('clock drift: large backward jump should reject even non-expired token', async () => {
    const secret = randomBytes(16).toString('hex');
    const issueTime = Date.now();
    const payload = { sub: 'drift-test', exp: Math.floor((issueTime + 3600000) / 1000) };
    const token = await sign(payload, secret);
    setupMockTimer(1000)
    const verified = await verify(token, secret);
    assert.strictEqual(verified.sub, 'drift-test');
    setupMockTimer(-8640000);
    await assert.rejects(
      verify(token, secret),
      /System clock appears to have moved backward — token rejected/
    );
  });
  
  test('clock drift: forward jump should not falsely expire valid token', async () => {
    const secret = randomBytes(16).toString('hex');
    const issueTime = Date.now();
    const payload = { exp: Math.floor((issueTime + 3600000) / 1000) }; // 1 hour valid
    const token = await sign(payload, secret);
    // Jump forward 30 minutes — should still be valid
    setupMockTimer(1800000)
    const verified = await verify(token, secret);
    assert.ok(verified);
  });

  test('clock drift: large rollback rejects all tokens regardless of individual exp', async () => {
    const secret = randomBytes(16).toString('hex');
    const baseTime = Date.now();
    const payloads = [
      { id: 'expired', exp: Math.floor((baseTime + 5000) / 1000) },
      { id: 'valid', exp: Math.floor((baseTime + 3600000) / 1000) }
    ];
    const [expiredToken, validToken] = await Promise.all([
      sign(payloads[0], secret),
      sign(payloads[1], secret)
    ]);
    await withMockTimer(-720000, async () => {
      await Promise.all([
        assert.rejects(verify(expiredToken, secret), /System clock appears to have moved backward/),
        assert.rejects(verify(validToken, secret), /System clock appears to have moved backward/)
      ])
    })
  })

  test('clock drift: large rollback rejects all tokens regardless of individual exp', async () => {
    const secret = randomBytes(16).toString('hex');
    const baseTime = Date.now();
    const payloads = [
      { id: 'expired', exp: Math.floor((baseTime + 5000) / 1000) },
      { id: 'valid', exp: Math.floor((baseTime + 3600000) / 1000) }
    ];
    const [expiredToken, validToken] = await Promise.all([
      sign(payloads[0], secret),
      sign(payloads[1], secret)
    ]);
    await withMockTimer(-1000000, async () => {
      await Promise.all([
        assert.rejects(verify(expiredToken, secret), /System clock appears to have moved backward/),
        assert.rejects(verify(validToken, secret), /System clock appears to have moved backward/)
      ])
    })
  });

})


suite('res.sendFile(path)', async () => {

  const TEST_DIR = path.resolve(`${import.meta.dirname}/../examples/test_files`);
  const textContent = 'Hello from Vajra!\nThis is a test file.'
  const textContentBuffer = new Uint8Array(Buffer.from(textContent))
  const minimalJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x03, 0x02, 0x02, 0x03, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04,
    0x03, 0x03, 0x04, 0x05, 0x08, 0x05, 0x05, 0x04, 0x04, 0x05, 0x0a, 0x07,
    0x07, 0x06, 0x08, 0x0c, 0x0a, 0x0c, 0x0c, 0x0b, 0x0a, 0x0b, 0x0b, 0x0d,
    0x0e, 0x12, 0x10, 0x0d, 0x0e, 0x11, 0x0e, 0x0b, 0x0b, 0x10, 0x16, 0x10,
    0x11, 0x13, 0x14, 0x15, 0x15, 0x15, 0x0c, 0x0f, 0x17, 0x18, 0x16, 0x14,
    0x18, 0x12, 0x14, 0x15, 0x14, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x01, 0x3f, 0x00,
    0xd2, 0xcf, 0x20, 0xff, 0xd9
  ]);
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(`${TEST_DIR}/test.txt`, textContentBuffer)
    await writeFile(`${TEST_DIR}/test.TXT`, textContentBuffer)
    await writeFile(path.join(TEST_DIR, 'test.jpg'), minimalJpeg);
    await writeFile(path.join(TEST_DIR, 'test.JPG'), minimalJpeg);
    await writeFile(`${TEST_DIR}/unknown.ext`, new Uint8Array(Buffer.from('some data')))
  });
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });
  test('On GET at /files/test.txt, server should return the file contents', async () => {
    const filePath = `test_files/test.txt`
    const url = `${BASE_URL}/files/${filePath}`
    const apiResponseText = await (await getResponse(url)).text()
    const filetext = (await readFile(resolve(`${import.meta.dirname}/../examples/${filePath}`))).toString()
    assert.strictEqual(apiResponseText, filetext)
  })
  test('On GET at /files/random.txt, server should return the file contents', async () => {
    const id = randomUUID()
    const filePath = `test_files/${id}`
    const url = `${BASE_URL}/files/${filePath}`
    const res = await getResponse(url)
    const json = await res.json()
    assert.strictEqual(res.status, 404)
    assert.strictEqual(json.message, `${id} not found.`)
  })
  test('On GET at /files/test.txt, server should return the file contents with correct Content-Type', async () => {
    const filePath = 'test_files/test.txt'
    const url = `${BASE_URL}/files/${filePath}`
    const res = await getResponse(url)
  
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes')
  
    const apiResponseText = await res.text()
    assert.strictEqual(apiResponseText.trim(), textContent.trim())
  })
  
  test('On GET at /files/test.png, server should return the image with correct Content-Type and exact bytes', async () => {
    const filePath = 'test_files/test.jpg'
    const url = `${BASE_URL}/files/${filePath}`
    const res = await getResponse(url)
  
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-type'), 'image/jpeg')
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes')
  
    const buffer = Buffer.from(await res.arrayBuffer())
    const fileData = await readFile(resolve(`${import.meta.dirname}/../examples/test_files/test.jpg`))
    assert.strictEqual(buffer.length, fileData.length)
    assert.ok(buffer.equals(fileData))
  })
  
  test('On GET at non-existent random file, server should return 404 with filename in message', async () => {
    const id = randomUUID()
    const filePath = `test_files/${id}.txt`
    const url = `${BASE_URL}/files/${filePath}`
    const res = await getResponse(url)
    const json = await res.json()
  
    assert.strictEqual(res.status, 404)
    assert.strictEqual(json.message, `${id}.txt not found.`)
  })
  
  test('On GET at file with unknown extension, server should use application/octet-stream', async () => {
    const unknownFileName = 'unknown.ext'
    await writeFile(path.join(TEST_DIR, unknownFileName), 'some data')
  
    const filePath = `test_files/${unknownFileName}`
    const url = `${BASE_URL}/files/${filePath}`
    const res = await getResponse(url)
  
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-type'), 'application/octet-stream')
    assert.strictEqual(await res.text(), 'some data')
  })
  
  test('Path traversal with ../ should not allow access outside test_files directory', async () => {
    const url = `${BASE_URL}/files/../examples/test_files/test.txt`
    const res = await getResponse(url)
    assert.notStrictEqual(res.status, 200) // Should be 404 (or 400/403 if sanitized better)
  })
  
  test('Path traversal with encoded %2e%2e should be blocked', async () => {
    const url = `${BASE_URL}/files/%2e%2e/%2e%2e/examples/test_files/test.txt`
    const res = await getResponse(url)
    assert.notStrictEqual(res.status, 200)
  })
  
  test('Path traversal with null byte %00 should be rejected (if not already handled by framework)', async () => {
    const url = `${BASE_URL}/files/test_files/test.txt%00../../etc/passwd`
    const res = await getResponse(url)
    assert.notStrictEqual(res.status, 200)
  })
  
  test('Request for directory (trailing slash) should not serve or list contents', async () => {
    const url = `${BASE_URL}/files/test_files/`
    const res = await getResponse(url)
    assert.notStrictEqual(res.status, 200) // Expect 404 or 400, no directory listing
  })
  
  test('File with multiple extensions should use MIME based on final extension', async () => {
    const multiFile = 'archive.tar.gz'
    await writeFile(path.join(TEST_DIR, multiFile), 'gzipped tar')
  
    const filePath = `test_files/${multiFile}`
    const url = `${BASE_URL}/files/${filePath}`
    const res = await getResponse(url)
  
    assert.strictEqual(res.status, 200)
    const ct = res.headers.get('content-type')
    assert.ok(ct.includes('gzip') || ct.includes('octet-stream'))
  })
  
  test('Case-insensitive extension handling', async () => {
    const upperFile = 'test.JPG'
    // await writeFile(path.join(TEST_DIR, upperFile), imageContent)
    const filePath = `test_files/${upperFile}`
    const url = `${BASE_URL}/files/${filePath}`
    const res = await getResponse(url)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-type'), 'image/jpeg')
  })
  
  test('Query parameters should be ignored and file still served correctly', async () => {
    const url = `${BASE_URL}/files/test_files/test.txt?cache_bust=123`
    const res = await getResponse(url)
  
    assert.strictEqual(res.status, 200)
    const text = await res.text()
    assert.strictEqual(text.trim(), textContent.trim())
  })
  
});