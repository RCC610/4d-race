// Data layer. Talks to Firebase Firestore in real use.
// With ?mock=ws://host:port it talks to the local test server instead (same API).
const CONFIG = {
  apiKey: "AIzaSyCsBFmBzbV6lrsJhDadBz4rJhDayzXeb18",
  authDomain: "d-race-bca86.firebaseapp.com",
  projectId: "d-race-bca86",
  storageBucket: "d-race-bca86.firebasestorage.app",
  messagingSenderId: "225610127648",
  appId: "1:225610127648:web:84cabf30b8b4faf9639f45"
};
const ROOT = 'games/live';

let api = null;

async function firebaseApi() {
  const fb = await import('./fb.js');
  const app = fb.initializeApp(CONFIG);
  const db = fb.initializeFirestore(app, { experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
  // Single docs (state, board) live in a 'meta' collection; Firestore paths must alternate collection/doc.
  const ref = p => fb.doc(db, ROOT + '/' + (p.includes('/') ? p : 'meta/' + p));
  const col = p => fb.collection(db, ROOT + '/' + p);
  return {
    watchDoc(p, cb, err) { return fb.onSnapshot(ref(p), s => cb(s.exists() ? s.data() : null), e => err && err(e)); },
    watchCol(p, cb, err) { return fb.onSnapshot(col(p), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => err && err(e)); },
    set(p, data, merge) { return fb.setDoc(ref(p), data, merge ? { merge: true } : undefined); },
    update(p, data) { return fb.updateDoc(ref(p), data); },
    async batch(ops) { // ops: [{p, data, merge, del}]
      for (let i = 0; i < ops.length; i += 400) {
        const b = fb.writeBatch(db);
        ops.slice(i, i + 400).forEach(o => o.del ? b.delete(ref(o.p)) : b.set(ref(o.p), o.data, o.merge ? { merge: true } : undefined));
        await b.commit();
      }
    },
    async clearCol(p) {
      const s = await fb.getDocs(col(p));
      await this.batch(s.docs.map(d => ({ p: p + '/' + d.id, del: true })));
    }
  };
}

function mockApi(url) {
  const ws = new WebSocket(url);
  const subs = new Map(); let sid = 0; let rid = 0; const pend = new Map();
  const ready = new Promise(r => ws.onopen = r);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.sub !== undefined) { const s = subs.get(m.sub); if (s) s(m.data); }
    if (m.rid !== undefined) { const f = pend.get(m.rid); if (f) { pend.delete(m.rid); f(); } }
  };
  const send = async o => { await ready; ws.send(JSON.stringify(o)); };
  const call = o => new Promise(r => { const id = ++rid; pend.set(id, r); send({ ...o, rid: id }); });
  const watch = (kind, p, cb) => { const id = ++sid; subs.set(id, cb); send({ op: 'watch', kind, p, sub: id }); return () => { subs.delete(id); send({ op: 'unwatch', sub: id }); }; };
  return {
    watchDoc: (p, cb) => watch('doc', p, cb),
    watchCol: (p, cb) => watch('col', p, cb),
    set: (p, data, merge) => call({ op: 'set', p, data, merge }),
    update: (p, data) => call({ op: 'set', p, data, merge: true }),
    batch: ops => call({ op: 'batch', ops }),
    clearCol: p => call({ op: 'clear', p })
  };
}

export async function store() {
  if (api) return api;
  const m = new URLSearchParams(location.search).get('mock');
  api = m ? mockApi(m) : await firebaseApi();
  return api;
}
