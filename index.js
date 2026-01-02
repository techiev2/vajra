import { createServer } from 'node:http'
import { readFile, access } from 'node:fs/promises'

const BLOCK_MATCHER=/{{\s*#\s*(?<grpStart>\w+)\s*}}\s*(?<block>.*?)\s*{{\s*\/\s*(?<grpEnd>\w+)\s*}}/gmsi; const INNER_BLOCK_MATCHER = /{\s*(.*?)\s*}/gmsi
const LOOP_MATCHER=/({\s*\w+@\s*})/gmis

function default_404({ url, method, isPossibleJSON }, res) {
  const message = `Route ${url} not found for method ${method}.`
  res.status(404); return isPossibleJSON ? res.json({ message }) : res.writeMessage(message)
}
function default_405({ url, method, isPossibleJSON }, res) {
  const message = `Method ${method} not allowed by route ${url}.`
  res.status(405); return isPossibleJSON ? res.json({ message }) : res.writeMessage(message)
}
function default_500({ url, method }, res, error) {
  process.env.DEBUG && console.log({ error })
  res.status(500).writeMessage(process.env.DEBUG ? `${error.stack}` : `Server error.\nRoute: ${url}\nMethod: ${method}\nTimestamp: ${new Date().getTime()}\n`)
}
function default_413(res) {
  res.status(413).writeMessage('Payload Too Large')
}

const MAX_MB = 2; const MAX_FILE_SIZE = MAX_MB * 1024 * 1024

export default class Vajra {
  static #app; static #routes = {}; static #middlewares = []; static #straightRoutes = {}; static #MAX_FILE_SIZE; static #onCreate; static #props = {}
  static create({ maxFileSize } = { maxFileSize: 2 }) {
    Vajra.#app = createServer()
    const _queue = []; const LOG_QUEUE_SIZE = 100; const logOut = () => { if (_queue.length) { process.stdout.write(`${_queue.join('').trim()}\n`) }; _queue.length = 0 };
    const flushAndShutDown = () => { logOut(); Vajra.#app.close(() => { process.exit(0); }); }; 'SIGINT_SIGTERM_SIGABRT'.split('_').map((evt) => process.on(evt, flushAndShutDown));
    process.on('exit', logOut); function log(message) { _queue.push(`${message}\n`); if (_queue.length >= LOG_QUEUE_SIZE) { logOut(); _queue.length = 0; } }
    Vajra.#MAX_FILE_SIZE = !+MAX_FILE_SIZE ? +maxFileSize * 1024 * 1024 : MAX_FILE_SIZE
    Vajra.#app.on('request', async (req, res) => {
      if (+(req.headers['Content-Length'] || req.headers['content-length']) > Vajra.#MAX_FILE_SIZE) { return default_413(res) }
      res.sent = false;
      res.status = (/**@type{code} Number*/ code) => {
        if (!+code || +code < 100 || +code > 599) { throw new Error(`Invalid status code ${code}`) }
        res.statusCode = code; res.statusSet = true; return res
      }
      res.json = data => {
        if (res.sent) return res
        if (!res.statusSet) res.statusCode = 200
        const response = JSON.stringify(data); res.sent = true; res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Length', Buffer.from(response).byteLength); res.write(response); res.end(); return res
      }
      res.writeMessage = (message = '') => {
        if (res.sent) { return res };  if (!message) { res.status(500); message = 'Server error'; }
        res.sent = true; res.setHeader('Content-Type', 'text/plain'); res.setHeader('Content-Length', Buffer.from(message).byteLength); res.write(message); res.end()
        return res
      }
      res.html = async (templatePath, data = {}) => {
        if (res.sent) { return res }; let content;
        if (this.#props.viewRoot) templatePath = `${this.#props.viewRoot}/${templatePath}`
        try { await access(templatePath); content = (await readFile(templatePath)).toString() } catch (_) { content = templatePath }
        content.matchAll(BLOCK_MATCHER).forEach((match) => {
          if (!match?.groups || (match.groups.grpStart !== match.groups.grpEnd)) { return }
          const data_ = (data[match.groups.grpStart] || []); if (match.groups.block.indexOf('@') !== -1) { content = content.replace(match[2], data_.map((key) => match.groups.block.replace(LOOP_MATCHER, key)).join('')); return }
          data_.forEach((dataItem) => { match.groups.block.matchAll(INNER_BLOCK_MATCHER).forEach((_match) => { const parts = _match[1].split('.').slice(1); let value = dataItem; parts.forEach((part) => (value = value ? value[part] : value)) ; content = content.replace(_match[0], value) }) })
        }); content = content.replace(/{{\s*# .*?\s*}}/gmsi, '').replace(/{{\s*\/.*?}}/gmsi, '')
        if (!res.statusSet) res.statusCode = 200
        res.sent = true; res.setHeader('Content-Type', 'text/html'); res.setHeader('Content-Length', Buffer.from(content).byteLength); res.write(content); res.end(); return res
      }
      req._headers = { ...req.headers }; req.headers = Object.fromEntries(req.rawHeaders.map((e, i) => i % 2 ? false : [e, req.rawHeaders[i + 1]]).filter(Boolean)); req.isPossibleJSON = req._headers['content-type'] === 'application/json'; req.params = {}
      res.cookie = (k, v, options) => {
        let { expires, path, maxAge, domain, secure, httpOnly, sameSite } = typeof options === 'object' ? options : typeof v === 'object' ? v : {}; const cookieOpts = [];!isNaN(+maxAge) && cookieOpts.push(`Max-Age=${Math.floor(maxAge)}`); !isNaN(+expires) && cookieOpts.push(`Expires=${new Date(expires).toUTCString()}`); expires instanceof Date && cookieOpts.push(`Expires=${expires.toUTCString()}`)
        path && cookieOpts.push(`Path=${path}`); domain && cookieOpts.push(`Domain=${domain}`); !!secure && cookieOpts.push(`Secure`); !!httpOnly && cookieOpts.push(`HttpOnly`); sameSite = sameSite && (sameSite === true ? 'Strict' : typeof sameSite === 'string' ? sameSite.charAt(0).toUpperCase() + sameSite.slice(1).toLowerCase() : ''); !['Strict', 'Lax', 'None'].includes(sameSite) ? sameSite = 'Strict' : sameSite = sameSite; cookieOpts.push(`SameSite=${sameSite}`)
        res.setHeader('Set-Cookie', (typeof k === 'object') ? Object.entries(k).map(([k_, v_]) => `${k_}=${encodeURIComponent(v_)}${cookieOpts.length ? `; ${cookieOpts.join('; ')}` : ''}`) : [...(res.getHeader('Set-Cookie') || []).filter(Boolean), `${k}=${encodeURIComponent(v)}${cookieOpts.length ? `; ${cookieOpts.join('; ')}` : ''}`])
      }
      let url = `http://${req.headers.host || req.headers.host}/${req.url}`; req.query = Object.fromEntries(new URL(url).searchParams)
      if (req.method === 'GET' || req.method === 'HEAD') { return runMiddlwares() }
      async function runMiddlwares() {
        let idx = 0; const next = async () => { if (idx >= Vajra.#middlewares.length) { return setImmediate(handleRoute) } const fn = Vajra.#middlewares[idx]; idx++; try { await fn(req, res, next); } catch (err) { return default_500({ url: req.url, method: req.method }, res, err); } };
        await next();
      }
      setImmediate(() => {
        req.body = {}; req.rawData = ''; req.formData = {}; let dataSize = 0
        req.on('data', (chunk) => { dataSize += chunk.length; if (dataSize > Vajra.#MAX_FILE_SIZE) { return default_413(res) }; req.rawData+=chunk })
        const formDataMatcher = /Content-Disposition: form-data; name=['"](?<name>[^"']+)['"]\s+(?<value>.*?)$/smi;
        let boundaryMatch = (req.headers['Content-Type'] || '').match(/boundary=(.*)/); const boundary = boundaryMatch ? '--' + boundaryMatch[1] : null; const fileDataMatcher = /^Content-Disposition:.*?name=["'](?<field>[^"']+)["'].*?filename=["'](?<fileName>[^"']+)["'].*?Content-Type:\s*(?<contentType>[^\r\n]*)\r?\n\r?\n(?<content>[\s\S]*)$/ims
        req.on('end', async () => {
          req.files = []; if (boundary) { req.rawData.split(boundary).filter(Boolean).map((line) => {
              let key, value; if (line.includes('filename')) { req.files.push(fileDataMatcher.exec(line)?.groups || {}); return }
              [key, value] = Object.values(line.match(formDataMatcher)?.groups || {}); (key && value) && Object.assign(req.formData, { [key]: value });  return
            })
          }
          if (Object.keys(req.formData).length) { req.body = req.formData } else {
            try { req.body = JSON.parse(req.rawData); req.isPossibleJSON = true } catch (_) { req.body = Object.fromEntries(req.rawData.split('&').map((pair) => pair.split('='))) }
          }; setImmediate(runMiddlwares)
        })
        req.cookies = Object.fromEntries((req.headers.Cookie || req.headers.cookie || '').split(/;\s*/).map((k) => k.split('=')).map(([k, v]) => [k.trim(), decodeURIComponent(v).trim()]))
      })
      async function handleRoute() {
        let _url = req.url.split('?')[0]; if (_url.endsWith('/')) _url = _url.split('/').slice(0, -1).join('/')
        let match_; const directHandler = (Vajra.#straightRoutes[_url] || Vajra.#straightRoutes[`${_url}/`] || {})[req.method.toLowerCase()]
        if (directHandler) { try { await directHandler(req, res); if (!res.sent && !res.writableEnded) res.end() } catch (error) { return default_500(req, res, error) }; return }
        Object.entries(Vajra.#routes).map(([route, handler]) => {
          if (match_) { return }; const match = new RegExp(route).exec(req.url); if (!!match && handler[req.method.toLowerCase()]) { match_ = handler; Object.assign(req.params, match.groups); return }
        })
        if (!match_) { return default_404(req, res) }
        if (!match_[req.method.toLowerCase()]) { return default_405(req, res) }
        try { await match_[req.method.toLowerCase()](req, res); if (!res.sent && !res.writableEnded) res.end() } catch (error) { return default_500(req, res, error) }
      }
    })
    function setProperty(k, v) { Object.assign(Vajra.#props, typeof k == 'object' ? k: { k: v }); return defaults }
    function start({ port, host = '127.0.0.1' }, cb) { Vajra.#app.listen(port, () => { console.log(`App listening at http://${host}:${port}`); if (typeof cb === 'function') { cb() } }); return defaults }
    function register(method, path, handler) {
      const paramMatcher = /.*?(?<param>\:[a-zA-Z]{1,})/g; let pathMatcherStr = path
      path.matchAll(paramMatcher).forEach(match => pathMatcherStr = pathMatcherStr.replace(match.groups.param, `{0,1}(?<${match.groups.param.slice(1)}>[\\w|\.]+)`))
      if (path !== '/' && pathMatcherStr.endsWith('/')) { pathMatcherStr = pathMatcherStr.replace(/(\/)$/, '/?') }
      if (!paramMatcher.exec(path)?.groups) { Vajra.#straightRoutes[pathMatcherStr] = Object.assign(Vajra.#straightRoutes[pathMatcherStr] || {}, { [method]: handler }); return }
      Vajra.#routes[pathMatcherStr] = Object.assign(Vajra.#routes[pathMatcherStr] || {}, {[method]: handler}); return defaults
    }
    function use(fn) {
      if (typeof fn !== "function") { throw new Error(`${fn} is not a function. Can't use as middleware`) }; Vajra.#middlewares.push(fn);  return defaults
    }
    const defaults = Object.freeze(Object.assign({}, { use, setProperty, start, log }, Object.fromEntries('get__post__put__patch__delete__head__options'.split('__').map((method) => [method, (...args) => register(method, ...args)])))); return Object.assign({}, { start }, defaults)
  }
}