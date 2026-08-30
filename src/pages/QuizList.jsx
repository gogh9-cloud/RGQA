/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { BUB_IMG_SRC } from '../lib/assets';
import * as XLSX from 'xlsx';
import { LogOut, Copy, Trash2, BarChart2, Plus, BookOpen, Lock, Globe, Upload, Download, Edit, ChevronDown, ChevronRight, ExternalLink, Sparkles } from 'lucide-react';
import AIQuizGeneratorModal from '../components/AIQuizGeneratorModal';

function convertDriveUrl(url) {
  if (!url || !url.trim()) return '';
  const raw = url.trim();
  if (raw.includes('drive.google.com/thumbnail')) return raw;
  let m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800`;
  m = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800`;
  m = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800`;
  return raw;
}

function parseOptions(cell) {
  if (!cell && cell !== 0) return [];
  const str = String(cell).trim();
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function parseAnswers(cell) {
  if (!cell && cell !== 0) return [];
  const str = String(cell).trim();
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

const ADMIN_EMAILS = ['gogh9@susaek.sen.es.kr'];

const QuizList = ({ user }) => {
  const [quizSets, setQuizSets] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomGameType, setNewRoomGameType] = useState('bubble');
  const [selectedBankId, setSelectedBankId] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadData, setUploadData] = useState({ title: '', subject: '', isPublic: true, validRows: [] });
  const [showAIModal, setShowAIModal] = useState(false);
  const fileRef = useRef();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('rooms');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editBankData, setEditBankData] = useState({ id: '', title: '', isPublic: true });
  const [expandedBank, setExpandedBank] = useState(null);
  const [bankQuestions, setBankQuestions] = useState({});
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [editQForm, setEditQForm] = useState({ question_text: '', options: '', answers: '', image_url: '' });

  const isAdmin = ADMIN_EMAILS.includes(user?.email);

  const fetchQuizSets = useCallback(async () => {
    const { data } = await supabase
      .from('quiz_sets')
      .select('*, question_banks(title, subject)')
      .eq('teacher_id', user.id)
      .order('created_at', { ascending: false });
    setQuizSets(data || []);
  }, [user.id]);

  const fetchBanks = useCallback(async () => {
    const { data } = await supabase
      .from('question_banks')
      .select('id, title, subject, question_count, is_public, uploader_email, uploaded_by')
      .order('created_at', { ascending: false });
    setBanks(data || []);
  }, []);

  useEffect(() => {
    Promise.all([fetchQuizSets(), fetchBanks()]).finally(() => setLoading(false));
  }, [fetchQuizSets, fetchBanks]);

  const createRoom = async () => {
    if (!newRoomTitle.trim() || !selectedBankId) {
      alert('방 이름과 문제 은행을 선택해 주세요.');
      return;
    }
    setCreating(true);
    const linkCode = Math.random().toString(36).substring(2, 10);
    const { data, error } = await supabase
      .from('quiz_sets')
      .insert([{
        title: newRoomTitle.trim(),
        teacher_id: user.id,
        link_code: linkCode,
        bank_id: selectedBankId,
        game_type: newRoomGameType
      }])
      .select('*, question_banks(title, subject)')
      .single();

    if (error) {
      alert('게임방 생성에 실패했습니다: ' + error.message);
      console.error(error);
    } else {
      setQuizSets(prev => [data, ...prev]);
      setShowCreateModal(false);
      setNewRoomTitle('');
      setNewRoomGameType('bubble');
      setSelectedBankId('');
    }
    setCreating(false);
  };

  const deleteQuizSet = async (id) => {
    if (!window.confirm('게임방을 삭제하시겠습니까? 학생 기록도 함께 삭제됩니다.')) return;
    const { error } = await supabase.from('quiz_sets').delete().eq('id', id);
    if (!error) setQuizSets(prev => prev.filter(q => q.id !== id));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const copyLink = (linkCode) => {
    const url = `${window.location.origin}/game?room=${linkCode}`;
    navigator.clipboard.writeText(url);
    alert('공유 링크가 복사되었습니다!\n' + url);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

      const firstRow = rows[0];
      const hasHeader = firstRow && (
        String(firstRow[0] || '').includes('문항') || 
        String(firstRow[0] || '').toLowerCase().includes('num') ||
        String(firstRow[0] || '').toLowerCase().includes('no')
      );
      const dataRows = hasHeader ? rows.slice(1) : rows;

      const validRows = dataRows.filter(r => r && r[1] && String(r[1]).trim());

      if (validRows.length === 0) {
        alert('유효한 문제가 없습니다. 엑셀 형식을 확인하세요.\n(A:문항번호 B:문항 C:선택지 D:이미지 E:정답)');
        setUploading(false);
        return;
      }

      setUploadData({ title: '', subject: '', isPublic: true, validRows });
      setShowUploadModal(true);
    } catch (err) {
      console.error(err);
      alert('파일 읽기 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const confirmUpload = async () => {
    if (!uploadData.title.trim()) {
      alert('문제 은행 이름을 입력해주세요.');
      return;
    }

    setUploading(true);
    setShowUploadModal(false);
    try {
      const { data: bank, error: bankErr } = await supabase
        .from('question_banks')
        .insert([{
          title: uploadData.title,
          subject: uploadData.subject,
          is_public: uploadData.isPublic,
          uploaded_by: user.id,
          uploader_email: user.email,
          question_count: uploadData.validRows.length
        }])
        .select()
        .single();

      if (bankErr) throw bankErr;

      const questions = uploadData.validRows.map(r => ({
        bank_id: bank.id,
        question_num: r[0] ? String(r[0]).trim() : '',
        question_text: String(r[1] || '').trim(),
        options: parseOptions(r[2]),
        answers: parseAnswers(r[4]),
        image_url: convertDriveUrl(r[3])
      }));

      const { error: qErr } = await supabase.from('bank_questions').insert(questions);
      if (qErr) throw qErr;

      alert(`✅ "${uploadData.title}" 업로드 완료!\n총 ${uploadData.validRows.length}개 문제가 저장되었습니다.`);
      setBanks(prev => [bank, ...prev]);
    } catch (err) {
      console.error(err);
      alert('업로드 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveAIGeneratedBank = async ({ title, subject, isPublic, questions }) => {
    const { data: bank, error: bankErr } = await supabase
      .from('question_banks')
      .insert([{
        title,
        subject: subject || '',
        is_public: isPublic,
        uploaded_by: user.id,
        uploader_email: user.email,
        question_count: questions.length
      }])
      .select()
      .single();

    if (bankErr) throw bankErr;

    const dbQuestions = questions.map(q => ({
      bank_id: bank.id,
      question_num: q.question_num || '',
      question_text: q.question_text || '',
      options: q.options || [],
      answers: q.answers || ['1'],
      image_url: ''
    }));

    const { error: qErr } = await supabase.from('bank_questions').insert(dbQuestions);
    if (qErr) throw qErr;

    alert(`✅ "${title}" 문제 은행 생성이 완료되었습니다!\n총 ${questions.length}문항이 등록되었습니다.`);
    setBanks(prev => [bank, ...prev]);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['문항번호', '문항', '선택지', '이미지링크(선택)', '정답'],
      [1, '1+1은 얼마입니까?', '1,2,3,4,5', '', '2'],
      [2, '이 동물의 이름은 무엇입니까?', '', 'https://drive.google.com/uc?id=1exa', '고양이']
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, '문제은행_템플릿.xlsx');
  };

  const deleteBank = async (id) => {
    if (!window.confirm('문제 은행을 삭제하시겠습니까?\n연결된 게임방이 있다면 해당 게임방에서는 문제가 보이지 않을 수 있습니다.')) return;
    const { data, error } = await supabase.from('question_banks').delete().eq('id', id).select();
    if (error || !data || data.length === 0) {
      alert(`삭제 실패: 권한이 없거나 삭제할 수 없는 상태입니다.\n(사유: ${error?.message || '알 수 없는 오류'})`);
    } else {
      setBanks(prev => prev.filter(b => b.id !== id));
      if (expandedBank === id) setExpandedBank(null);
    }
  };

  const updateBank = async () => {
    if (!editBankData.title.trim()) {
      alert('주제(단원)을 입력해주세요.');
      return;
    }
    setUploading(true);
    try {
      const { error } = await supabase
        .from('question_banks')
        .update({ title: editBankData.title, is_public: editBankData.isPublic })
        .eq('id', editBankData.id);
      
      if (error) throw error;
      
      setBanks(prev => prev.map(b => b.id === editBankData.id ? { ...b, title: editBankData.title, is_public: editBankData.isPublic } : b));
      setShowEditModal(false);
      alert('성공적으로 수정되었습니다.');
    } catch (err) {
      alert('수정 실패: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const fetchBankQuestions = async (bankId) => {
    if (bankQuestions[bankId]) return;
    const { data } = await supabase
      .from('bank_questions')
      .select('*')
      .eq('bank_id', bankId)
      .order('id', { ascending: true });
    setBankQuestions(prev => ({ ...prev, [bankId]: data || [] }));
  };

  const toggleExpand = (bankId) => {
    if (expandedBank === bankId) {
      setExpandedBank(null);
    } else {
      setExpandedBank(bankId);
      fetchBankQuestions(bankId);
    }
  };

  const copyBank = async (bank) => {
    if (!window.confirm(`"${bank.title}" 문제 은행을 내 문제로 가져오시겠습니까?`)) return;
    
    const { data: originalQuestions, error: fetchErr } = await supabase
      .from('bank_questions')
      .select('*')
      .eq('bank_id', bank.id);
      
    if (fetchErr) {
      alert('문제 목록을 불러오지 못했습니다.');
      return;
    }

    const { data: newBank, error: bankErr } = await supabase
      .from('question_banks')
      .insert([{
        title: `${bank.title} (복사본)`,
        subject: bank.subject,
        is_public: false,
        uploaded_by: user.id,
        uploader_email: user.email,
        question_count: bank.question_count
      }])
      .select()
      .single();
      
    if (bankErr) {
      alert('문제 은행 복사에 실패했습니다.');
      return;
    }

    if (originalQuestions && originalQuestions.length > 0) {
      const newQuestions = originalQuestions.map(q => ({
        bank_id: newBank.id,
        question_num: q.question_num,
        question_text: q.question_text,
        options: q.options,
        answers: q.answers,
        image_url: q.image_url
      }));
      
      const { error: qErr } = await supabase.from('bank_questions').insert(newQuestions);
      if (qErr) {
        alert('문항 복사에 실패했습니다.');
        return;
      }
    }
    
    alert('내 문제로 성공적으로 가져왔습니다!');
    setBanks(prev => [newBank, ...prev]);
    setActiveTab('banks');
  };

  const startEditQuestion = (q) => {
    setEditingQuestion(q.id);
    setEditQForm({
      question_text: q.question_text || '',
      options: (q.options || []).join(', '),
      answers: (q.answers || []).join(', '),
      image_url: q.image_url || ''
    });
  };

  const saveQuestion = async (qId, bankId) => {
    const opts = editQForm.options.split(',').map(s => s.trim()).filter(Boolean);
    const ans = editQForm.answers.split(',').map(s => s.trim()).filter(Boolean);
    
    const { error } = await supabase.from('bank_questions').update({
      question_text: editQForm.question_text,
      options: opts,
      answers: ans,
      image_url: editQForm.image_url
    }).eq('id', qId);
    
    if (error) {
      alert('수정 실패: ' + error.message);
      return;
    }
    
    setBankQuestions(prev => ({
      ...prev,
      [bankId]: prev[bankId].map(q => q.id === qId ? { ...q, question_text: editQForm.question_text, options: opts, answers: ans, image_url: editQForm.image_url } : q)
    }));
    setEditingQuestion(null);
  };

  const deleteQuestion = async (qId, bankId) => {
    if (!window.confirm('이 문제를 삭제하시겠습니까?')) return;
    const { data, error } = await supabase.from('bank_questions').delete().eq('id', qId).select();
    if (error || !data || data.length === 0) {
      alert('문제 삭제 실패: 권한이 없거나 서버 오류입니다.');
      return;
    }
    setBankQuestions(prev => ({
      ...prev,
      [bankId]: prev[bankId].filter(q => q.id !== qId)
    }));
    const bank = banks.find(b => b.id === bankId);
    if (bank) {
      const newCount = Math.max(0, bank.question_count - 1);
      await supabase.from('question_banks').update({ question_count: newCount }).eq('id', bankId);
      setBanks(prev => prev.map(b => b.id === bankId ? { ...b, question_count: newCount } : b));
    }
  };

  const addQuestion = async (bankId) => {
    const newQuestion = {
      bank_id: bankId,
      question_num: '',
      question_text: '새로운 문제',
      options: ['선택지 1', '선택지 2'],
      answers: ['정답'],
      image_url: ''
    };
    const { data, error } = await supabase.from('bank_questions').insert([newQuestion]).select().single();
    if (error) {
      alert('문제 추가 실패: ' + error.message);
      return;
    }
    setBankQuestions(prev => ({
      ...prev,
      [bankId]: [...(prev[bankId] || []), data]
    }));
    const bank = banks.find(b => b.id === bankId);
    if (bank) {
      const newCount = bank.question_count + 1;
      await supabase.from('question_banks').update({ question_count: newCount }).eq('id', bankId);
      setBanks(prev => prev.map(b => b.id === bankId ? { ...b, question_count: newCount } : b));
    }
    setEditingQuestion(data.id);
    setEditQForm({
      question_text: data.question_text,
      options: data.options.join(', '),
      answers: data.answers.join(', '),
      image_url: data.image_url
    });
  };

  // 과거 데이터(uploaded_by가 없는 데이터)는 관리자에게만 보이도록 처리하되, 이메일이 일치하면 보이도록 수정
  const myBanks = banks.filter(b => b.uploaded_by === user.id || String(b.uploader_email).trim().toLowerCase() === String(user?.email).trim().toLowerCase() || (!b.uploaded_by && isAdmin));
  const publicBanks = banks.filter(b => b.is_public === true);

  return (
    <div className="screen" style={{ alignItems: 'flex-start', padding: '20px', overflowY: 'auto' }}>
      <div style={{ width: '800px', maxWidth: '98vw', margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: 'var(--surface-1)', border: 'none', boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px', borderRadius: 'var(--r-lg)', padding: '16px 24px' }}>
          <div>
            <div className="login-title" style={{ fontSize: '20px', textAlign: 'left', margin: 0, display: 'flex', alignItems: 'center' }}>
              <img src={BUB_IMG_SRC} alt="dino" style={{ width: '32px', height: '32px', marginRight: '12px', imageRendering: 'pixelated' }} />
              RETRO GAME QUIZ ADVENTURE
              <img src="/pacman-icon.png" alt="pacman" style={{ width: '28px', height: '28px', marginLeft: '12px', objectFit: 'contain' }} />
            </div>
            <div className="login-sub" style={{ textAlign: 'left', margin: 0, marginTop: '4px' }}>powerd by sota / gogh999@gmail.com</div>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            {user?.email && (
              <span style={{ fontSize: '14px', color: 'var(--ink-muted)', fontWeight: '500' }}>
                {user.email}
              </span>
            )}
            <button
              onClick={handleLogout}
              style={{ padding: '8px 16px', background: 'var(--surface-2)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--ink-muted)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <LogOut size={16} /> 로그아웃
            </button>
          </div>
        </div>

        {/* 탭 메뉴 & 우측 액션 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('rooms')}
              style={{ padding: '8px 16px', background: activeTab === 'rooms' ? 'var(--surface-2)' : 'transparent', border: 'none', borderRadius: 'var(--r-full-pill)', color: activeTab === 'rooms' ? 'var(--ink)' : 'var(--ink-muted)', fontSize: '14px', fontWeight: activeTab === 'rooms' ? '700' : '400', cursor: 'pointer', transition: 'background 0.2s, color 0.2s' }}
            >
              내 게임방
            </button>
            <button
              onClick={() => setActiveTab('banks')}
              style={{ padding: '8px 16px', background: activeTab === 'banks' ? 'var(--surface-2)' : 'transparent', border: 'none', borderRadius: 'var(--r-full-pill)', color: activeTab === 'banks' ? 'var(--ink)' : 'var(--ink-muted)', fontSize: '14px', fontWeight: activeTab === 'banks' ? '700' : '400', cursor: 'pointer', transition: 'background 0.2s, color 0.2s' }}
            >
              내 문제 관리
            </button>
            <button
              onClick={() => setActiveTab('publicBanks')}
              style={{ padding: '8px 16px', background: activeTab === 'publicBanks' ? 'var(--surface-2)' : 'transparent', border: 'none', borderRadius: 'var(--r-full-pill)', color: activeTab === 'publicBanks' ? 'var(--ink)' : 'var(--ink-muted)', fontSize: '14px', fontWeight: activeTab === 'publicBanks' ? '700' : '400', cursor: 'pointer', transition: 'background 0.2s, color 0.2s' }}
            >
              문제 은행
            </button>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
            
            <button
              onClick={() => setShowAIModal(true)}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
                border: 'none',
                borderRadius: 'var(--r-pill)',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 'bold',
                boxShadow: '0 4px 12px rgba(139, 92, 246, 0.35)'
              }}
            >
              <Sparkles size={16} /> AI로 문제 만들기
            </button>

            <button
              onClick={() => !uploading && fileRef.current.click()}
              disabled={uploading}
              style={{ padding: '10px 20px', background: 'var(--surface-2)', border: '1px solid var(--primary)', borderRadius: 'var(--r-pill)', color: 'var(--primary)', cursor: uploading ? 'not-allowed' : 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}
            >
              {uploading ? '⏳ 업로드 중...' : <><Upload size={16} /> 문제 업로드</>}
            </button>

            <button
              onClick={downloadTemplate}
              style={{ padding: '10px 20px', background: 'var(--surface-2)', border: '1px solid var(--ink-muted)', borderRadius: 'var(--r-pill)', color: 'var(--ink)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}
            >
              <Download size={16} /> 템플릿 다운로드
            </button>
          </div>
        </div>

        {/* 탭 내용 */}
        {activeTab === 'rooms' ? (
          loading ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '40px' }}>로딩 중...</div>
          ) : quizSets.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink)', padding: '60px 0', background: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: 'none', boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px' }}>
              <div style={{ marginBottom: '16px' }}>
                <img src={BUB_IMG_SRC} alt="icon" style={{ width: '48px', height: '48px', imageRendering: 'pixelated' }} />
              </div>
              아직 만든 게임방이 없습니다.<br />
              <span style={{ fontSize: '14px', color: 'var(--ink-muted)', marginTop: '8px', display: 'inline-block' }}>문제 은행에서 문제를 선택해 게임방을 만들어 보세요!</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {quizSets.map(quiz => (
                <div key={quiz.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px', background: 'var(--surface-1)', border: 'none', boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px', borderRadius: 'var(--r-md)', gap: '16px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '400', color: 'var(--ink)', fontSize: '20px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {quiz.title}
                      <span style={{ padding: '4px 8px', borderRadius: '4px', background: 'var(--surface-2)', display: 'inline-flex', alignItems: 'center', height: 'fit-content' }}>
                        {quiz.game_type === 'pacman' ? (
                          <img src="/pacman-icon.png" alt="pacman" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                        ) : (
                          <img src={BUB_IMG_SRC} alt="bubble bobble" style={{ width: '24px', height: '24px', objectFit: 'cover', imageRendering: 'pixelated' }} />
                        )}
                      </span>
                    </div>
                    {quiz.question_banks && (
                      <div style={{ fontSize: '14px', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <BookOpen size={16} />
                        {quiz.question_banks.title}
                        {quiz.question_banks.subject && <span style={{ color: 'var(--ink)' }}> · #{quiz.question_banks.subject}</span>}
                      </div>
                    )}
                    <div style={{ fontSize: '14px', color: 'var(--ink-subtle)' }}>방 코드: {quiz.link_code}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button onClick={() => copyLink(quiz.link_code)} title="학생 링크 복사"
                      style={{ padding: '12px 16px', background: 'var(--surface-2)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--ink)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Copy size={16} /> 링크 복사
                    </button>
                    <button onClick={() => window.open(`/game?room=${quiz.link_code}`, '_blank')} title="학생 링크 열기"
                      style={{ padding: '12px 16px', background: 'var(--surface-2)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--ink)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ExternalLink size={16} /> 링크 열기
                    </button>
                    <button onClick={() => navigate(`/dashboard/${quiz.id}/results`)} title="결과 보기"
                      style={{ padding: '12px 16px', background: 'var(--surface-2)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--primary)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <BarChart2 size={16} /> 결과
                    </button>
                    <button onClick={() => deleteQuizSet(quiz.id)} title="삭제"
                      style={{ padding: '12px', background: 'var(--surface-2)', border: 'none', borderRadius: '50%', color: 'var(--semantic-error)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : activeTab === 'banks' ? (
          /* 내 문제 관리 탭 */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {myBanks.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink)', padding: '60px 0', background: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: 'none', boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px' }}>
                아직 업로드한 문제 은행이 없습니다.<br />
                <span style={{ fontSize: '14px', color: 'var(--ink-muted)', marginTop: '8px', display: 'inline-block' }}>엑셀 템플릿을 다운로드하여 내 문제를 올려보세요!</span>
              </div>
            ) : (
              myBanks.map(bank => (
                <div key={bank.id} style={{ background: 'var(--surface-1)', border: 'none', boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px', cursor: 'pointer', flexWrap: 'wrap', gap: '16px' }} onClick={() => toggleExpand(bank.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ color: 'var(--primary)', flexShrink: 0 }}>
                        {expandedBank === bank.id ? <ChevronDown size={24} /> : <ChevronRight size={24} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '400', color: 'var(--ink)', fontSize: '20px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ wordBreak: 'break-word' }}>{bank.title}</span>
                          <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '12px', background: bank.is_public ? 'rgba(0, 255, 127, 0.1)' : 'rgba(255,255,255,0.1)', color: bank.is_public ? 'var(--primary)' : 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {bank.is_public ? <><Globe size={12}/> 공개</> : <><Lock size={12}/> 비공개</>}
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                          <span style={{ whiteSpace: 'nowrap' }}><BookOpen size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />총 {bank.question_count}문항</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedBankId(bank.id); setNewRoomTitle(bank.title); setShowCreateModal(true); }} title="게임방 만들기"
                        style={{ padding: '12px 16px', background: 'var(--primary)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--surface-1)', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        <Plus size={16} /> 방 만들기
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setEditBankData({ id: bank.id, title: bank.title, isPublic: bank.is_public }); setShowEditModal(true); }} title="수정"
                        style={{ padding: '12px 16px', background: 'var(--surface-2)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--ink)', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        <Edit size={16} /> 수정
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteBank(bank.id); }} title="삭제"
                        style={{ padding: '12px', background: 'var(--surface-2)', border: 'none', borderRadius: '50%', color: 'var(--semantic-error)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {expandedBank === bank.id && (
                    <div style={{ padding: '24px', background: 'rgba(0,0,0,0.1)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      {!bankQuestions[bank.id] ? (
                        <div style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '20px' }}>문항을 불러오는 중...</div>
                      ) : bankQuestions[bank.id].length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '20px' }}>등록된 문항이 없습니다.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: '12px' }}>
                          {bankQuestions[bank.id].map((q, i) => (
                            <div key={q.id} style={{ display: 'flex', gap: '16px', padding: '16px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
                              <div style={{ fontWeight: 'bold', color: 'var(--primary)', width: '30px', flexShrink: 0 }}>Q{i+1}</div>
                              {editingQuestion === q.id ? (
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  <input type="text" value={editQForm.question_text} onChange={e => setEditQForm({...editQForm, question_text: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--ink-subtle)', background: 'var(--canvas)', color: 'var(--ink)' }} placeholder="문제 내용" />
                                  <input type="text" value={editQForm.options} onChange={e => setEditQForm({...editQForm, options: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--ink-subtle)', background: 'var(--canvas)', color: 'var(--ink)' }} placeholder="선택지 (쉼표 구분)" />
                                  <input type="text" value={editQForm.answers} onChange={e => setEditQForm({...editQForm, answers: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--ink-subtle)', background: 'var(--canvas)', color: 'var(--ink)' }} placeholder="정답 (쉼표 구분)" />
                                  <input type="text" value={editQForm.image_url} onChange={e => setEditQForm({...editQForm, image_url: e.target.value})} style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--ink-subtle)', background: 'var(--canvas)', color: 'var(--ink)' }} placeholder="이미지 URL (선택사항)" />
                                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                    <button onClick={() => saveQuestion(q.id, bank.id)} className="btn-teal" style={{ padding: '6px 12px', fontSize: '13px', margin: 0, flexShrink: 0, whiteSpace: 'nowrap' }}>저장</button>
                                    <button onClick={() => setEditingQuestion(null)} className="btn-sub" style={{ padding: '6px 12px', fontSize: '13px', margin: 0, flexShrink: 0, whiteSpace: 'nowrap' }}>취소</button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ flex: 1 }}>
                                  <div style={{ color: 'var(--ink)', marginBottom: '8px', lineHeight: '1.4' }}>{q.question_text}</div>
                                  {q.options && q.options.length > 0 && (
                                    <div style={{ color: 'var(--ink-muted)', fontSize: '13px', marginBottom: '8px' }}>
                                      선택지: {q.options.join(', ')}
                                    </div>
                                  )}
                                  <div style={{ color: 'var(--semantic-warning)', fontSize: '13px', fontWeight: 'bold' }}>
                                    정답: {q.answers?.join(', ')}
                                  </div>
                                  {q.image_url && (
                                    <div style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>이미지 URL: {q.image_url}</div>
                                  )}
                                </div>
                              )}
                              {editingQuestion !== q.id && (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button onClick={() => startEditQuestion(q)} style={{ background: 'none', border: 'none', color: 'var(--ink-subtle)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'flex-start' }} title="문제 수정">
                                    <Edit size={16} />
                                  </button>
                                  <button onClick={() => deleteQuestion(q.id, bank.id)} style={{ background: 'none', border: 'none', color: 'var(--semantic-error)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'flex-start' }} title="문제 삭제">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          <button onClick={() => addQuestion(bank.id)} className="btn-sub" style={{ marginTop: '16px', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' }}>
                            <Plus size={16} /> 새로운 문제 추가하기
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : activeTab === 'publicBanks' ? (
          /* 전체 문제 보기 탭 */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {publicBanks.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink)', padding: '60px 0', background: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: 'none', boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px' }}>
                아직 공유된 문제 은행이 없습니다.
              </div>
            ) : (
              publicBanks.map(bank => (
                <div key={bank.id} style={{ background: 'var(--surface-1)', border: 'none', boxShadow: 'rgba(0,0,0,0.3) 0px 8px 8px', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px', cursor: 'pointer', flexWrap: 'wrap', gap: '16px' }} onClick={() => toggleExpand(bank.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ color: 'var(--primary)', flexShrink: 0 }}>
                        {expandedBank === bank.id ? <ChevronDown size={24} /> : <ChevronRight size={24} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '400', color: 'var(--ink)', fontSize: '20px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ wordBreak: 'break-word' }}>{bank.title}</span>
                          <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(30,215,96,0.1)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            <Globe size={12}/> 공유됨
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                          <span style={{ whiteSpace: 'nowrap' }}><BookOpen size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />총 {bank.question_count}문항</span>
                          <span style={{ whiteSpace: 'nowrap' }}>게시자: {bank.uploader_email || '관리자'}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedBankId(bank.id); setNewRoomTitle(bank.title); setShowCreateModal(true); }} title="게임방 만들기"
                        style={{ padding: '12px 16px', background: 'var(--primary)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--surface-1)', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        <Plus size={16} /> 방 만들기
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); copyBank(bank); }} title="내 문제로 가져오기"
                        style={{ padding: '12px 16px', background: 'var(--primary)', border: 'none', borderRadius: 'var(--r-pill)', color: 'var(--surface-1)', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        <Download size={16} /> 가져오기
                      </button>
                    </div>
                  </div>

                  {expandedBank === bank.id && (
                    <div style={{ padding: '24px', background: 'rgba(0,0,0,0.1)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      {!bankQuestions[bank.id] ? (
                        <div style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '20px' }}>문항을 불러오는 중...</div>
                      ) : bankQuestions[bank.id].length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '20px' }}>등록된 문항이 없습니다.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: '12px' }}>
                          {bankQuestions[bank.id].map((q, i) => (
                            <div key={q.id} style={{ display: 'flex', gap: '16px', padding: '16px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
                              <div style={{ fontWeight: 'bold', color: 'var(--primary)', width: '30px', flexShrink: 0 }}>Q{i+1}</div>
                              <div style={{ flex: 1 }}>
                                <div style={{ color: 'var(--ink)', marginBottom: '8px', lineHeight: '1.4' }}>{q.question_text}</div>
                                {q.options && q.options.length > 0 && (
                                  <div style={{ color: 'var(--ink-muted)', fontSize: '13px', marginBottom: '8px' }}>
                                    선택지: {q.options.join(', ')}
                                  </div>
                                )}
                                <div style={{ color: 'var(--semantic-warning)', fontSize: '13px', fontWeight: 'bold' }}>
                                  정답: {q.answers?.join(', ')}
                                </div>
                                {q.image_url && (
                                  <div style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>이미지 URL: {q.image_url}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* 게임방 생성 모달 */}
      {showCreateModal && (
        <div className="c-overlay show" style={{ zIndex: 1000 }} onClick={e => e.target === e.currentTarget && setShowCreateModal(false)}>
          <div className="qz-card qz-body" style={{ width: '480px', transform: 'none' }}>
            <div style={{ fontFamily: 'var(--ft)', fontSize: '24px', color: 'var(--ink)', fontWeight: 'bold', marginBottom: '8px' }}>
              새 게임방 만들기
            </div>
            <div style={{ fontSize: '14px', color: 'var(--ink-muted)', marginBottom: '24px' }}>문제 은행을 선택하고 게임방 이름을 정하세요.</div>

            <label className="f-label">게임방 이름</label>
            <div className="f-wrap" style={{ marginBottom: '24px' }}>
              <input
                type="text"
                placeholder="예: 3반 사회 퀴즈"
                value={newRoomTitle}
                onChange={e => setNewRoomTitle(e.target.value)}
                autoFocus
              />
            </div>

            <label className="f-label">게임 종류</label>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ink)' }}>
                <input
                  type="radio"
                  checked={newRoomGameType === 'bubble'}
                  onChange={() => setNewRoomGameType('bubble')}
                  style={{ accentColor: 'var(--primary)' }}
                />
                버블보블
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ink)' }}>
                <input
                  type="radio"
                  checked={newRoomGameType === 'pacman'}
                  onChange={() => setNewRoomGameType('pacman')}
                  style={{ accentColor: 'var(--primary)' }}
                />
                팩맨
              </label>
            </div>

            <label className="f-label">문제 선택</label>
            {banks.length === 0 ? (
              <div style={{ padding: '16px', background: 'var(--surface-2)', border: 'none', borderRadius: 'var(--r-sm)', color: 'var(--ink-muted)', fontSize: '14px', textAlign: 'center', marginBottom: '32px' }}>
                등록된 문제 은행이 없습니다.<br />
                <span style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: '600', marginTop: '8px', display: 'inline-block' }} onClick={() => { setShowCreateModal(false); !uploading && fileRef.current.click(); }}>
                  직접 업로드하세요 →
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px', maxHeight: '220px', overflowY: 'auto' }}>
                {banks.map(bank => (
                  <div key={bank.id}
                    onClick={() => {
                      setSelectedBankId(bank.id);
                      setNewRoomTitle(bank.title);
                    }}
                    style={{
                      padding: '16px',
                      background: selectedBankId === bank.id ? 'var(--surface-3)' : 'var(--surface-2)',
                      border: 'none',
                      boxShadow: selectedBankId === bank.id ? 'inset 4px 0 0 var(--primary)' : 'none',
                      borderRadius: 'var(--r-sm)',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontWeight: '600', color: 'var(--ink)', fontSize: '16px' }}>{bank.title}</div>
                      {bank.is_public === false ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', background: 'rgba(255,255,255,0.1)', color: 'var(--ink-muted)', padding: '2px 6px', borderRadius: 'var(--r-pill)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          <Lock size={10} /> 비공개
                        </span>
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', background: 'rgba(30,215,96,0.1)', color: 'var(--primary)', padding: '2px 6px', borderRadius: 'var(--r-pill)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          <Globe size={10} /> 공유됨
                        </span>
                      )}

                    </div>
                    <div style={{ fontSize: '14px', color: 'var(--ink-muted)', marginTop: '4px' }}>
                      {bank.subject && <span style={{ color: 'var(--ink)', marginRight: '8px' }}>#{bank.subject}</span>}
                      문제 {bank.question_count}개
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowCreateModal(false)} className="btn-sub" style={{ flex: 1 }}>
                취소
              </button>
              <button onClick={createRoom} disabled={creating || !selectedBankId || !newRoomTitle.trim()} className="btn-teal" style={{ flex: 1, margin: 0 }}>
                {creating ? '생성 중...' : '게임방 만들기'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 업로드 설정 모달 */}
      {showUploadModal && (
        <div className="c-overlay show" style={{ zIndex: 1000 }}>
          <div className="qz-card qz-body" style={{ width: '480px', transform: 'none' }}>
            <div style={{ fontFamily: 'var(--ft)', fontSize: '24px', color: 'var(--ink)', fontWeight: 'bold', marginBottom: '24px' }}>
              문제 등록
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label className="f-label">주제(단원)</label>
              <div className="f-wrap">
                <input
                  type="text"
                  value={uploadData.title}
                  onChange={e => setUploadData({ ...uploadData, title: e.target.value })}
                />
              </div>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <label className="f-label">공유 설정</label>
              <div style={{ display: 'flex', gap: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ink)' }}>
                  <input
                    type="radio"
                    checked={uploadData.isPublic === true}
                    onChange={() => setUploadData({ ...uploadData, isPublic: true })}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <Globe size={16} /> 전체 공개 (공유)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ink)' }}>
                  <input
                    type="radio"
                    checked={uploadData.isPublic === false}
                    onChange={() => setUploadData({ ...uploadData, isPublic: false })}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <Lock size={16} /> 나만 보기 (비공개)
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn-sub"
                onClick={() => setShowUploadModal(false)}
                style={{ flex: 1 }}
              >
                취소
              </button>
              <button
                className="btn-teal"
                onClick={confirmUpload}
                style={{ flex: 1, margin: 0 }}
                disabled={uploading}
              >
                {uploading ? '저장 중...' : '업로드 완료'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 문제 은행 수정 모달 */}
      {showEditModal && (
        <div className="c-overlay show" style={{ zIndex: 1000 }}>
          <div className="qz-card qz-body" style={{ width: '480px', transform: 'none' }}>
            <div style={{ fontFamily: 'var(--ft)', fontSize: '24px', color: 'var(--ink)', fontWeight: 'bold', marginBottom: '24px' }}>
              문제 등록 설정 수정
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label className="f-label">주제(단원)</label>
              <div className="f-wrap">
                <input
                  type="text"
                  value={editBankData.title}
                  onChange={e => setEditBankData({ ...editBankData, title: e.target.value })}
                />
              </div>
            </div>
            <div style={{ marginBottom: '32px' }}>
              <label className="f-label">공유 설정</label>
              <div style={{ display: 'flex', gap: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ink)' }}>
                  <input
                    type="radio"
                    checked={editBankData.isPublic === true}
                    onChange={() => setEditBankData({ ...editBankData, isPublic: true })}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <Globe size={16} /> 전체 공개 (공유)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--ink)' }}>
                  <input
                    type="radio"
                    checked={editBankData.isPublic === false}
                    onChange={() => setEditBankData({ ...editBankData, isPublic: false })}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <Lock size={16} /> 나만 보기 (비공개)
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn-sub"
                onClick={() => setShowEditModal(false)}
                style={{ flex: 1 }}
              >
                취소
              </button>
              <button
                className="btn-teal"
                onClick={updateBank}
                style={{ flex: 1, margin: 0 }}
                disabled={uploading}
              >
                {uploading ? '저장 중...' : '수정 완료'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Quiz Generator Modal */}
      <AIQuizGeneratorModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        onSaveToBank={handleSaveAIGeneratedBank}
        user={user}
        isAdmin={isAdmin}
      />
    </div>
  );
};

export default QuizList;
