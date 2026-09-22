import { createApp } from '../src/app.js';

process.stdout.write(JSON.stringify(createApp().locals.spec, null, 2));
