/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { initGameEngine } from '../lib/gameEngine';
import { BUB_IMG_SRC } from '../lib/assets';
import PacmanWrapper from './PacmanWrapper';


const Game = () => {
  const [searchParams] = useSearchParams();
  const room = searchParams.get('room');

  const [quizSet, setQuizSet] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [playerInfo, setPlayerInfo] = useState({ ban: '', num: '', name: '' });
  const [gameState, setGameState] = useState('login'); // 'login', 'playing'
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [scale, setScale] = useState(1);

  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const fetchQuizSet = useCallback(async () => {
    setLoading(true);
    const { data: qSet, error } = await db
      .from('quiz_sets')
      .select('*, question_banks(id, title)')
      .eq('link_code', room)
      .single();

    if (error || !qSet) {
      setErrorMsg('유효하지 않은 링크입니다.');
      setLoading(false);
      return;
    }
    setQuizSet(qSet);

    // v2: bank_id가 있으면 bank_questions에서 로드, 없으면 레거시 questions 테이블 사용
    if (qSet.bank_id) {
      const { data: qData } = await db
        .from('bank_questions')
        .select('*')
        .eq('bank_id', qSet.bank_id)
        .order('question_num', { ascending: true });
      setQuestions(qData || []);
    } else {
      // 레거시 폴백: 수동으로 추가한 questions 테이블
      const { data: qData } = await db
        .from('questions')
        .select('*')
        .eq('quiz_set_id', qSet.id)
        .order('created_at', { ascending: true });
      setQuestions(qData || []);
    }
    setLoading(false);
  }, [room]);

  useEffect(() => {
    if (room) {
      fetchQuizSet();
    }
  }, [room, fetchQuizSet]);

  const handleStart = async () => {
    if (questions.length === 0) {
      setErrorMsg('��ϵ� ������ �����ϴ�. �����ڿ��� �����ϼ���.');
      return;
    }
    const { ban, num, name } = playerInfo;
    if (!ban || !num || !name) {
      setErrorMsg('모든 정보를 입력해주세요.');
      return;
    }

    setLoading(true);
    // 학생 정보 조회
    let { data: student, error: fetchError } = await db
      .from('students')
      .select('*')
      .eq('quiz_set_id', quizSet.id)
      .eq('ban', parseInt(ban))
      .eq('num', parseInt(num))
      .eq('name', name)
      .maybeSingle();

    if (fetchError) {
      setLoading(false);
      console.error(fetchError);
      setErrorMsg('학생 정보를 불러오는 중 오류가 발생했습니다.');
      return;
    }

    if (!student) {
      // 학생 정보가 없으면 새로 생성
      const { data: newStudent, error: insertError } = await db
        .from('students')
        .insert([{ quiz_set_id: quizSet.id, ban: parseInt(ban), num: parseInt(num), name }])
        .select()
        .single();

      if (insertError) {
        setLoading(false);
        console.error(insertError);
        setErrorMsg('학생 정보를 생성하는 중 오류가 발생했습니다.');
        return;
      }
      student = newStudent;
    }

    setLoading(false);

    setPlayerInfo(prev => ({ ...prev, id: student.id, score: student.total_score || 0, stageScores: student.stage_scores || {} }));
    setGameState('playing');
  };

  useEffect(() => {
    if (gameState === 'playing' && canvasRef.current) {
      // 퀴즈 데이터를 게임 엔진 포맷으로 변환
      const quizPool = questions.map(q => ({
        id: q.id,
        questionNum: q.question_num,
        question: q.question_text,
        type: q.options && q.options.length > 0 && q.options.some(o => o !== '') ? 'choice' : 'short',
        options: q.options,
        answer: q.answers,
        image: q.image_url
      }));

      const player = {
        id: playerInfo.id,
        ban: playerInfo.ban,
        num: playerInfo.num,
        name: playerInfo.name,
        sheet: quizSet.title,
        score: playerInfo.score,
        stageScore: 0,
        stageScores: playerInfo.stageScores,
        x: 50, y: 50, w: 30, h: 44, vx: 0, vy: 0, facing: 1
      };

      const callbacks = {
        onSaveStageScore: async ({ stageName, stageScore }) => {
          const newStageScores = { ...player.stageScores, [stageName]: Math.max(stageScore, player.stageScores[stageName] || 0) };
          const newTotal = Object.values(newStageScores).reduce((a, b) => a + b, 0);

          await db.from('students').update({
            total_score: newTotal,
            stage_scores: newStageScores
          }).eq('id', player.id);

          return { score: newTotal, stageScores: newStageScores };
        },
        onSubmitAnswer: async ({ id, answer, isCorrect }) => {
          const qObj = questions.find(q => q.id === id);
          if (qObj) {
            if (!isCorrect) {
              const { data: existing } = await db.from('student_logs')
                .select('id')
                .eq('student_id', player.id)
                .eq('question_id', qObj.id)
                .eq('is_correct', false)
                .limit(1);
              if (existing && existing.length > 0) return;
            }
            const { error } = await db.from('student_logs').insert([{
              student_id: player.id,
              question_id: qObj.id,
              is_correct: isCorrect,
              submitted_answer: String(answer).slice(0, 300)
            }]);
            if (error) {
              console.error("Insert log error:", error);
              alert("오답 기록 DB 오류: " + error.message);
            }
          }
        },
        onBack: () => {
          if (engineRef.current) {
            engineRef.current.cleanup();
            engineRef.current = null;
          }
          // DOM이 완전히 정리된 후 login으로 전환
          setTimeout(() => {
            setGameState('login');
          }, 50);
        }
      };

      engineRef.current = initGameEngine(canvasRef.current, callbacks, { player, quizPool });

      // Start the game loop after a brief delay to ensure DOM is ready
      setTimeout(() => {
        engineRef.current.start();
      }, 100);
    }

    return () => {
      if (engineRef.current) {
        engineRef.current.cleanup();
      }
    };
  }, [gameState]);

  useEffect(() => {
    const handleResize = () => {
      if (gameState !== 'playing') {
        setScale(1);
        return;
      }
      const availableWidth = window.innerWidth;
      const availableHeight = window.innerHeight;

      // Base game dimensions: width 800px, height ~620px
      // Adding a small margin of 20px
      const scaleX = availableWidth / 800;
      const scaleY = availableHeight / 620;

      const newScale = Math.min(scaleX, scaleY);
      setScale(newScale > 0 ? newScale : 1);
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial call
    return () => window.removeEventListener('resize', handleResize);
  }, [gameState]);

  if (!room) {
    return <div className="screen"><div className="login-card"><div className="login-sub">방 코드가 없습니다.</div></div></div>;
  }

  if (!quizSet) {
    return <div className="screen"><div className="login-card"><div className="login-sub">게임 정보를 불러오는 중...</div></div></div>;
  }

  if (gameState === 'login') {
    return (
      <div key="login-view" className="screen login-screen" id="scr-login">
        <div className="login-card">
          {quizSet?.game_type === 'pacman' ? (
            <>
              <div className="login-icon">
                <img src="/pacman-icon.png" alt="Pacman" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
              <div className="login-title">PACMAN<br />QUIZ ADVENTURE</div>
            </>
          ) : (
            <>
              <div className="login-icon">
                <img src={BUB_IMG_SRC} alt="Player" style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }} />
              </div>
              <div className="login-title">BUBBLE BOBBLE<br />QUIZ ADVENTURE</div>
            </>
          )}
          <div className="login-sub">방 코드: {room} {quizSet ? `(${quizSet.title})` : ''}</div>

          {errorMsg && <div style={{ color: 'var(--semantic-error)', fontSize: '14px', textAlign: 'center', marginBottom: '16px' }}>{errorMsg}</div>}

          <label className="f-label">반 · 번호 · 이름</label>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'stretch' }}>
            <div className="f-wrap" style={{ width: '60px', marginBottom: 0, flexShrink: 0 }}>
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="반" value={playerInfo.ban} onChange={e => setPlayerInfo({ ...playerInfo, ban: e.target.value.replace(/[^0-9]/g, '') })} style={{ textAlign: 'center', padding: '12px 4px' }} />
            </div>
            <div className="f-wrap" style={{ width: '60px', marginBottom: 0, flexShrink: 0 }}>
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="번호" value={playerInfo.num} onChange={e => setPlayerInfo({ ...playerInfo, num: e.target.value.replace(/[^0-9]/g, '') })} style={{ textAlign: 'center', padding: '12px 4px' }} />
            </div>
            <div className="f-wrap" style={{ flex: 1, marginBottom: 0 }}>
              <input type="text" placeholder="이름" value={playerInfo.name} onChange={e => setPlayerInfo({ ...playerInfo, name: e.target.value })} maxLength="12" />
            </div>
          </div>

          <button className="btn-teal" onClick={handleStart} disabled={loading || !quizSet}>
            {loading ? '접속 중...' : '게임 시작 ▶'}
          </button>

          <div style={{ marginTop: '24px', fontSize: '10px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: '1.4', wordBreak: 'keep-all' }}>
            본 앱에 사용된 캐릭터 이미지는 주식회사 타이토(TAITO Corporation)의 게임 '버블보블(Bubble Bobble)' 및 주식회사 반다이남코 엔터테인먼트(Bandai Namco Entertainment)의 게임 '팩맨(Pac-Man)'의 자산이며, 교육적 목적으로만 사용되었습니다. 모든 권리는 원저작권자에게 있습니다. 교육적 목적 이외의 사용은 금지합니다.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {quizSet?.game_type === 'pacman' ? (
        <PacmanWrapper 
          quizPool={questions.map(q => ({
            id: q.id,
            questionNum: q.question_num,
            question: q.question_text,
            type: q.options && q.options.length > 0 && q.options.some(o => o !== '') ? 'choice' : 'short',
            options: q.options,
            answer: q.answers,
            image: q.image_url
          }))}
          player={{
            id: playerInfo.id,
            ban: playerInfo.ban,
            num: playerInfo.num,
            name: playerInfo.name,
            sheet: quizSet.title,
            score: playerInfo.score,
            stageScore: 0,
            stageScores: playerInfo.stageScores,
            x: 50, y: 50, w: 30, h: 44, vx: 0, vy: 0, facing: 1
          }}
          callbacks={{
            onSaveStageScore: async ({ stageName, stageScore }) => {
              const newStageScores = { ...playerInfo.stageScores, [stageName]: Math.max(stageScore, playerInfo.stageScores[stageName] || 0) };
              const newTotal = Object.values(newStageScores).reduce((a, b) => a + b, 0);
              await db.from('students').update({ total_score: newTotal, stage_scores: newStageScores }).eq('id', playerInfo.id);
              setPlayerInfo(prev => ({ ...prev, score: newTotal, stageScores: newStageScores }));
              return { score: newTotal, stageScores: newStageScores };
            },
            onSubmitAnswer: async ({ id, answer, isCorrect }) => {
              const qObj = questions.find(q => q.id === id);
              if (qObj) {
                if (!isCorrect) {
                  const { data: existing } = await db.from('student_logs')
                    .select('id')
                    .eq('student_id', playerInfo.id)
                    .eq('question_id', qObj.id)
                    .eq('is_correct', false)
                    .limit(1);
                  if (existing && existing.length > 0) return;
                }
                await db.from('student_logs').insert([{
                  student_id: playerInfo.id,
                  question_id: qObj.id,
                  is_correct: isCorrect,
                  submitted_answer: String(answer).slice(0, 300)
                }]);
              }
            }
          }}
          onExit={() => setGameState('login')}
        />
      ) : (
        <div key="game-view" className="screen" id="scr-game" style={{ background: 'var(--canvas)', justifyContent: 'center' }}>
          <div id="game-container" className="game-wrap" style={{ transform: `scale(${scale})`, transformOrigin: 'center center', width: '800px', height: '620px', flex: 'none' }}>
            {/* HUD */}
            <div id="hud" className="hud">
              <div className="hud-item player"><span className="hud-icon">👾</span> <span className="hud-main teal" id="hv-name">{playerInfo.name}</span></div>
              <div className="hud-item"><span className="hud-icon">⭐</span> <span className="hud-main gold"><span id="hv-score">{playerInfo.score}</span></span></div>
              <div className="hud-item"><span className="hud-icon">🎯</span> <span className="hud-main teal" id="hv-quiz">0/0</span></div>
              <div className="hud-item"><span className="hud-icon">📋</span> <span className="hud-main blue" id="hv-sheet">{quizSet?.title}</span></div>
            </div>

            {/* 캔버스 영역 */}
            <div id="cw-wrap" className="canvas-area">
              <canvas id="gc" width="800" height="480" tabIndex="0" ref={canvasRef}></canvas>
              <div id="float-layer"></div>
              <div id="c-ov" className="c-overlay"><span className="ot">READY!</span><br /><span className="oh">화면을 클릭하여 시작</span></div>

              {/* 게임 클리어 오버레이 */}
              <div id="clear-ov" className="clear-overlay">
                <div id="clear-title" className="clear-title">STAGE CLEAR!</div>
                <div id="clear-sub" className="clear-sub"></div>
                <div id="clear-sc" className="clear-score"></div>
                <div style={{ marginTop: '20px' }}>
                  <button id="btn-retry" className="btn-clear sec" style={{ margin: '5px' }}>다시 하기</button>
                  <button id="btn-back" className="btn-clear sec" style={{ margin: '5px' }}>처음으로</button>
                </div>
              </div>
            </div>
          </div>

          {/* 셀렉트박스 (엔진 코드 호환을 위해 숨김) */}
          <select id="sel-sheet" style={{ display: 'none' }}>
            <option value={quizSet?.title}>{quizSet?.title}</option>
          </select>
        </div>
      )}
    </>
  );
};

export default Game;
