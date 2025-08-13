const jwt = require('jsonwebtoken');
function auth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  // console.log(authHeader);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email };
    next();
  } catch (err) {
    console.error('JWT verification failed:', err);
    return res.status(403).json({ message: 'Forbidden: Invalid token' });
  }
}

module.exports = auth;
