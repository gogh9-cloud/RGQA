import { useState, useEffect, useRef } from 'react';
import { 
  X, Sparkles, Upload, FileText, Image as ImageIcon, Key, 
  Check, Trash2, Plus, ArrowLeft, Loader2, Info, Eye, EyeOff, Globe, Lock
} from 'lucide-react';
import { generateQuizWithAI, getOpenAIApiKey, saveOpenAIApiKey } from '../lib/openai';

export default function AIQuizGeneratorModal({ isOpen, onClose, onSaveToBank }) {
  const [step, setStep] = useState(1); // 1: Settings, 2: Loading, 3: Preview/Edit
  const [file, setFile] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [subject, setSubject] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState('초등학교 고학년(5~6학년)');
  const [customPrompt, setCustomPrompt] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [isSavingKey, setIsSavingKey] = useState(true);

  // Preview state
  const [bankTitle, setBankTitle] = useState('');
  const [bankSubject, setBankSubject] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [questions, setQuestions] = useState([]);
  
  // Status & Errors
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getOpenAIApiKey());
      setErrorMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      setErrorMsg('');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setErrorMsg('');
    }
  };

  const handleGenerate = async () => {
    if (!file) {
      setErrorMsg('PDF 또는 이미지 파일을 업로드해 주세요.');
      return;
    }
    if (!apiKey.trim()) {
      setErrorMsg('OpenAI API Key를 입력해 주세요.');
      return;
    }

    if (isSavingKey) {
      saveOpenAIApiKey(apiKey);
    }

    setErrorMsg('');
    setStep(2);

    try {
      const result = await generateQuizWithAI({
        apiKey,
        file,
        subject,
        questionCount,
        difficulty,
        customPrompt,
        model
      });

      setBankTitle(result.title || `${file.name.replace(/\.[^/.]+$/, '')} (AI 생성)`);
      setBankSubject(result.subject || subject || '기타');
      
      const formattedQ = (result.questions || []).map((q, idx) => ({
        id: Date.now() + idx,
        question_num: String(idx + 1),
        question_text: q.question_text || '',
        options: Array.isArray(q.options) && q.options.length >= 4 
          ? q.options.slice(0, 4) 
          : ['보기 1', '보기 2', '보기 3', '보기 4'],
        answers: Array.isArray(q.answers) && q.answers.length > 0 
          ? [String(q.answers[0])] 
          : ['1']
      }));

      setQuestions(formattedQ);
      setStep(3);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || '문제 생성 중 오류가 발생했습니다.');
      setStep(1);
    }
  };

  const handleQuestionChange = (index, field, value) => {
    const updated = [...questions];
    updated[index][field] = value;
    setQuestions(updated);
  };

  const handleOptionChange = (qIndex, oIndex, value) => {
    const updated = [...questions];
    const newOptions = [...updated[qIndex].options];
    newOptions[oIndex] = value;
    updated[qIndex].options = newOptions;
    setQuestions(updated);
  };

  const handleAnswerChange = (qIndex, ansIndexStr) => {
    const updated = [...questions];
    updated[qIndex].answers = [ansIndexStr];
    setQuestions(updated);
  };

  const handleAddQuestion = () => {
    const nextNum = questions.length + 1;
    setQuestions([
      ...questions,
      {
        id: Date.now(),
        question_num: String(nextNum),
        question_text: '',
        options: ['', '', '', ''],
        answers: ['1']
      }
    ]);
  };

  const handleDeleteQuestion = (index) => {
    if (questions.length <= 1) {
      alert('최소 1개 이상의 문제가 필요합니다.');
      return;
    }
    const updated = questions.filter((_, idx) => idx !== index).map((q, idx) => ({
      ...q,
      question_num: String(idx + 1)
    }));
    setQuestions(updated);
  };

  const handleSave = async () => {
    if (!bankTitle.trim()) {
      alert('문제 은행 이름을 입력해 주세요.');
      return;
    }

    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) {
        alert(`${i + 1}번 문제 내용이 비어있습니다.`);
        return;
      }
      if (q.options.some(o => !o.trim())) {
        alert(`${i + 1}번 문제의 모든 보기(1~4번)를 작성해 주세요.`);
        return;
      }
    }

    setSaving(true);
    try {
      await onSaveToBank({
        title: bankTitle,
        subject: bankSubject,
        isPublic,
        questions
      });
      onClose();
    } catch (err) {
      alert('저장 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-2)',
        borderRadius: '16px',
        width: '100%',
        maxWidth: step === 3 ? '850px' : '650px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        color: 'var(--ink)',
        overflow: 'hidden',
        transition: 'all 0.3s ease'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          background: 'var(--surface-2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Sparkles size={20} color="#fff" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>AI로 문제 만들기</h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-muted)' }}>
                {step === 1 && 'PDF 또는 이미지에서 AI가 자동으로 퀴즈를 생성합니다.'}
                {step === 2 && 'AI 분석 진행 중...'}
                {step === 3 && '생성된 문제를 검토하고 문제 은행에 저장하세요.'}
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex', alignItems: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {errorMsg && (
            <div style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '13px',
              marginBottom: '20px'
            }}>
              {errorMsg}
            </div>
          )}

          {/* STEP 1: Settings & File Selection */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* File Upload Area */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
                  📄 문서 또는 이미지 파일 <span style={{ color: 'var(--primary)' }}>*</span>
                </label>
                <div 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current.click()}
                  style={{
                    border: '2px dashed var(--ink-muted)',
                    borderRadius: '12px',
                    padding: '30px 20px',
                    textAlign: 'center',
                    background: file ? 'rgba(34, 197, 94, 0.05)' : 'var(--surface-2)',
                    borderColor: file ? 'var(--primary)' : 'var(--ink-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <input 
                    ref={fileInputRef} 
                    type="file" 
                    accept=".pdf,image/*" 
                    onChange={handleFileChange} 
                    style={{ display: 'none' }} 
                  />

                  {file ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                      {file.type === 'application/pdf' ? <FileText size={32} color="#60A5FA" /> : <ImageIcon size={32} color="#34D399" />}
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '15px', color: 'var(--ink)' }}>{file.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                      </div>
                      <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--primary)', fontWeight: 'bold' }}>변경하기</span>
                    </div>
                  ) : (
                    <div>
                      <Upload size={32} color="var(--ink-muted)" style={{ marginBottom: '8px' }} />
                      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                        클릭하거나 PDF / 이미지 파일을 이곳에 드래그하세요
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                        지원 형식: PDF (.pdf), 이미지 (.png, .jpg, .jpeg, .webp)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Options Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>
                    과목 / 주제 (선택)
                  </label>
                  <input 
                    type="text"
                    placeholder="예: 초등 6학년 과학, 한국사"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--surface-2)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: 'var(--ink)',
                      fontSize: '14px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>
                    난이도 / 대상 학년
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--surface-2)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: 'var(--ink)',
                      fontSize: '14px'
                    }}
                  >
                    <option value="초등학교 저학년(1~3학년)">초등학교 저학년 (1~3학년)</option>
                    <option value="초등학교 고학년(4~6학년)">초등학교 고학년 (4~6학년)</option>
                    <option value="중학교">중학교</option>
                    <option value="고등학교">고등학교</option>
                    <option value="일반/상식">일반 / 상식</option>
                  </select>
                </div>
              </div>

              {/* Question Count */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>
                  생성할 문항 수
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[3, 5, 10, 15].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setQuestionCount(cnt)}
                      style={{
                        flex: 1,
                        padding: '8px 0',
                        borderRadius: '8px',
                        border: questionCount === cnt ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                        background: questionCount === cnt ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-2)',
                        color: questionCount === cnt ? 'var(--primary)' : 'var(--ink)',
                        fontWeight: questionCount === cnt ? 'bold' : 'normal',
                        cursor: 'pointer'
                      }}
                    >
                      {cnt}문항
                    </button>
                  ))}
                </div>
              </div>

              {/* Additional Prompt */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>
                  추가 요청사항 (선택)
                </label>
                <textarea
                  placeholder="예: 핵심 개념 위주로 출제해 줘 / 계산 문제 위주로 만들어 줘"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'var(--surface-2)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    color: 'var(--ink)',
                    fontSize: '13px',
                    resize: 'none'
                  }}
                />
              </div>

              {/* OpenAI API Key Input */}
              <div style={{
                background: 'var(--surface-2)',
                padding: '16px',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.05)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Key size={14} color="#F59E0B" /> OpenAI API Key <span style={{ color: 'var(--primary)' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <select 
                      value={model} 
                      onChange={(e) => setModel(e.target.value)}
                      style={{
                        background: 'var(--surface-1)',
                        color: 'var(--ink)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '11px'
                      }}
                    >
                      <option value="gpt-4o-mini">gpt-4o-mini (권장, 빠름)</option>
                      <option value="gpt-4o">gpt-4o (고성능)</option>
                    </select>
                  </div>
                </div>

                <div style={{ position: 'relative' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 40px 10px 14px',
                      background: 'var(--surface-1)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '6px',
                      color: 'var(--ink)',
                      fontSize: '13px',
                      fontFamily: 'monospace'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--ink-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '11px', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={isSavingKey} 
                      onChange={(e) => setIsSavingKey(e.target.checked)} 
                    />
                    브라우저에 API Key 저장 (다음 접속 시 자동 입력)
                  </label>
                  <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
                    API 키는 서버에 저장되지 않고 내 브라우저에만 유지됩니다.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Loading State */}
          {step === 2 && (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <Loader2 size={48} className="animate-spin" color="#8B5CF6" style={{ margin: '0 auto 20px', animation: 'spin 1.5s linear infinite' }} />
              <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
                AI가 문서를 분석하고 문제를 생성하고 있습니다...
              </h4>
              <p style={{ color: 'var(--ink-muted)', fontSize: '14px' }}>
                문서 크기와 요청 문항 수에 따라 약 10~30초 정도 소요될 수 있습니다.
              </p>
            </div>
          )}

          {/* STEP 3: Preview & Edit */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Question Bank Info */}
              <div style={{
                background: 'var(--surface-2)',
                padding: '16px',
                borderRadius: '12px',
                display: 'grid',
                gridTemplateColumns: '2fr 1fr auto',
                gap: '12px',
                alignItems: 'center'
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '4px' }}>
                    문제 은행 제목
                  </label>
                  <input
                    type="text"
                    value={bankTitle}
                    onChange={(e) => setBankTitle(e.target.value)}
                    placeholder="제목 입력"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'var(--surface-1)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      color: 'var(--ink)',
                      fontWeight: 'bold',
                      fontSize: '14px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '4px' }}>
                    과목
                  </label>
                  <input
                    type="text"
                    value={bankSubject}
                    onChange={(e) => setBankSubject(e.target.value)}
                    placeholder="과목명"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'var(--surface-1)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      color: 'var(--ink)',
                      fontSize: '14px'
                    }}
                  />
                </div>

                <div style={{ alignSelf: 'end' }}>
                  <button
                    type="button"
                    onClick={() => setIsPublic(!isPublic)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: isPublic ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-1)',
                      color: isPublic ? 'var(--primary)' : 'var(--ink-muted)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 'bold'
                    }}
                  >
                    {isPublic ? <Globe size={14} /> : <Lock size={14} />}
                    {isPublic ? '공유됨' : '비공개'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold' }}>
                  생성된 문제 검토 ({questions.length}문항)
                </h4>
                <button
                  onClick={handleAddQuestion}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--primary)',
                    borderRadius: '6px',
                    color: 'var(--primary)',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={14} /> 문제 직접 추가
                </button>
              </div>

              {/* Questions List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {questions.map((q, qIdx) => (
                  <div key={q.id || qIdx} style={{
                    background: 'var(--surface-2)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <span style={{
                        padding: '2px 8px',
                        background: 'var(--primary)',
                        color: '#000',
                        fontWeight: 'bold',
                        fontSize: '12px',
                        borderRadius: '4px'
                      }}>
                        Q{q.question_num || qIdx + 1}
                      </span>

                      <button
                        onClick={() => handleDeleteQuestion(qIdx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: '4px'
                        }}
                        title="문제 삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Question Text */}
                    <textarea
                      value={q.question_text}
                      onChange={(e) => handleQuestionChange(qIdx, 'question_text', e.target.value)}
                      placeholder="문제 지문을 입력하세요"
                      rows={2}
                      style={{
                        width: '100%',
                        padding: '10px',
                        background: 'var(--surface-1)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        color: 'var(--ink)',
                        fontSize: '14px',
                        marginBottom: '12px',
                        resize: 'vertical'
                      }}
                    />

                    {/* Options (1 ~ 4) */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {q.options.map((opt, oIdx) => {
                        const isAnswer = q.answers[0] === String(oIdx + 1);
                        return (
                          <div key={oIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => handleAnswerChange(qIdx, String(oIdx + 1))}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                border: isAnswer ? 'none' : '1px solid var(--ink-muted)',
                                background: isAnswer ? 'var(--primary)' : 'transparent',
                                color: isAnswer ? '#000' : 'var(--ink)',
                                fontWeight: 'bold',
                                fontSize: '12px',
                                flexShrink: 0,
                                cursor: 'pointer'
                              }}
                              title="정답으로 선택"
                            >
                              {oIdx + 1}
                            </button>
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => handleOptionChange(qIdx, oIdx, e.target.value)}
                              placeholder={`보기 ${oIdx + 1}`}
                              style={{
                                flex: 1,
                                padding: '6px 10px',
                                background: 'var(--surface-1)',
                                border: isAnswer ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                color: 'var(--ink)',
                                fontSize: '13px'
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          background: 'var(--surface-2)'
        }}>
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 18px',
                  background: 'transparent',
                  border: '1px solid var(--ink-muted)',
                  borderRadius: '8px',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                style={{
                  padding: '10px 24px',
                  background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)'
                }}
              >
                <Sparkles size={16} /> AI 문제 생성하기
              </button>
            </>
          )}

          {step === 2 && (
            <div style={{ width: '100%', textAlign: 'center', fontSize: '12px', color: 'var(--ink-muted)' }}>
              생성이 완료될 때까지 창을 닫지 마세요.
            </div>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  padding: '10px 18px',
                  background: 'transparent',
                  border: '1px solid var(--ink-muted)',
                  borderRadius: '8px',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <ArrowLeft size={16} /> 다시 설정
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '10px 24px',
                  background: 'var(--primary)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#000',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)'
                }}
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> 저장 중...
                  </>
                ) : (
                  <>
                    <Check size={16} /> 문제 은행에 저장하기
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
