/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { ArrowLeft, Download, Edit2, Trash2, Check, X } from 'lucide-react';

const Results = () => {
  const { quizSetId } = useParams();
  const navigate = useNavigate();
  const [quizSet, setQuizSet] = useState(null);
  const [students, setStudents] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editForm, setEditForm] = useState({ ban: '', num: '', name: '', total_score: 0 });

  const fetchResults = useCallback(async () => {
    const [setRes, stuRes] = await Promise.all([
      db.from('quiz_sets').select('*').eq('id', quizSetId).single(),
      db.from('students').select('*, student_logs(*)').eq('quiz_set_id', quizSetId).order('ban', { ascending: true }).order('num', { ascending: true })
    ]);
    if (setRes.data) {
      setQuizSet(setRes.data);
      if (setRes.data.bank_id) {
        const { data: qData } = await db.from('bank_questions').select('*').eq('bank_id', setRes.data.bank_id);
        setQuestions(qData || []);
      } else {
        const { data: qData } = await db.from('questions').select('*').eq('quiz_set_id', setRes.data.id);
        setQuestions(qData || []);
      }
    }
    if (stuRes.data) setStudents(stuRes.data);
    setLoading(false);
  }, [quizSetId]);

  useEffect(() => {
    fetchResults();
  }, [quizSetId, fetchResults]);

  const downloadCSV = () => {
    const header = '반,번호,이름,총점,틀린 문제,최종접속';
    const rows = students.map(s => {
      const wrongLogs = s.student_logs?.filter(log => !log.is_correct) || [];
      const wrongQuestions = wrongLogs.map(log => {
        const q = questions.find(q => q.id === log.question_id);
        return q ? (q.question_num ? `${q.question_num}번` : q.question_text) : '알 수 없음';
      }).join(', ');
      
      return `${s.ban},${s.num},"${s.name}",${s.total_score},"${wrongQuestions}","${new Date(s.last_accessed).toLocaleString('ko-KR')}"`
    });
    const csv = '\uFEFF' + [header, ...rows].join('\n'); // BOM for Korean Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${quizSet?.title || 'results'}_결과.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id, name) => {
    if (window.confirm(`${name} 학생의 기록을 정말 삭제하시겠습니까?`)) {
      const { error } = await db.from('students').delete().eq('id', id);
      if (!error) {
        setStudents(prev => prev.filter(s => s.id !== id));
      } else {
        alert('삭제 중 오류가 발생했습니다.');
      }
    }
  };

  const handleEditClick = (student) => {
    setEditingStudentId(student.id);
    setEditForm({ ban: student.ban, num: student.num, name: student.name, total_score: student.total_score });
  };

  const handleCancelEdit = () => {
    setEditingStudentId(null);
  };

  const handleSaveEdit = async (id) => {
    const { error } = await db.from('students').update({
      ban: parseInt(editForm.ban) || 0,
      num: parseInt(editForm.num) || 0,
      name: editForm.name,
      total_score: parseInt(editForm.total_score) || 0
    }).eq('id', id);

    if (!error) {
      setStudents(prev => prev.map(s => s.id === id ? { 
        ...s, 
        ban: parseInt(editForm.ban) || 0, 
        num: parseInt(editForm.num) || 0, 
        name: editForm.name, 
        total_score: parseInt(editForm.total_score) || 0 
      } : s));
      setEditingStudentId(null);
    } else {
      alert('수정 중 오류가 발생했습니다.');
    }
  };

  if (loading) return <div className="screen"><div style={{color:'white'}}>Loading...</div></div>;

  return (
    <div className="screen dashboard-screen" style={{ overflowY: 'auto', alignItems: 'flex-start', paddingTop: '24px', background: 'var(--canvas)' }}>
      <div className="login-card" style={{ width: '900px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-1)', border: 'none', borderRadius: 'var(--r-lg)', boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <button onClick={() => navigate('/dashboard')} style={{ background: 'transparent', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ArrowLeft size={20} /> 대시보드
          </button>
          <h2 className="login-title" style={{ fontSize: '24px', margin: 0, fontWeight: '400' }}>{quizSet?.title} - 결과</h2>
          <button className="btn-teal" onClick={downloadCSV} style={{ width: 'auto', padding: '8px 16px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={16} /> CSV 다운로드
          </button>
        </div>

        {students.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '64px 0', background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>아직 참여한 학생이 없습니다.</div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', borderRadius: 'var(--r-md)', background: 'var(--surface-1)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <th style={thStyle}>반</th>
                  <th style={thStyle}>번호</th>
                  <th style={thStyle}>이름</th>
                  <th style={thStyle}>총점</th>
                  <th style={thStyle}>틀린 문제</th>
                  <th style={thStyle}>최종 접속</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, idx) => {
                  const wrongLogs = s.student_logs?.filter(log => !log.is_correct) || [];
                  const wrongQuestions = wrongLogs.map(log => {
                    const q = questions.find(q => q.id === log.question_id);
                    return q ? (q.question_num ? `${q.question_num}번` : q.question_text.substring(0, 10) + '...') : '알 수 없음';
                  }).join(', ');

                  const isEditing = editingStudentId === s.id;

                  return (
                    <tr key={s.id} style={{ background: idx % 2 === 0 ? 'var(--surface-2)' : 'var(--surface-1)', borderBottom: 'none' }}>
                      {isEditing ? (
                        <>
                          <td style={tdStyle}><input type="number" value={editForm.ban} onChange={e => setEditForm({...editForm, ban: e.target.value})} style={inputStyle} /></td>
                          <td style={tdStyle}><input type="number" value={editForm.num} onChange={e => setEditForm({...editForm, num: e.target.value})} style={inputStyle} /></td>
                          <td style={tdStyle}><input type="text" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} style={inputStyle} /></td>
                          <td style={tdStyle}><input type="number" value={editForm.total_score} onChange={e => setEditForm({...editForm, total_score: e.target.value})} style={inputStyle} /></td>
                          <td style={{ ...tdStyle, fontSize: '14px', color: 'var(--semantic-error)' }}>{wrongQuestions || '-'}</td>
                          <td style={{ ...tdStyle, fontSize: '14px', color: 'var(--ink-subtle)' }}>{new Date(s.last_accessed).toLocaleString('ko-KR')}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button onClick={() => handleSaveEdit(s.id)} style={actionBtnStyle} title="저장"><Check size={16} color="var(--primary)" /></button>
                            <button onClick={handleCancelEdit} style={actionBtnStyle} title="취소"><X size={16} color="var(--ink-muted)" /></button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={tdStyle}>{s.ban}</td>
                          <td style={tdStyle}>{s.num}</td>
                          <td style={{ ...tdStyle, fontWeight: '600', color: 'var(--ink)' }}>{s.name}</td>
                          <td style={{ ...tdStyle, fontWeight: '600', color: 'var(--ink)', fontSize: '16px' }}>{s.total_score}점</td>
                          <td style={{ ...tdStyle, fontSize: '14px', color: 'var(--semantic-error)' }}>{wrongQuestions || '-'}</td>
                          <td style={{ ...tdStyle, fontSize: '14px', color: 'var(--ink-subtle)' }}>{new Date(s.last_accessed).toLocaleString('ko-KR')}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button onClick={() => handleEditClick(s)} style={actionBtnStyle} title="수정"><Edit2 size={16} color="var(--ink-muted)" /></button>
                            <button onClick={() => handleDelete(s.id, s.name)} style={actionBtnStyle} title="삭제"><Trash2 size={16} color="var(--semantic-error)" /></button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: '24px', padding: '16px', background: 'var(--surface-2)', border: 'none', borderRadius: 'var(--r-md)', fontSize: '14px', color: 'var(--ink-muted)', display: 'flex', gap: '24px' }}>
          <span>총 참여자: <strong style={{ color: 'var(--ink)' }}>{students.length}명</strong></span>
          {students.length > 0 && (
            <>
              <span>평균 점수: <strong style={{ color: 'var(--primary)' }}>{Math.round(students.reduce((a, s) => a + s.total_score, 0) / students.length)}점</strong></span>
              <span>최고 점수: <strong style={{ color: 'var(--semantic-warning)' }}>{students[0]?.total_score}점</strong></span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const thStyle = {
  padding: '12px 16px', textAlign: 'left', fontSize: '14px', 
  fontWeight: '600', color: 'var(--ink)', borderBottom: '1px solid var(--hairline)', whiteSpace: 'nowrap'
};
const tdStyle = {
  padding: '12px 16px', textAlign: 'left', fontSize: '14px', color: 'var(--ink-muted)', whiteSpace: 'nowrap'
};
const inputStyle = {
  width: '100%', minWidth: '50px', maxWidth: '80px',
  padding: '6px 8px',
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid var(--hairline)',
  borderRadius: '4px',
  color: 'var(--ink)',
  fontSize: '14px',
  boxSizing: 'border-box'
};
const actionBtnStyle = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '6px',
  margin: '0 2px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
  transition: 'background 0.2s'
};

export default Results;
