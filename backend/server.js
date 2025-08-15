require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const auth = require('./middleware/auth');
const loginRoute = require('./routes/login');
const registerRoute = require('./routes/register');
const changePasswordRoute = require('./routes/changepassword');
const interviewsRoute = require('./routes/interviews');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

app.use('/login', loginRoute);
app.use('/register', registerRoute);
app.use('/changepassword', changePasswordRoute);
app.use('/interviews', auth, interviewsRoute);

global.db;

async function connectMongoDB() {
  try {
    const uri = process.env.MONGODB_URI;
    // console.log(uri);
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db('HireSim');
    global.db = db;
    console.log('Connected to database:', 'HireSim');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await connectMongoDB();
});

module.exports = app;