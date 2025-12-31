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
})