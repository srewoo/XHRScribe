#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 XHRScribe Build Validation...\n');

const results = {
  tests: [],
  passed: 0,
  failed: 0
};

function addResult(testName, success, details = '') {
  results.tests.push({ test: testName, success, details });
  if (success) {
    results.passed++;
    console.log(`✅ ${testName}`, details);
  } else {
    results.failed++;
    console.error(`❌ ${testName}`, details);
  }
}

// Test 1: Check if dist folder exists
const distExists = fs.existsSync('dist');
addResult('Dist Folder Exists', distExists, distExists ? 'Found dist/' : 'Missing dist/');

// Test 2: Check manifest.json
const manifestPath = 'dist/manifest.json';
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const hasRequiredFields = manifest.name && manifest.version && manifest.manifest_version === 3;
  addResult('Manifest Valid', hasRequiredFields, `v${manifest.version} - ${manifest.name}`);
} catch (error) {
  addResult('Manifest Valid', false, error.message);
}

// Test 3: Check core JS files
const coreFiles = ['background.js', 'popup.js', 'content.js', 'options.js'];
coreFiles.forEach(file => {
  const filePath = `dist/${file}`;
  const exists = fs.existsSync(filePath);
  const size = exists ? `${(fs.statSync(filePath).size / 1024).toFixed(1)}KB` : 'Missing';
  addResult(`${file} exists`, exists, size);
});

// Test 4: Check HTML files
const htmlFiles = ['popup.html', 'options.html'];
htmlFiles.forEach(file => {
  const filePath = `dist/${file}`;
  const exists = fs.existsSync(filePath);
  addResult(`${file} exists`, exists);
});

// Test 5: Check icons
const iconSizes = ['16', '32', '48', '128'];
iconSizes.forEach(size => {
  const iconPath = `dist/icons/icon${size}.png`;
  const exists = fs.existsSync(iconPath);
  addResult(`Icon ${size}px exists`, exists);
});

// Test 6: Check if background.js contains logging
try {
  const backgroundContent = fs.readFileSync('dist/background.js', 'utf8');
  const hasLogging = backgroundContent.includes('XHRScribe background script loading');
  addResult('Background Script Logging', hasLogging, 'Initialization logs present');
} catch (error) {
  addResult('Background Script Logging', false, error.message);
}

// Test 7: Check total build size
try {
  const getDirectorySize = (dir) => {
    let size = 0;
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        size += getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    });
    
    return size;
  };
  
  const totalSize = getDirectorySize('dist');
  const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  const sizeOK = totalSize < 20 * 1024 * 1024; // Less than 20MB (Chrome Store limit is 128MB)
  addResult('Build Size Check', sizeOK, `${sizeMB}MB ${sizeOK ? '(acceptable)' : '(too large for Chrome Store)'}`);
} catch (error) {
  addResult('Build Size Check', false, error.message);
}

// Test 8: Check package structure
try {
  const packageExists = fs.existsSync('package');
  const zipFiles = packageExists ? fs.readdirSync('package').filter(f => f.endsWith('.zip')) : [];
  addResult('Package Created', zipFiles.length > 0, zipFiles.length > 0 ? zipFiles[0] : 'No zip file');
} catch (error) {
  addResult('Package Created', false, error.message);
}

// Summary
console.log('\n📊 BUILD VALIDATION SUMMARY');
console.log('============================');
console.log(`✅ Passed: ${results.passed}`);
console.log(`❌ Failed: ${results.failed}`);
console.log(`📊 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

if (results.failed === 0) {
  console.log('\n🎉 BUILD VALIDATION PASSED! Extension is ready for testing.');
  console.log('\n📋 Next Steps:');
  console.log('1. Load dist/ folder in chrome://extensions');
  console.log('2. Run EXTENSION_TEST.js in the extension popup console');
} else {
  console.log('\n⚠️  Build validation failed. Fix the issues above before testing.');
}

process.exit(results.failed === 0 ? 0 : 1);
