#!/usr/bin/env node

// Simple test script to verify API configuration
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔧 Testing FaultMaven API Configuration...\n');

// Read config
const configPath = join(__dirname, '../src/config.ts');
const configContent = readFileSync(configPath, 'utf8');

// Extract API URL from config
const apiUrlMatch = configContent.match(/apiUrl:\s*import\.meta\.env\.VITE_API_URL\s*\|\|\s*"([^"]+)"/);
const defaultApiUrl = apiUrlMatch ? apiUrlMatch[1] : 'Not found';

console.log('📋 Configuration:');
console.log(`   Default API URL: ${defaultApiUrl}`);

// Check environment file
const envPath = join(__dirname, '../.env.local');
try {
  const envContent = readFileSync(envPath, 'utf8');
  const envMatch = envContent.match(/VITE_API_URL=([^\n]+)/);
  const envApiUrl = envMatch ? envMatch[1] : 'Not set';
  console.log(`   Environment API URL: ${envApiUrl}`);
} catch (error) {
  console.log('   Environment API URL: .env.local not found');
}

console.log('\n🔍 Expected Behavior:');
console.log('   - If .env.local exists → Uses VITE_API_URL value');
console.log('   - If .env.local missing → Uses default production URL');
console.log('\n🚀 To test the API:');
console.log('   1. Start development: pnpm dev');
console.log('   2. Open extension in browser');
console.log('   3. Check browser console for API endpoint logs');
console.log('   4. Try sending a message to see real API calls');
console.log('\n📋 Expected API Flow:');
console.log('   1. POST /api/v1/sessions - Create session');
console.log('   2. POST /api/v1/data/ - Upload data (optional)');
console.log('   3. POST /api/v1/agent/query - Send queries');
console.log('   4. POST /api/v1/sessions/{id}/heartbeat - Keep session alive'); 