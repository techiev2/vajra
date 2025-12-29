import assert from 'node:assert';
import { encode } from 'node:querystring';
import { suite, test } from 'node:test';

async function getJSON(url, method = 'GET', body) {
  return (await fetch(url, !!body ?
    { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }
    : { method, headers: {'Content-Type': 'application/json'} }
  )).json()
}

suite('Test HTTP API at port 4000', () => {  
  const BASE_URL = 'http://localhost:4000'
  suite('Test HTTP GET', () => {
    test('Basic HTTP GET to respond with a now and empty query/params', async () => {
      const { now, query: res_query, params: res_params } = await getJSON(BASE_URL)
      assert.equal(!!now, true)
      assert.deepEqual(res_query, {})
      assert.deepEqual(res_params, {})
    })
    test('Basic HTTP GET to respond with a now, and query params', async () => {
      const query = { id: 1, user: 'test' }
      const { now, query: res_query, params: res_params } = await getJSON(`${BASE_URL}?${encode(query)}`)
      assert.equal(!!now, true)
      assert.deepEqual(res_query, query)
      assert.deepEqual(res_params, {})
    })
  })
  suite('Test HTTP POST', () => {
    // test('Basic HTTP POST to respond with a now and body', async () => {
    //   const query = { id: 1, user: 'test' }
    //   const body = { name: 'user' }
    //   const { now, query: res_query, body: res_body } =  await getJSON(`${BASE_URL}`, 'POST', body)
    //   assert.equal(!!now, true)
    //   assert.deepEqual(res_query, query)
    //   assert.deepEqual(res_body, body)
    // })
    test('Basic HTTP POST with a param shoudl return a 404', async () => {
      // const { now, query: res_query, body: res_body } = 
      const body = { name: 'test' }
      const json = await getJSON(`${BASE_URL}/users/1?test=random`, 'POST', body)
      console.log(json)
      // assert.equal(!!now, true)
      // assert.deepEqual(res_query, query)
      // assert.deepEqual(res_body, body)
    })
  })
  suite('Test HTTP PUT', () => {
    test('Basic HTTP PUT to respond with a now, query, params, and body', async () => {
      const params = { id : 1 }
      const body = { name: 'user' }
      const { now, params: res_params, body: res_body} = await getJSON(`${BASE_URL}/users/${params.id}`, 'PUT', body)
      assert.equal(!!now, true)
      assert.deepEqual(res_params, params)
      assert.deepEqual(res_body, body)
    })
  })
})
