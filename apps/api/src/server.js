require('dotenv').config();
const app = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info('server.listen', { port: PORT, nodeEnv: process.env.NODE_ENV });
});