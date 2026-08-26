import { getPool } from '@lhr/db';
import { createApp } from '../src/server.js';

export default createApp(getPool());
