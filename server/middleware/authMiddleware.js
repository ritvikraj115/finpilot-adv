const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token, auth denied' });

  try {
    const decoded = jwt.verify(token, "secretkey");
    req.user = decoded.user;  // { id: userId }
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};
