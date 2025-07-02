const express = require('express');
const { exec } = require('child_process');
const app = express();

// Parse JSON body
app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('🚀 Webhook received');

  exec('/home/ec2-user/deploy.sh', (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Deployment error:', stderr);
      return res.status(500).send('Deployment failed');
    }

    console.log('✅ Deployment output:\n', stdout);
    res.status(200).send('Deployed successfully');
  });
});

// Start the webhook server
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🔧 Webhook server running on port ${PORT}`);
});
