import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Dashboard() {
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [numQuestions, setNumQuestions] = useState(5);
  const [difficulty, setDifficulty] = useState('medium');
  const [mode, setMode] = useState('mock'); 
  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (!token) { alert('You must be logged in'); return; }

    const formData = new FormData();
    formData.append('company', company);
    formData.append('position', position);
    formData.append('description', description);
    formData.append('requirements', requirements);
    formData.append('numQuestions', numQuestions);
    formData.append('difficulty', difficulty);
    formData.append('mode', mode);
    if (resumeFile) formData.append('resume', resumeFile);

    try {
      console.log(token);
      const { data } = await axios.post(
        `${import.meta.env.VITE_API_URL}/interviews`,
        formData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      navigate(`/interview/${data.interviewId}`, { state: { firstQuestion: data.firstQuestion } });
    } catch (err) {
      console.error('Error creating interview:', err.response?.data || err.message || err);
      alert('Failed to create interview');
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-10 p-6 bg-white rounded shadow">
      <h1 className="text-2xl mb-6">Create New Interview</h1>
      <form onSubmit={handleCreate} className="space-y-4">
        <input value={company} onChange={e => setCompany(e.target.value)} required placeholder="Company" className="w-full p-2 border rounded" />
        <input value={position} onChange={e => setPosition(e.target.value)} required placeholder="Position" className="w-full p-2 border rounded" />
        <textarea value={description} onChange={e => setDescription(e.target.value)} required placeholder="Job Description" className="w-full p-2 border rounded" rows={4} />
        <textarea value={requirements} onChange={e => setRequirements(e.target.value)} placeholder="Requirements (optional)" className="w-full p-2 border rounded" rows={2} />
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm">Number of questions</label>
            <input type="number" min={1} max={50} value={numQuestions} onChange={e => setNumQuestions(e.target.value)} className="w-full p-2 border rounded" />
          </div>
          <div className="flex-1">
            <label className="block text-sm">Difficulty</label>
            <select value={difficulty} onChange={e => setDifficulty(e.target.value)} className="w-full p-2 border rounded">
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">Mode</label>
          <select value={mode} onChange={e => setMode(e.target.value)} className="w-full p-2 border rounded">
            <option value="mock">Mock (practice)</option>
            <option value="timed">Timed (per question)</option>
            <option value="assessment">Assessment (scored)</option>
          </select>
        </div>

        <div>
          <label className="block mb-1">Upload Resume (PDF, optional)</label>
          <input type="file" accept="application/pdf" onChange={e => setResumeFile(e.target.files[0])} />
        </div>

        <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700">
          Create Interview
        </button>
      </form>
    </div>
  );
}
