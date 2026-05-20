const express = require('express');
const cors = require('cors');
const chatRoutes = require('./routes/chat.routes');
const authRoutes = require('./routes/auth.routes');
const errorHandler = require('./middleware/errorHandler');
const { requestContext, logRequestBody } = require('./middleware/requestLogger');

const app = express();

app.use(requestContext);
app.use(cors());
app.use(express.json());
app.use(logRequestBody);

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

app.get('/', (_req, res) => res.send('Medbot API is running'));

app.use(errorHandler);

module.exports = app;
