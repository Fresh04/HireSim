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
    <div className="max-w-2xl mx-auto mt-8 p-6 bg-gray-800 rounded-lg border border-gray-700 shadow-lg">
      <h1 className="text-2xl font-bold text-white mb-6">Create New Interview</h1>
      <form onSubmit={handleCreate} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Company</label>
            <input 
              value={company} 
              onChange={e => setCompany(e.target.value)} 
              required 
              placeholder="e.g. Google, Amazon" 
              className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Position</label>
            <input 
              value={position} 
              onChange={e => setPosition(e.target.value)} 
              required 
              placeholder="e.g. Frontend Developer" 
              className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Job Description</label>
          <textarea 
            value={description} 
            onChange={e => setDescription(e.target.value)} 
            required 
            placeholder="Paste the job description here..." 
            className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition min-h-[120px]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Requirements (Optional)</label>
          <textarea 
            value={requirements} 
            onChange={e => setRequirements(e.target.value)} 
            placeholder="Specific skills or qualifications..." 
            className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition min-h-[80px]"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Questions</label>
            <input 
              type="number" 
              min={1} 
              max={50} 
              value={numQuestions} 
              onChange={e => setNumQuestions(e.target.value)} 
              className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Difficulty</label>
            <select 
              value={difficulty} 
              onChange={e => setDifficulty(e.target.value)} 
              className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Mode</label>
            <select 
              value={mode} 
              onChange={e => setMode(e.target.value)} 
              className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            >
              <option value="mock">Mock Interview</option>
              <option value="timed">Timed Practice</option>
              <option value="assessment">Full Assessment</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Upload Resume (Optional)
          </label>
          <div className="flex items-center justify-center w-full">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-600 border-dashed rounded-lg cursor-pointer bg-gray-700 hover:bg-gray-700/50 transition">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg className="w-8 h-8 mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="mb-2 text-sm text-gray-400">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-gray-500">PDF (MAX. 5MB)</p>
              </div>
              <input 
                type="file" 
                accept="application/pdf" 
                onChange={e => setResumeFile(e.target.files[0])} 
                className="hidden" 
              />
            </label>
          </div>
        </div>

        <button 
          type="submit" 
          className="w-full py-3 px-4 mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        >
          Create Interview
        </button>
      </form>
    </div>
  );
}
