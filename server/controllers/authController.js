const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');

exports.signup = async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    user = await User.create({ email, password: hash, budgets: [] });

    const payload = { user: { id: user.id } };
    const token = jwt.sign(payload, "secretkey", { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    res.status(500).send('Server error');
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const payload = { user: { id: user.id } };
    const token = jwt.sign(payload, "secretkey", { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    console.log(err)
    res.status(500).send(err);
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id; // assume requireAuth has populated req.user
    const user = await User.findById(userId).select("budgets");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ budgets: user.budgets || {} });
  } catch (err) {
    next(err);
  }
};
