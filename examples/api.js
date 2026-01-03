import Vajra from '../index.js';
import { encode } from 'node:querystring';

async function getUsers(query = {}) {
  return (await fetch(`https://jsonplaceholder.typicode.com/users?${encode(query)}`)).json()
}

const { get, post, put, use, start, setProperty, log } = Vajra.create();

setProperty({ viewRoot: `${import.meta.dirname}/views` })

// use((req, res, next) => {
//   log(`${req.method} ${req.url}`)
//   next();
// });

get('/', ({ query = {} }, res) => {
  const { version } = query
  res.cookie('session', 'abc');
  res.cookie('theme', 'dark');
  res.cookie('user', 'test');
  res.writeMessage(version ? `Hello from Vajra (v${version}) ⚡` : 'Hello from Vajra ⚡');
});

get('/query', ({ query, params }, res) => {
  return res.json({ query, params, now: new Date().getTime() })
});

post('/upload', (req, res) => {
  res.json({ received: true, filesCount: req.files.length, files: req.files, body: req.body });
});

post('/post', ({ body, query, params }, res) => {
  return res.json({ query, params, body, now: new Date().getTime() })
})

put('/users/:id', ({ params, query, body }, res) => {
  return res.json({ params, query, body, now: new Date().getTime() })
})

start({ port: 4002 }, () => {
  console.log('Ready at http://localhost:4002');
});

get('/api/users', async ({ query }, res) => {
  const users = await getUsers(query)
  return res.json({ users })
})

get('/web/users', async ({ query }, res) => {
  const users = await getUsers(query)
  const headers = Object.keys(users[0]).slice(0, 2)
  return res.html(`users.html`, { users, headers })
})

get('/files/:path', async ({ params, params: { path }}, res) => {
  return res.sendFile(`${import.meta.dirname}/${path}`)
})