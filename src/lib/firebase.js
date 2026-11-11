// Firebase(rgqa26) 연결 + 기존 Supabase 스타일 쿼리를 Firestore로 옮겨 주는 얇은 어댑터
// 페이지 코드에서는 db.from('테이블').select().eq()... 형태를 그대로 사용합니다.
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'rgqa26',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

// 관리자 이메일 (firestore.rules 의 isAdmin() 과 같게 유지)
export const ADMIN_EMAILS = ['gogh9@susaek.sen.es.kr'];

// ------------------------------------------------------------
// 인증
// ------------------------------------------------------------
const toUser = (u) => (u ? { id: u.uid, email: u.email, name: u.displayName, photo: u.photoURL } : null);

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return toUser(cred.user);
};

export const signOut = () => fbSignOut(auth);

export const getCurrentUser = async () => {
  await auth.authStateReady();
  const user = toUser(auth.currentUser);
  if (user) await claimLegacyData(user);
  return user;
};

// Supabase 에서 옮겨온 데이터는 교사 ID 가 옛 Supabase ID 로 들어 있으므로,
// 같은 이메일로 처음 로그인할 때 내 Firebase ID 로 바꿔 연결합니다.
const claimedThisSession = new Set();
export async function claimLegacyData(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email || claimedThisSession.has(user.id)) return;
  claimedThisSession.add(user.id);
  const jobs = [
    { table: 'quiz_sets', emailCol: 'teacher_email', idCol: 'teacher_id' },
    { table: 'question_banks', emailCol: 'uploader_email', idCol: 'uploaded_by' },
  ];
  for (const j of jobs) {
    try {
      const snap = await getDocs(query(collection(firestore, j.table), where(j.emailCol, '==', email)));
      const mine = snap.docs.filter((d) => d.data()[j.idCol] !== user.id);
      for (const part of chunk(mine, 450)) {
        const batch = writeBatch(firestore);
        part.forEach((d) => batch.update(d.ref, { [j.idCol]: user.id }));
        await batch.commit();
      }
    } catch (err) {
      console.error(`[firebase] 기존 ${j.table} 연결 실패:`, err);
    }
  }
}

export const onAuthChange = (cb) => fbOnAuthStateChanged(auth, (u) => cb(toUser(u)));

// ------------------------------------------------------------
// 테이블(컬렉션) 설정
// ------------------------------------------------------------
const nowIso = () => new Date().toISOString();

const DEFAULTS = {
  quiz_sets: () => ({ bank_id: null, game_type: 'bubble' }),
  questions: () => ({ question_num: '', options: [], answers: [], image_url: '' }),
  question_banks: () => ({ subject: '', description: '', is_public: true, question_count: 0 }),
  bank_questions: () => ({ question_num: '', options: [], answers: [], image_url: '' }),
  students: () => ({ total_score: 0, stage_scores: {}, last_accessed: nowIso() }),
  student_logs: () => ({ submitted_answer: '' }),
};

// 부모 삭제 시 함께 지울 자식 (Supabase 의 ON DELETE CASCADE 대체)
const CASCADES = {
  quiz_sets: [
    { table: 'questions', fk: 'quiz_set_id' },
    { table: 'students', fk: 'quiz_set_id' },
  ],
  students: [{ table: 'student_logs', fk: 'student_id' }],
  question_banks: [{ table: 'bank_questions', fk: 'bank_id' }],
};

// select('*, question_banks(...)') 같은 조인 처리
const JOINS = {
  question_banks: { kind: 'parent', fk: 'bank_id' },
  student_logs: { kind: 'children', fk: 'student_id' },
};

const snapToRow = (s) => ({ ...s.data(), id: s.id });

const compare = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
};

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function fetchWhere(table, filters) {
  const idFilter = filters.find((f) => f.col === 'id');
  if (idFilter) {
    const s = await getDoc(doc(firestore, table, String(idFilter.val)));
    if (!s.exists()) return [];
    const row = snapToRow(s);
    return filters.every((f) => row[f.col] === f.val) ? [row] : [];
  }
  const q = query(collection(firestore, table), ...filters.map((f) => where(f.col, '==', f.val)));
  const snap = await getDocs(q);
  return snap.docs.map(snapToRow);
}

async function deleteCascade(table, row) {
  for (const c of CASCADES[table] || []) {
    const children = await fetchWhere(c.table, [{ col: c.fk, val: row.id }]);
    for (const child of children) await deleteCascade(c.table, child);
  }
  await deleteDoc(doc(firestore, table, row.id));
}

