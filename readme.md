# AI Mock Interview Platform - HireSim

An AI-powered mock interview platform built with React frontend and Node.js backend. Uses Groq API for real-time question generation based on job description and resume analysis.

## Tech Stack

- **Frontend**: React
- **Backend**: Node.js, Express
- **AI**: Groq API
- **File Processing**: Multer, PDF-parse
- **Voice**: Text-to-speech/speech-to-text

## Setup

### Prerequisites
- Node.js (v14+)
- Groq API key

### Installation

1. **Clone and install dependencies**
```bash
git clone <repo-url>
cd ai-mock-interview-platform

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

2. **Environment Setup**
Create `.env` in backend directory:
```env
PORT=5000
GROQ_API_KEY=your_groq_api_key_here
MONGODB_URI=your_mongo_db_uri_here
JWT_SECRET=your_jwt_secret_here
GROQ_MODEL=specify_the_groq_model_here
GROQ_API_URL=specify_the_groq_api_url_here
```

### Running the App

1. **Start Backend**
```bash
cd backend
npm start
```

2. **Start Frontend**
```bash
cd frontend
npm start
```

## Usage

1. Upload PDF resume
2. Enter job description
3. Start AI-powered interview
4. Answer questions via voice/text
5. Review transcript

## API Endpoints

- `POST /api/upload` - Upload resume and job description
- `POST /api/interview/start` - Start interview session
- `POST /api/interview/next` - Get next question
- `POST /api/interview/end` - End interview

## Features

- Dynamic question generation
- PDF resume parsing
- Voice interaction
- Interview transcript
- Context-aware follow-ups