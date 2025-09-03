// scripts/predownload-mongodb.js
// Run this script to download MongoDB binary before running tests

const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');

async function predownloadMongoDB() {
  console.log('🚀 Pre-downloading MongoDB binary for tests...');
  console.log('This may take several minutes on first run...');
  
  const startTime = Date.now();
  
  try {
    // Create and immediately stop a server to trigger binary download
    console.log('Starting download...');
    const mongod = await MongoMemoryServer.create({
      binary: {
        version: '6.0.0',
        downloadDir: path.resolve('./node_modules/.cache/mongodb-memory-server/mongodb-binaries'),
        downloadTimeout: 600000, // 10 minutes
      },
      instance: {
        port: undefined,
        dbName: 'predownload-test',
      },
    });
    
    console.log('✅ MongoDB binary downloaded successfully!');
    console.log('📍 Binary location:', mongod.binaryOpts);
    
    await mongod.stop();
    
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    console.log(`⏱️  Download completed in ${duration} seconds`);
    console.log('🧪 Your tests should now run much faster!');
    
  } catch (error) {
    console.error('❌ Failed to download MongoDB binary:', error.message);
    console.error('This might be due to network issues or firewall restrictions.');
    console.error('Try running the script again or check your internet connection.');
    process.exit(1);
  }
}

// Show download progress
process.on('unhandledRejection', (error) => {
  if (error.message.includes('download')) {
    console.log('⏳ Download in progress...');
  }
});

predownloadMongoDB().catch(console.error);