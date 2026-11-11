/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';

const QuizEditor = () => {
  const { quizSetId } = useParams();
  const navigate = useNavigate();
  const [quizSet, setQuizSet] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchQuizData = useCallback(async () => {
    const [setRes, qRes] = await Promise.all([
      db.from('quiz_sets').select('*').eq('id', quizSetId).single(),
      db.from('questions').select('*').eq('quiz_set_id', quizSetId).order('created_at', { ascending: true })
    ]);

    if (setRes.data) setQuizSet(setRes.data);
    if (qRes.data) setQuestions(qRes.data);
    setLoading(false);
  }, [quizSetId]);

  useEffect(() => {
    fetchQuizData();
  }, [quizSetId, fetchQuizData]);

  const addQuestion = () => {
    setQuestions([
      ...questions,
      { id: `temp_${Date.now()}`, isNew: true, question_num: String(questions.length + 1), question_text: '', options: ['', '', '', ''], answers: [''] }
    ]);
  };

  const updateQuestion = (id, field, value) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const updateOption = (qId, optIndex, value) => {
    setQuestions(questions.map(q => {
      if (q.id === qId) {
        const newOpts = [...q.options];
        newOpts[optIndex] = value;
        return { ...q, options: newOpts };
      }
      return q;
    }));
  };

  const removeQuestion = async (id) => {
    if (!String(id).startsWith('temp_')) {
      const { data, error } = await db.from('questions').delete().eq('id', id).select();
      if (error || !data || data.length === 0) {
        alert('삭제 실패: 권한이 없거나 서버 오류입니다.');
        return;
      }
    }
    setQuestions(questions.filter(q => q.id !== id));
  };

  const saveAll = async () => {
    const toInsert = questions.filter(q => q.isNew).map(q => ({
      quiz_set_id: quizSetId,
      question_num: q.question_num,
      question_text: q.question_text,
      options: q.options,
      answers: q.answers,
    }));
    
    const toUpdate = questions.filter(q => !q.isNew).map(q => ({
      id: q.id,
      quiz_set_id: quizSetId,
      question_num: q.question_num,
      question_text: q.question_text,
      options: q.options,
      answers: q.answers,
    }));

    try {
      if (toInsert.length > 0) await db.from('questions').insert(toInsert);
      if (toUpdate.length > 0) await db.from('questions').upsert(toUpdate);
      alert('저장되었습니다.');
      fetchQuizData();
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    }
  };

  if (loading) return <div className="screen"><div style={{color:'white'}}>Loading...</div></div>;

  return (
    <div className="screen dashboard-screen">
      <div className="login-card" style={{ width: '900px', maxWidth: '95vw', height: '90vh', display: 'flex', flexDirection: 'column', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <button onClick={() => navigate('/dashboard')} style={{ background: 'transparent', border: 'none', color: 'var(--subdued)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ArrowLeft size={20} /> 뒤로가기
          </button>
          <h2 className="login-title" style={{ fontSize: '18px', margin: 0 }}>{quizSet?.title} - 문제 편집</h2>
          <button className="btn-teal" onClick={saveAll} style={{ width: 'auto', padding: '8px 16px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Save size={16} /> 저장
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '10px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {questions.map((q, idx) => (
            <div key={q.id} style={{ background: 'var(--surface)', padding: '16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--teal)' }}>문제 {idx + 1}</span>
                <button onClick={() => removeQuestion(q.id)} style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer' }}><Trash2 size={16}/></button>
              </div>
              <div className="f-wrap">
                <input 
                  type="text" 
                  placeholder="문제 내용을 입력하세요" 
                  value={q.question_text || ''} 
                  onChange={e => updateQuestion(q.id, 'question_text', e.target.value)} 
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                {q.options.map((opt, oIdx) => (
                  <div key={oIdx} className="f-wrap" style={{ marginBottom: 0 }}>
                    <input 
                      type="text" 
                      placeholder={`${oIdx + 1}번 선택지`} 
                      value={opt || ''} 
                      onChange={e => updateOption(q.id, oIdx, e.target.value)} 
                    />
                  </div>
                ))}
              </div>
              
              <div className="f-wrap" style={{ marginBottom: 0 }}>
                <input 
                  type="text" 
                  placeholder="정답 (선택지 내용과 정확히 일치하게 입력)" 
                  value={q.answers[0] || ''} 
                  onChange={e => updateQuestion(q.id, 'answers', [e.target.value])} 
                />
              </div>
            </div>
          ))}

          <button onClick={addQuestion} style={{ padding: '16px', background: 'var(--raised)', border: '1px dashed var(--subdued)', borderRadius: 'var(--r-md)', color: 'var(--subdued)', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
            <Plus size={20} /> 문제 추가하기
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuizEditor;