async function attachJoins(rows, selectStr) {
  const names = [...String(selectStr || '').matchAll(/(\w+)\s*\(/g)].map((m) => m[1]);
  for (const name of names) {
    const j = JOINS[name];
    if (!j) continue;
    if (j.kind === 'parent') {
      const cache = {};
      for (const row of rows) {
        const key = row[j.fk];
        if (!key) { row[name] = null; continue; }
        if (!(key in cache)) {
          try {
            const s = await getDoc(doc(firestore, name, key));
            cache[key] = s.exists() ? snapToRow(s) : null;
          } catch {
            cache[key] = null; // 비공개 문제은행 등 읽기 권한이 없으면 null
          }
        }
        row[name] = cache[key];
      }
    } else {
      const ids = rows.map((r) => r.id);
      const byParent = {};
      for (const part of chunk(ids, 30)) {
        const snap = await getDocs(query(collection(firestore, name), where(j.fk, 'in', part)));
        snap.docs.map(snapToRow).forEach((c) => {
          (byParent[c[j.fk]] ||= []).push(c);
        });
      }
      rows.forEach((r) => {
        r[name] = (byParent[r.id] || []).sort((a, b) => compare(a.created_at, b.created_at));
      });
    }
  }
  return rows;
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.mode = 'select';
    this.filters = [];
    this.orders = [];
    this.limitN = null;
    this.selectStr = '*';
    this.returning = false;
    this.singleMode = null; // 'single' | 'maybe'
    this.payload = null;
  }

  select(str = '*') {
    if (this.mode === 'select') this.selectStr = str;
    else { this.returning = true; this.selectStr = str; }
    return this;
  }
  eq(col, val) { this.filters.push({ col, val }); return this; }
  order(col, opts = {}) { this.orders.push({ col, asc: opts.ascending !== false }); return this; }
  limit(n) { this.limitN = n; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  insert(rows) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows) { this.mode = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(values) { this.mode = 'update'; this.payload = values; return this; }
  delete() { this.mode = 'delete'; return this; }

  then(resolve, reject) {
    return this._run().then(resolve, reject);
  }

  async _run() {
    try {
      let rows = await this[`_${this.mode}`]();
      const wantsRows = this.mode === 'select' || this.returning || this.mode === 'delete';
      if (!wantsRows) return { data: null, error: null };

      rows = await attachJoins(rows, this.selectStr);

      if (this.orders.length) {
        rows.sort((a, b) => {
          for (const o of this.orders) {
            const c = compare(a[o.col], b[o.col]);
            if (c !== 0) return o.asc ? c : -c;
          }
          return 0;
        });
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);

      if (this.singleMode) {
        if (rows.length === 0) {
          return this.singleMode === 'maybe'
            ? { data: null, error: null }
            : { data: null, error: { message: '결과가 없습니다.', code: 'PGRST116' } };
        }
        return { data: rows[0], error: null };
      }
      return { data: rows, error: null };
    } catch (err) {
      console.error(`[firebase] ${this.mode} ${this.table} 실패:`, err);
      return { data: null, error: { message: err?.message || String(err), code: err?.code } };
    }
  }

  _select() {
    return fetchWhere(this.table, this.filters);
  }

  async _insert() {
    const base = Date.now();
    const made = this.payload.map((r, i) => {
      const ref = doc(collection(firestore, this.table));
      const data = {
        ...(DEFAULTS[this.table]?.() || {}),
        ...r,
        // 같은 배치 안의 순서를 유지하도록 1ms 씩 차이를 둡니다.
        created_at: r.created_at || new Date(base + i).toISOString(),
      };
      delete data.id;
      return { ref, data };
    });
    // 문제은행/문항 등은 batch 로 묶어서 한 번에 저장 (최대 500건씩)
    for (const part of chunk(made, 450)) {
      const batch = writeBatch(firestore);
      part.forEach(({ ref, data }) => batch.set(ref, data));
      await batch.commit();
    }
    return made.map(({ ref, data }) => ({ ...data, id: ref.id }));
  }

  async _upsert() {
    const out = [];
    for (const r of this.payload) {
      const { id, ...rest } = r;
      if (id) {
        await setDoc(doc(firestore, this.table, String(id)), rest, { merge: true });
        out.push({ ...rest, id });
      } else {
        const ref = doc(collection(firestore, this.table));
        const data = { ...(DEFAULTS[this.table]?.() || {}), ...rest, created_at: nowIso() };
        await setDoc(ref, data);
        out.push({ ...data, id: ref.id });
      }
    }
    return out;
  }

  async _update() {
    const values = { ...this.payload };
    delete values.id;
    const idFilter = this.filters.find((f) => f.col === 'id');
    if (idFilter && this.filters.length === 1 && !this.returning) {
      await updateDoc(doc(firestore, this.table, String(idFilter.val)), values);
      return [];
    }
    const targets = await fetchWhere(this.table, this.filters);
    for (const t of targets) await updateDoc(doc(firestore, this.table, t.id), values);
    return targets.map((t) => ({ ...t, ...values }));
  }

  async _delete() {
    const targets = await fetchWhere(this.table, this.filters);
    for (const t of targets) await deleteCascade(this.table, t);
    return targets;
  }
}

export const db = {
  from: (table) => new QueryBuilder(table),
};

// 문제은행 목록: 공개 + 내 것 (관리자는 전체). Supabase RLS 가 하던 필터를 클라이언트에서 수행
export async function fetchVisibleBanks(user) {
  try {
    let rows;
    if (user && ADMIN_EMAILS.includes(user.email)) {
      rows = (await getDocs(collection(firestore, 'question_banks'))).docs.map(snapToRow);
    } else {
      const reqs = [getDocs(query(collection(firestore, 'question_banks'), where('is_public', '==', true)))];
      if (user) reqs.push(getDocs(query(collection(firestore, 'question_banks'), where('uploaded_by', '==', user.id))));
      const snaps = await Promise.all(reqs);
      const map = new Map();
      snaps.forEach((s) => s.docs.forEach((d) => map.set(d.id, snapToRow(d))));
      rows = [...map.values()];
    }
    rows.sort((a, b) => -compare(a.created_at, b.created_at));
    return { data: rows, error: null };
  } catch (err) {
    console.error('[firebase] 문제은행 목록 조회 실패:', err);
    return { data: [], error: { message: err?.message || String(err) } };
  }
}
