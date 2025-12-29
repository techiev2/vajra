import { createServer } from 'node:http'
import { readFile, access } from 'fs/promises'

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
    Vajra.#MAX_FILE_SIZE = !+MAX_FILE_SIZE ? +maxFileSize * 1024 * 1024 : MAX_FILE_SIZE
    Vajra.#app = createServer()
    Vajra.#app.on('request', async (req, res) => {
      res.sent = false;
      res.status = (/**@type{code} Number*/ code) => {
        if (!+code || +code < 100 || +code > 599) { throw new Error(`Invalid status code ${code}`) }
        res.statusCode = code; res.statusSet = true; return res
      }
      res.json = data => {
        if (res.sent) return res
        if (!res.statusSet) res.statusCode = 200
        const response = JSON.stringify(data)
        res.sent = true; res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Length', Buffer.from(response).byteLength); res.write(response); res.end()
        return res
      }
      res.writeMessage = (message = '') => {
        if (res.sent) return res
        if (!message) { res.status(500); message = 'Server error'; }
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
      let url = `http://${req.headers.host || req.headers.host}/${req.url}`; req.query = Object.fromEntries(new URL(url).searchParams)
      if (req.method === 'GET' || req.method === 'HEAD') { return runMiddlwares() }
      async function runMiddlwares() {
        let idx = 0; const next = async () => { if (idx >= Vajra.#middlewares.length) { return setImmediate(handleRoute) } const fn = Vajra.#middlewares[idx]; idx++; try { await fn(req, res, next); } catch (err) { return default_500({ url: req.url, method: req.method }, res, err); } };
        await next();
      }
      setImmediate(() => {
        req.body = {}; req.rawData = ''; req.formData = {};let dataSize = 0
        req.on('data', (chunk) => { dataSize += chunk.length; if (dataSize > Vajra.#MAX_FILE_SIZE) { return default_413(res) }; req.rawData+=chunk })
        const formDataMatcher = /Content-Disposition: form-data; name=['"](?<name>[^"']+)['"]\s+(?<value>.*?)$/smi; const multiPartMatcher = /--------------------------.*?\r\n/gsmi
        const fileDataMatcher = /^Content-Disposition:.*?name=["'](?<field>[^"']+)["'].*?filename=["'](?<fileName>[^"']+)["'].*?Content-Type:\s*(?<contentType>[^\r\n]*)\r?\n\r?\n(?<content>[\s\S]*)$/ims
        req.on('end', async () => {
          req.files = []; req.rawData.split(multiPartMatcher).filter(Boolean).map((line) => {
            let key, value; if (line.includes('filename')) { req.files.push(fileDataMatcher.exec(line)?.groups || {}); return }
            [key, value] = Object.values(line.match(formDataMatcher)?.groups || {}); (key && value) && Object.assign(req.formData, { [key]: value });  return
          })
          if (Object.keys(req.formData).length) { req.body = req.formData } else {
            try { req.body = JSON.parse(req.rawData); req.isPossibleJSON = true } catch (_) { req.body = Object.fromEntries(req.rawData.split('&').map((pair) => pair.split('='))) }
          }; setImmediate(runMiddlwares)
        })
      })
      async function handleRoute() {
        let match_; const directHandler = (Vajra.#straightRoutes[req.url] || {})[req.method.toLowerCase()]
        if (directHandler) { try { await directHandler(req, res); if (!res.sent && !res.writableEnded) res.end() } catch (error) { return default_500(req, res, error) }; return }
        Object.entries(Vajra.#routes).map(([route, handler]) => {
          if (match_) { return }
          if (route === '/' && route !== req.url.split('?')[0]) { return } // FIXME: The case of a bare '/' is not handled right due to the pattern addition.
          const match = new RegExp(route).exec(req.url); if (!!match && handler[req.method.toLowerCase()]) { match_ = handler; Object.assign(req.params, match.groups); return }
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
      path.matchAll(paramMatcher).forEach(match => pathMatcherStr = pathMatcherStr.replace(match.groups.param, `{0,1}(?<${match.groups.param.slice(1)}>\\w{1,})`))
      if (path !== '/' && pathMatcherStr.endsWith('/')) { pathMatcherStr = pathMatcherStr.replace(/(\/)$/, '/?') }
      /*pathMatcherStr = `^${pathMatcherStr}$`; */Vajra.#routes[pathMatcherStr] = Object.assign(Vajra.#routes[pathMatcherStr] || {}, {[method]: handler})
      if (!paramMatcher.exec(path)?.groups) { Vajra.#straightRoutes[pathMatcherStr] = Object.assign(Vajra.#straightRoutes[pathMatcherStr] || {}, {[method]: handler}) }
      return defaults
    }
    function use(fn) {
      if (typeof fn !== "function") { throw new Error(`${fn} is not a function. Can't use as middleware`) }
      Vajra.#middlewares.push(fn);  return defaults
    }
    const defaults = Object.freeze(
      Object.assign({}, { use, setProperty, start }, Object.fromEntries('get__post__put__patch__delete__head__options'.split('__').map((method) => [method, (...args) => register(method, ...args)]))
    )); return Object.assign({}, { start }, defaults)
  }
}
