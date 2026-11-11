import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../lib/firebase';
import QuizList from './QuizList';
import QuizEditor from './QuizEditor';
import Results from './Results';

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        setUser(user);
      } else {
        navigate('/');
      }
    });
  }, [navigate]);

  if (!user) return <div className="screen"><div style={{color:'white'}}>Loading...</div></div>;

  return (
    <Routes>
      <Route path="/" element={<QuizList user={user} />} />
      <Route path=":quizSetId" element={<QuizEditor user={user} />} />
      <Route path=":quizSetId/results" element={<Results user={user} />} />
    </Routes>
  );
};

export default Dashboard;
