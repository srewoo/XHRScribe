#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

console.log(`${colors.blue}${colors.bright}🚀 Building XHRScribe Chrome Extension...${colors.reset}`);

// Step 1: Clean previous builds
console.log(`${colors.yellow}📦 Cleaning previous builds...${colors.reset}`);
if (fs.existsSync('dist')) {
  fs.rmSync('dist', { recursive: true, force: true });
}
if (fs.existsSync('package')) {
  fs.rmSync('package', { recursive: true, force: true });
}

// Step 2: Run webpack build
console.log(`${colors.yellow}🔨 Building with webpack...${colors.reset}`);
try {
  execSync('npm run build:webpack', { stdio: 'inherit' });
} catch (error) {
  console.error(`${colors.red}❌ Build failed!${colors.reset}`);
  process.exit(1);
}

// Step 3: Create package directory
console.log(`${colors.yellow}📁 Creating package directory...${colors.reset}`);
fs.mkdirSync('package', { recursive: true });

// Step 4: Get version from manifest
const manifest = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8'));
const version = manifest.version;
const name = manifest.name.toLowerCase().replace(/\s+/g, '-');

// Step 5: Create zip file
const zipFileName = `${name}-v${version}.zip`;
const zipFilePath = path.join('package', zipFileName);

console.log(`${colors.yellow}🗜️  Creating zip file: ${zipFileName}...${colors.reset}`);

const output = fs.createWriteStream(zipFilePath);
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
  const sizeKB = (archive.pointer() / 1024).toFixed(2);
  console.log(`${colors.green}${colors.bright}✅ Build complete!${colors.reset}`);
  console.log(`${colors.green}📦 Extension built to: dist/${colors.reset}`);
  console.log(`${colors.green}🎁 Chrome Store package: package/${zipFileName} (${sizeKB} KB)${colors.reset}`);
  console.log(`${colors.blue}${colors.bright}📋 Next steps:${colors.reset}`);
  console.log(`   1. Test locally: Load 'dist' folder in chrome://extensions`);
  console.log(`   2. Upload to Chrome Web Store: package/${zipFileName}`);
});

output.on('error', (err) => {
  console.error(`${colors.red}❌ Error creating zip file:${colors.reset}`, err);
  process.exit(1);
});

archive.on('error', (err) => {
  console.error(`${colors.red}❌ Error creating archive:${colors.reset}`, err);
  process.exit(1);
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn(`${colors.yellow}⚠️  Warning:${colors.reset}`, err);
  } else {
    throw err;
  }
});

// Pipe archive data to the file
archive.pipe(output);

// Add dist folder contents to zip
archive.directory('dist/', false);

// Finalize the archive
archive.finalize();