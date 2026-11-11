// ============================================================
// Supabase → Firebase(rgqa26) 데이터 이전 스크립트 (1회용)
//
// 준비물 (둘 다 비밀 키이므로 깃/채팅에 올리지 마세요)
//  1) Supabase secret 키: Supabase 대시보드 → Project Settings → API Keys → Secret keys (sb_secret_...)
//     (또는 View legacy API keys 의 service_role 키)
//  2) Firebase 서비스 계정 키(JSON): Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"
//     → 내려받은 파일을 이 프로젝트 폴더에 serviceAccount.json 이름으로 저장
//
// 실행 (PowerShell, 프로젝트 폴더에서)
//   npm install
//   $env:SUPABASE_SERVICE_ROLE_KEY="여기에_키"
//   node scripts/migrate_supabase_to_firebase.mjs --dry-run   # 개수만 확인
//   node scripts/migrate_supabase_to_firebase.mjs             # 실제 이전
//
// - Supabase 주소는 .env.local 의 VITE_SUPABASE_URL 을 읽습니다 (또는 SUPABASE_URL 환경변수).
// - 문서 ID 를 Supabase ID 그대로 쓰므로 여러 번 실행해도 중복 생기지 않습니다(덮어쓰기).
// - Supabase 쪽 데이터는 읽기만 하고 바꾸지 않습니다.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry-run');
const root = process.cwd();

function readEnvFile(file) {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)
        .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')])
    );
  } catch { return {}; }
}
const envLocal = readEnvFile('.env.local');
const SUPABASE_URL = (process.env.SUPABASE_URL || envLocal.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || path.join(root, 'serviceAccount.json');

if (!SUPABASE_URL) throw new Error('Supabase 주소가 없습니다 (.env.local 의 VITE_SUPABASE_URL 또는 SUPABASE_URL).');
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수를 설정해주세요.');

// 새 secret 키(sb_secret_...)는 apikey 헤더만, 예전 service_role 키(eyJ...)는 Authorization 도 함께 보냅니다.
const headers = SERVICE_KEY.startsWith('eyJ')
  ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  : { apikey: SERVICE_KEY };

async function fetchTable(table) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) throw new Error(`${table} 읽기 실패: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function fetchUserEmails() {
  const map = {};
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers });
    if (!res.ok) throw new Error(`교사 계정 읽기 실패: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const users = body.users || [];
    users.forEach((u) => { map[u.id] = String(u.email || '').toLowerCase(); });
    if (users.length < 1000) break;
  }
  return map;
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const lower = (v) => (v ? String(v).trim().toLowerCase() : null);

export function transform(raw, emails) {
  const out = {};
  out.quiz_sets = raw.quiz_sets.map((r) => ({
    ...r, created_at: iso(r.created_at), game_type: r.game_type || 'bubble', bank_id: r.bank_id || null,
    teacher_email: emails[r.teacher_id] || null,
  }));
  out.question_banks = raw.question_banks.map((r) => ({
    ...r, created_at: iso(r.created_at), is_public: r.is_public !== false,
    question_count: r.question_count || 0,
    uploader_email: lower(r.uploader_email) || emails[r.uploaded_by] || null,
  }));
  for (const t of ['questions', 'bank_questions']) {
    out[t] = raw[t].map((r) => ({ ...r, created_at: iso(r.created_at), options: r.options || [], answers: r.answers || [] }));
  }
  out.students = raw.students.map((r) => ({
    ...r, last_accessed: iso(r.last_accessed), total_score: r.total_score || 0, stage_scores: r.stage_scores || {},
  }));
  out.student_logs = raw.student_logs.map((r) => ({ ...r, created_at: iso(r.created_at) }));
  return out;
}

const TABLES = ['question_banks', 'bank_questions', 'quiz_sets', 'questions', 'students', 'student_logs'];

async function main() {
  console.log(`Supabase: ${SUPABASE_URL}`);
  const raw = {};
  for (const t of TABLES) {
    raw[t] = await fetchTable(t);
    console.log(`  읽음 ${t}: ${raw[t].length}건`);
  }
  const emails = await fetchUserEmails();
  console.log(`  읽음 교사 계정: ${Object.keys(emails).length}명`);
  const data = transform(raw, emails);

  const noEmail = data.quiz_sets.filter((r) => !r.teacher_email).length;
  if (noEmail) console.warn(`  ⚠ 이메일을 찾지 못한 게임방 ${noEmail}개 (교사 재연결이 안 될 수 있음)`);

  if (DRY) { console.log('\n--dry-run: Firebase 에는 아무것도 쓰지 않았습니다.'); return; }

  let sa;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    sa = { project_id: process.env.FIREBASE_PROJECT_ID || 'demo-rgqa' }; // 테스트용 에뮬레이터
    initializeApp({ projectId: sa.project_id });
  } else {
    if (!fs.existsSync(SA_PATH)) throw new Error(`서비스 계정 키 파일이 없습니다: ${SA_PATH}`);
    sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
  }
  const db = getFirestore();
  console.log(`\nFirebase 프로젝트: ${sa.project_id} 에 쓰는 중...`);

  for (const t of TABLES) {
    const rows = data[t];
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      rows.slice(i, i + 400).forEach(({ id, ...rest }) => batch.set(db.collection(t).doc(String(id)), rest));
      await batch.commit();
    }
    console.log(`  저장 ${t}: ${rows.length}건`);
  }
  console.log('\n✅ 이전 완료. 교사들은 같은 구글 계정으로 로그인하면 자기 게임방/문제은행이 자동으로 연결됩니다.');
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error('❌', e.message); process.exit(1); });
}
