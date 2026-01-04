# Vajra ⚡

![Vajra Thunderbolt](assets/vajra.jpg)  <!-- or use one of the above hosted URLs if you like -->


**Ultra-minimal, zero-dependency Node.js HTTP server**  
Routing · Middleware · Multipart parsing · HTML templating  
All in **111 lines** of pure JavaScript

## Name Origin

Vajra draws from the Rigvedic thunderbolt weapon of Indra — crafted from the bones of Sage Dadhichi, symbolizing unbreakable strength through selfless sacrifice.

Like the Vajra, this server delivers maximum power in minimal form.


[![npm version](https://img.shields.io/npm/v/@techiev2/vajra.svg?style=flat-square)](https://www.npmjs.com/package/@techiev2/vajra)
[![npm downloads](https://img.shields.io/npm/dm/vajra.svg?style=flat-square)](https://www.npmjs.com/package/@techiev2/vajra)
[![Node.js version](https://img.shields.io/node/v/@techiev2/vajra.svg?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@techiev2/vajra.svg?style=flat-square)](LICENSE)


## Changelog

### 1.5.1 (2026-01-04)
- Adds a pre-allocated buffer based body reader for improvement.

### 1.5.0 (2026-01-03)
- Adds support for res.sendFile.

### 1.4.3 (2026-01-02)
- Adds guardrails for unsafe operations with template paths.

### 1.4.2 (2026-01-02)
- Fixes bug in parsing params that dropped file extensions.

### 1.4.1 (2026-01-01)
- Added support to handle drift in system time after signing

### 1.4.0 (2025-12-31)
- Added full HS256 JWT support (`@techiev2/vajra/libs/auth/jwt.js`)
  - Ultra-minimal, zero-dependency implementation
  - Key and header caching for maximum performance
  - Robust base64url handling
  - Numeric exp validation and expiration checks

### 1.3.0 (2025-12-30)
- Performance improvements to routing in bare routes

### 1.2.0 (2025-12-30)
- Adds cookie support

### 1.0.0 (2025-12-25)
- Initial release

## Features

- Zero external dependencies
- Built-in routing with named parameters (`:id`)
- Asynchronous batched logging for performance
- Global middleware support with `next()` chaining
- JSON, urlencoded, and **multipart/form-data** body parsing
- Fast HTML templating with loops, nested objects, and simple array headers
- Helper methods: `res.json()`, `res.html()`, `res.status()`, `res.writeMessage()`
- Payload size limiting with 413 responses
- Sensible defaults for 404/405/500

## Performance (Apple M4, Node 20+)

| Test Case                                      | Vajra          | Express + Multer | Notes                     |
|------------------------------------------------|----------------|------------------|---------------------------|
| 1MB Multipart Upload (wrk -t16 -c600)          | **~94–98k req/s** | ~72k req/s      | +30% faster               |
| Idle RSS                                       | ~52–53 MB      | ~44 MB           | Zero deps vs extra packages |
| Peak RSS under load                            | ~228 MB        | ~209 MB          | Full buffering trade-off  |
| Code size (source)                             | **111 lines**  | ~2k+ lines       | Hand-crafted minimalism   |

## Performance Benchmarks (wrk)

![wrk multipart benchmarks on M4 and VPS](assets/wrk-benchmarks.png)

## Installation

```bash
npm install vajra
```


## Quick Start
```JavaScript
import Vajra from '../index.js';
import { encode } from 'node:querystring';

async function getUsers(query = {}) {
  return (await fetch(`https://jsonplaceholder.typicode.com/users?${encode(query)}`)).json()
}

const { get, post, use, start, setProperty, log } = Vajra.create();

setProperty({ viewsRoot: `${import.meta.url}/views` })
// Or as a key-value pair
// setProperty('viewsRoot', `${import.meta.url}/views`)

use((req, res, next) => {
  // Vajra provides an async batched logger to provide a balance between 100% log coverage and performance.
  // If you prefer blocking immediate logs, you can switch to console.log
  // or any other library of your choice.
  log(`${req.method} ${req.url}`);
  next();
});

get('/', (req, res) => {
  res.writeMessage('Hello from Vajra ⚡');
});

post('/upload', (req, res) => {
  res.json({ received: true, filesCount: req.files.length, files: req.files, body: req.body });
});

start({ port: 4002 }, () => {
  console.log('Ready at http://localhost:4002');
});

get('/api/users', async ({ query }, res) => {
  const users = await getUsers(query)
  return res.json({ users })
})

get('/web/users', async ({ query }, res) => {
  const users = await getUsers(query)
  const headers = Object.keys(users[0])
  return res.html(`users.html`, { users, headers })
})
```

## HTML Templating
```JavaScript
import Vajra from '../index.js';
const { get, post, use, start, setProperty } = Vajra.create();

get('/users', (req, res) => {
  const data = {
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ],
    headers: ['ID', 'Name']
  };

  // If no view root is set, .html() expects the absolute path.
  res.html('views/users.html', data);
});
```

#### views/users.html
```html
<table>
  <thead>
    {{# headers }}
      <th>{{ header@ }}</th>
    {{/ headers }}
  </thead>
  <tbody>
    {{# users }}
      <tr>
        <td>{{ id }}</td>
        <td>{{ name }}</td>
      </tr>
    {{/ users }}
  </tbody>
</table>
```

Supports:

- Loops ({{# array }} ... {{/ array }})
- Dot notation ({{ user.name }})
- Special header shorthand ({{ header@ }} for simple arrays)


## Configuration
```JavaScript
const app = vajra.create({
  maxFileSize: 10 // in MB (default: 2)
});

// Set view root path
app.setProperty('viewRoot', './views');
```


## API

- `get/post/put/patch/delete/head/options(path, handler)`
- `use(middleware)`
- `start({ port, host }, callback?)`
- `setProperty(key, value)` or `setProperty({ key: value })`
- `log(message)`


#### Response helpers:

`res.status(code)`
`res.json(data)`
`res.writeMessage(text)`
`res.html(pathOrString, data)`


## Philosophy

Vajra is built on the principle that minimalism can maximise outcomes.

Everything you need for real internal tools, admin panels, APIs, and prototypes — without the bloat.

No dependencies.
No build step.
Just copy `index.js` and go.


## Benchmarks & Memory
Run under extreme multipart load (wrk -t16 -c600 -d30s 1MB payloads):

Throughput: ~95k req/s
Idle RSS: ~52 MB
Peak under load: ~228 MB (drops back on idle)

## License
MIT

## Credits
Hand-crafted by [[Sriram Velamur](https://linkedin.com/in/techiev2)/[@techiev2](https://x.com/techiev2)]

Inspired by the desire for a truly tiny, powerful, and dependency-free Node server.
