const express = require('express');
const { exec } = require('child_process');
const app = express();

// Parse JSON body
app.use(express.json());

app.post('/webhook', (req, res) => {

  // Check for secret
  if( req.headers['x-webhook-secret'] !== process.env.WEBHOOK_SECRET ) {
    console.error('❌ Unauthorized webhook attempt');
    return res.status(401).send('Unauthorized');
  }

  // Pull the main branch, and restart main.js
  
});

// Start the webhook server
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🔧 Webhook server running on port ${PORT}`);
});
