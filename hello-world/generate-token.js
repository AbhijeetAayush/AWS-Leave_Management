const jwt = require('jsonwebtoken');
const secret = '88dfe865fea97d63b711a563355fe6658a5188c40a6518865e8c413e77936b4c';
const token = jwt.sign({ sub: 'test-user' }, secret, { expiresIn: '1h' });
console.log(token);