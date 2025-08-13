import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <h1 className="text-4xl font-bold mb-4">Prepare for your interviews</h1>
      <p className="mb-6 text-lg text-gray-700">Your AI-driven mock interviewer awaits.</p>
      <div className="flex space-x-4">
        <Link to="/login" className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700">
          Start Preparation
        </Link>
      </div>
    </div>
  );
}
