import { useState, useEffect, useRef } from 'react';
import { 
  X, Sparkles, Upload, FileText, Image as ImageIcon, Key, 
  Check, Trash2, Plus, ArrowLeft, Loader2, Eye, EyeOff, Globe, Lock, AlertCircle
} from 'lucide-react';
import { generateQuizWithAI, getOpenAIApiKey, saveOpenAIApiKey, getPDFPageCount } from '../lib/openai';

const MAX_DAILY_AI_USAGE = 3;

const getTodayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const getDailyAIUsage = (userId) => {
  const uid = userId || 'guest';
  const key = `rgqa_ai_usage_${uid}_${getTodayStr()}`;
  const val = localStorage.getItem(key);
  return val ? parseInt(val, 10) : 0;
};

const incrementDailyAIUsage = (userId) => {
  const uid = userId || 'guest';
  const key = `rgqa_ai_usage_${uid}_${getTodayStr()}`;
  const current = getDailyAIUsage(userId);
  localStorage.setItem(key, String(current + 1));
  return current + 1;
};

export default function AIQuizGeneratorModal({ isOpen, onClose, onSaveToBank, user, isAdmin = false }) {
  const userId = user?.id || user?.email || 'guest';
  
  const [step, setStep] = useState(1); // 1: Settings, 2: Loading, 3: Preview/Edit
  
  // File state
  const [files, setFiles] = useState([]); // Array of File objects
  const [fileType, setFileType] = useState(null); // 'pdf' | 'image' | null
  const [imagePreviews, setImagePreviews] = useState([]); // Array of Data URLs for image thumbnails
  
  // PDF Page Selection State
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfStartPage, setPdfStartPage] = useState(1);
  const [pdfEndPage, setPdfEndPage] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(false);

  // Daily Usage State
  const [dailyUsed, setDailyUsed] = useState(0);

  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [subject, setSubject] = useState('');
  const [questionCount, setQuestionCount] = useState(15);
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
  const appendFileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getOpenAIApiKey());
      setErrorMsg('');
      const used = getDailyAIUsage(userId);
      setDailyUsed(used);
    }
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const handleFilesAdded = async (newFileList) => {
    if (!newFileList || newFileList.length === 0) return;
    setErrorMsg('');

    const newFilesArray = Array.from(newFileList);
    const firstNewFile = newFilesArray[0];
    const isPDF = firstNewFile.type === 'application/pdf' || firstNewFile.name.toLowerCase().endsWith('.pdf');

    if (isPDF) {
      // PDF File Upload Logic
      const pdfFile = firstNewFile;
      setFileType('pdf');
      setFiles([pdfFile]);
      setImagePreviews([]);
      setLoadingPdf(true);
      try {
        const totalPages = await getPDFPageCount(pdfFile);
        setPdfTotalPages(totalPages);
        setPdfStartPage(1);
        setPdfEndPage(Math.min(totalPages, 10));
      } catch (err) {
        console.error('PDF Page count failed:', err);
        setErrorMsg('PDF 파일 정보를 읽어오는데 실패했습니다.');
      } finally {
        setLoadingPdf(false);
      }
    } else {
      // Image Files Upload Logic
      const imageFiles = newFilesArray.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
      if (imageFiles.length === 0) {
        setErrorMsg('지원되는 PDF 또는 이미지 파일(.png, .jpg, .webp 등)을 선택해 주세요.');
        return;
      }

      let combined = fileType === 'image' ? [...files, ...imageFiles] : imageFiles;
      if (combined.length > 10) {
        setErrorMsg('그림 파일은 최대 10장까지만 올릴 수 있습니다. (상위 10개 이미지 선택됨)');
        combined = combined.slice(0, 10);
      }
      setFileType('image');
      setFiles(combined);

      // Generate preview data URLs
      const previews = await Promise.all(combined.map(f => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(f);
        });
      }));
      setImagePreviews(previews);
    }
  };

  const handleRemoveImage = (index) => {
    const updatedFiles = files.filter((_, idx) => idx !== index);
    const updatedPreviews = imagePreviews.filter((_, idx) => idx !== index);
    setFiles(updatedFiles);
    setImagePreviews(updatedPreviews);
    if (updatedFiles.length === 0) {
      setFileType(null);
    }
  };

  const handleClearFiles = () => {
    setFiles([]);
    setFileType(null);
    setImagePreviews([]);
    setPdfTotalPages(0);
    setPdfStartPage(1);
    setPdfEndPage(1);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleGenerate = async () => {
    // 1. Check daily AI usage limit
    const currentUsage = getDailyAIUsage(userId);
    if (currentUsage >= MAX_DAILY_AI_USAGE) {
      setErrorMsg(`오늘 AI 사용 횟수(${MAX_DAILY_AI_USAGE}회)를 모두 소진하셨습니다. 내일 다시 시도해 주세요.`);
      return;
    }

    // 2. Check file upload presence
    if (!files || files.length === 0) {
      setErrorMsg('PDF 또는 이미지 파일을 업로드해 주세요.');
      return;
    }

    const keyToUse = apiKey.trim() || getOpenAIApiKey();
    if (isAdmin && !keyToUse) {
      setErrorMsg('OpenAI API Key를 입력해 주세요.');
      return;
    }

    // 3. Check PDF page range selection (max 10 pages)
    let selectedPagesArray = null;
    if (fileType === 'pdf') {
      if (pdfStartPage < 1 || pdfEndPage < pdfStartPage || pdfStartPage > pdfTotalPages || pdfEndPage > pdfTotalPages) {
        setErrorMsg('올바른 PDF 페이지 범위를 입력해 주세요.');
        return;
      }
      const pageCount = pdfEndPage - pdfStartPage + 1;
      if (pageCount > 10) {
        setErrorMsg('PDF 파일은 한번에 최대 10페이지까지만 선택할 수 있습니다.');
        return;
      }
      selectedPagesArray = [];
      for (let i = pdfStartPage; i <= pdfEndPage; i++) {
        selectedPagesArray.push(i);
      }
    }

    if (fileType === 'image' && files.length > 10) {
      setErrorMsg('그림 파일은 최대 10장까지만 올릴 수 있습니다.');
      return;
    }

    if (isAdmin && isSavingKey && apiKey.trim()) {
      saveOpenAIApiKey(apiKey);
    }

    setErrorMsg('');
    setStep(2);

    try {
      const result = await generateQuizWithAI({
        apiKey: keyToUse,
        file: files[0],
        files,
        selectedPages: selectedPagesArray,
        subject,
        questionCount,
        difficulty: '초등학교 3~6학년 (자료 내용 기반 자동 설정)',
        customPrompt,
        model
      });

      // Increment usage count upon successful generation
      const newUsed = incrementDailyAIUsage(userId);
      setDailyUsed(newUsed);

      const mainFileName = files[0].name.replace(/\.[^/.]+$/, '');
      setBankTitle(result.title || `${mainFileName} (AI 생성)`);
      setBankSubject(result.subject || subject || '기타');
      
      const formattedQ = (result.questions || []).map((q, idx) => {
        let opts = Array.isArray(q.options) ? q.options.slice(0, 5) : [];
        while (opts.length < 5) {
          opts.push(`보기 ${opts.length + 1}`);
        }
        return {
          id: Date.now() + idx,
          question_num: String(idx + 1),
          question_text: q.question_text || '',
          options: opts,
          answers: Array.isArray(q.answers) && q.answers.length > 0 
            ? [String(q.answers[0])] 
            : ['1']
        };
      });

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
        options: ['보기 1', '보기 2', '보기 3', '보기 4', '보기 5'],
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
        alert(`${i + 1}번 문제의 모든 보기(1~5번)를 작성해 주세요.`);
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

  const remainingUsage = Math.max(0, MAX_DAILY_AI_USAGE - dailyUsed);
  const isLimitReached = dailyUsed >= MAX_DAILY_AI_USAGE;

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
        maxWidth: step === 3 ? '880px' : '650px',
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
          justifyContent: 'space-between',
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
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>AI로 문제 만들기 (5지선다)</h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-muted)' }}>
                {step === 1 && 'PDF 또는 이미지에서 초등 3~6학년 수준의 5지선다 퀴즈를 생성합니다.'}
                {step === 2 && 'AI 분석 진행 중...'}
                {step === 3 && '생성된 5지선다 문제를 검토하고 문제 은행에 저장하세요.'}
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
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* STEP 1: Settings & File Selection */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Daily Limit Banner */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: isLimitReached ? 'rgba(239, 68, 68, 0.12)' : 'rgba(139, 92, 246, 0.12)',
                border: isLimitReached ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(139, 92, 246, 0.3)',
                padding: '10px 16px',
                borderRadius: '10px',
                fontSize: '13px'
              }}>
                <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink)' }}>
                  ⚡ 일일 AI 문제 생성 한도 (계정당 하루 3회)
                </span>
                <span style={{ fontWeight: 'bold' }}>
                  {!isLimitReached ? (
                    <span style={{ color: 'var(--primary)' }}>오늘 남은 횟수: {remainingUsage} / {MAX_DAILY_AI_USAGE}회</span>
                  ) : (
                    <span style={{ color: '#f87171' }}>오늘 사용 횟수 소진 ({dailyUsed}/{MAX_DAILY_AI_USAGE}회)</span>
                  )}
                </span>
              </div>

              {/* File Upload Area */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    📄 문서 또는 이미지 파일 <span style={{ color: 'var(--primary)' }}>*</span>
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                    그림 파일 최대 10장 / PDF 선택 시 최대 10페이지 지원
                  </span>
                </div>

                {/* Drop Zone when no files uploaded */}
                {files.length === 0 ? (
                  <div 
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current.click()}
                    style={{
                      border: '2px dashed var(--ink-muted)',
                      borderRadius: '12px',
                      padding: '30px 20px',
                      textAlign: 'center',
                      background: 'var(--surface-2)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <input 
                      ref={fileInputRef} 
                      type="file" 
                      accept=".pdf,image/*" 
                      multiple
                      onChange={(e) => handleFilesAdded(e.target.files)} 
                      style={{ display: 'none' }} 
                    />
                    <Upload size={32} color="var(--ink-muted)" style={{ marginBottom: '8px' }} />
                    <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                      클릭하거나 PDF / 이미지 파일들을 이곳에 드래그하세요
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                      - 그림 파일: 최대 10장까지 동시 선택 및 업로드 가능<br />
                      - PDF 파일: 10페이지 이상 시 원하는 10페이지 선택 기능 제공
                    </div>
                  </div>
                ) : (
                  /* Display File Control UI based on fileType */
                  <div style={{
                    background: 'var(--surface-2)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px'
                  }}>
                    {/* Hidden input for adding more image files */}
                    <input 
                      ref={appendFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleFilesAdded(e.target.files)}
                      style={{ display: 'none' }}
                    />

                    {/* PDF UI */}
                    {fileType === 'pdf' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <FileText size={32} color="#60A5FA" />
                            <div>
                              <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--ink)' }}>{files[0].name}</div>
                              <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                                {(files[0].size / 1024 / 1024).toFixed(2)} MB {loadingPdf ? '(페이지 수 확인 중...)' : `(총 ${pdfTotalPages}페이지)`}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleClearFiles}
                            style={{
                              background: 'transparent',
                              border: '1px solid rgba(255,255,255,0.2)',
                              color: 'var(--ink-muted)',
                              borderRadius: '6px',
                              padding: '4px 10px',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            다른 파일 선택
                          </button>
                        </div>

                        {/* PDF Page Selection Section */}
                        {pdfTotalPages > 0 && (
                          <div style={{
                            background: 'var(--surface-1)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            padding: '12px 14px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                📖 PDF 추출 페이지 선택 <span style={{ color: 'var(--primary)', fontSize: '11px' }}>(최대 10페이지까지 가능)</span>
                              </label>
                              <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 'bold' }}>
                                선택됨: {pdfEndPage - pdfStartPage + 1}페이지 (Pages {pdfStartPage} ~ {pdfEndPage})
                              </span>
                            </div>

                            {pdfTotalPages > 10 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>시작:</span>
                                  <input 
                                    type="number" 
                                    min={1} 
                                    max={pdfTotalPages}
                                    value={pdfStartPage}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || 1;
                                      setPdfStartPage(val);
                                      if (pdfEndPage < val) setPdfEndPage(val);
                                    }}
                                    style={{
                                      width: '70px',
                                      padding: '6px 8px',
                                      background: 'var(--surface-2)',
                                      border: '1px solid rgba(255,255,255,0.15)',
                                      borderRadius: '6px',
                                      color: 'var(--ink)',
                                      fontSize: '13px',
                                      textAlign: 'center'
                                    }}
                                  />
                                  <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>~ 끝:</span>
                                  <input 
                                    type="number" 
                                    min={pdfStartPage} 
                                    max={pdfTotalPages}
                                    value={pdfEndPage}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || pdfStartPage;
                                      setPdfEndPage(val);
                                    }}
                                    style={{
                                      width: '70px',
                                      padding: '6px 8px',
                                      background: 'var(--surface-2)',
                                      border: '1px solid rgba(255,255,255,0.15)',
                                      borderRadius: '6px',
                                      color: 'var(--ink)',
                                      fontSize: '13px',
                                      textAlign: 'center'
                                    }}
                                  />
                                  <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>/ 총 {pdfTotalPages}p</span>
                                </div>

                                {/* Range presets if document is large */}
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                  {[
                                    { label: '1~10p', start: 1, end: Math.min(10, pdfTotalPages) },
                                    pdfTotalPages >= 20 && { label: '11~20p', start: 11, end: Math.min(20, pdfTotalPages) },
                                    pdfTotalPages >= 30 && { label: '21~30p', start: 21, end: Math.min(30, pdfTotalPages) },
                                    pdfTotalPages > 10 && { label: `마지막 10p (${Math.max(1, pdfTotalPages - 9)}~${pdfTotalPages}p)`, start: Math.max(1, pdfTotalPages - 9), end: pdfTotalPages }
                                  ].filter(Boolean).map((preset, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => {
                                        setPdfStartPage(preset.start);
                                        setPdfEndPage(preset.end);
                                      }}
                                      style={{
                                        padding: '4px 8px',
                                        fontSize: '11px',
                                        borderRadius: '4px',
                                        background: 'var(--surface-2)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: 'var(--ink-muted)',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      {preset.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                                PDF의 전체 {pdfTotalPages}페이지가 모두 생성에 포함됩니다.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* IMAGES UI */}
                    {fileType === 'image' && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <ImageIcon size={18} color="#34D399" /> 
                            업로드된 이미지 목록 <span style={{ color: 'var(--primary)' }}>({files.length} / 10장)</span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {files.length < 10 && (
                              <button
                                type="button"
                                onClick={() => appendFileInputRef.current.click()}
                                style={{
                                  padding: '5px 10px',
                                  background: 'rgba(34, 197, 94, 0.15)',
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
                                <Plus size={14} /> 이미지 추가 ({files.length}/10)
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={handleClearFiles}
                              style={{
                                background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.2)',
                                color: 'var(--ink-muted)',
                                borderRadius: '6px',
                                padding: '5px 10px',
                                fontSize: '12px',
                                cursor: 'pointer'
                              }}
                            >
                              전체 삭제
                            </button>
                          </div>
                        </div>

                        {/* Image Thumbnails Grid */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                          gap: '10px',
                          maxHeight: '200px',
                          overflowY: 'auto'
                        }}>
                          {files.map((fileObj, idx) => (
                            <div key={idx} style={{
                              position: 'relative',
                              background: 'var(--surface-1)',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              border: '1px solid rgba(255,255,255,0.1)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center'
                            }}>
                              {imagePreviews[idx] ? (
                                <img 
                                  src={imagePreviews[idx]} 
                                  alt={`preview-${idx}`} 
                                  style={{ width: '100%', height: '70px', objectFit: 'cover' }} 
                                />
                              ) : (
                                <div style={{ width: '100%', height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#333' }}>
                                  <ImageIcon size={24} color="#888" />
                                </div>
                              )}
                              <div style={{
                                width: '100%',
                                padding: '4px 6px',
                                fontSize: '10px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                textAlign: 'center',
                                color: 'var(--ink-muted)'
                              }}>
                                {idx + 1}. {fileObj.name}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveImage(idx)}
                                style={{
                                  position: 'absolute',
                                  top: '4px',
                                  right: '4px',
                                  background: 'rgba(0,0,0,0.7)',
                                  border: 'none',
                                  borderRadius: '50%',
                                  color: '#ef4444',
                                  width: '20px',
                                  height: '20px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer'
                                }}
                                title="이미지 삭제"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Subject & Question Count Row */}
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
                    생성할 문항 수 (직접 입력 가능)
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input 
                      type="number"
                      min={1}
                      max={30}
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      style={{
                        width: '80px',
                        padding: '8px 10px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--primary)',
                        borderRadius: '8px',
                        color: 'var(--ink)',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        textAlign: 'center'
                      }}
                    />
                    <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                      {[5, 10, 15, 20].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setQuestionCount(cnt)}
                          style={{
                            flex: 1,
                            padding: '8px 0',
                            borderRadius: '6px',
                            border: questionCount === cnt ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                            background: questionCount === cnt ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-2)',
                            color: questionCount === cnt ? 'var(--primary)' : 'var(--ink)',
                            fontWeight: questionCount === cnt ? 'bold' : 'normal',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          {cnt}문항{cnt === 15 ? '(기본)' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
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

              {/* OpenAI API Key Input (Admin only) */}
              {isAdmin && (
                <div style={{
                  background: 'var(--surface-2)',
                  padding: '16px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Key size={14} color="#F59E0B" /> OpenAI API Key <span style={{ color: 'var(--primary)' }}>* (관리자 전용)</span>
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
                      API 키는 관리자 화면에서만 수정 가능합니다.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Loading State */}
          {step === 2 && (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <Loader2 size={48} className="animate-spin" color="#8B5CF6" style={{ margin: '0 auto 20px', animation: 'spin 1.5s linear infinite' }} />
              <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
                AI가 문서를 분석하고 초등 3~6학년 5지선다 문제를 생성하고 있습니다...
              </h4>
              <p style={{ color: 'var(--ink-muted)', fontSize: '14px' }}>
                선택하신 문서/이미지 크기와 요청 문항 수({questionCount}문항)에 따라 약 10~30초 정도 소요될 수 있습니다.
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
                  생성된 5지선다 문제 검토 ({questions.length}문항)
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

                    {/* Options (1 ~ 5 choices) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                disabled={isLimitReached}
                style={{
                  padding: '10px 24px',
                  background: isLimitReached ? '#4b5563' : 'linear-gradient(135deg, #8B5CF6, #EC4899)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  cursor: isLimitReached ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: isLimitReached ? 'none' : '0 4px 12px rgba(139, 92, 246, 0.4)'
                }}
              >
                <Sparkles size={16} /> {isLimitReached ? '오늘 사용 횟수 초과' : 'AI 문제 생성하기'}
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
