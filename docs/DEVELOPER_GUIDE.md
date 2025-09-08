# XHRscribe Developer Guide

## 🚀 Getting Started

### Prerequisites
- Node.js 18.0.0 or higher
- Chrome browser (latest version)
- AI provider API key (OpenAI, Claude, or Gemini)
- Git for version control

### Development Setup

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd XHRscribe
   npm install
   ```

2. **Development Build**
   ```bash
   npm run dev
   # Runs webpack in watch mode with type checking
   ```

3. **Load Extension**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist` folder

## 🛠️ Development Workflow

### Available Scripts

```bash
# Build and Development
npm run build          # Production build
npm run build:dev      # Development build
npm run watch          # Watch mode for development
npm run dev            # Development with type checking

# Quality Assurance
npm run type-check     # TypeScript compilation check
npm run lint           # ESLint code quality check
npm run lint:fix       # Auto-fix ESLint issues
npm run validate       # Full validation (type-check + lint + test)

# Testing
npm run test           # Run Jest test suite
npm run test:watch     # Watch mode testing
npm run test:coverage  # Generate coverage report
npm run test:ci        # CI-friendly test run

# Browser-Specific Testing
npm run test:chrome    # Chrome-specific tests
npm run test:firefox   # Firefox-specific tests
npm run test:edge      # Edge-specific tests

# Packaging
npm run package        # Build and package for distribution
npm run package:firefox # Firefox-specific package

# Maintenance
npm run clean          # Clean build artifacts
npm run security-audit # Security vulnerability audit
```

### Code Quality Standards

#### TypeScript Configuration
- Strict mode enabled
- No implicit any types
- Comprehensive type definitions
- Path mapping for clean imports

#### ESLint Rules
- TypeScript-specific rules
- React best practices
- Security-focused linting
- Auto-fixable rules where possible

#### Testing Standards
- Minimum 80% code coverage
- Unit tests for all services
- Integration tests for core workflows
- Browser-specific test suites

## 🏗️ Architecture Overview

### Project Structure
```
src/
├── components/          # React UI components
│   ├── RecordingTab.tsx
│   ├── TestsTab.tsx
│   ├── SettingsTab.tsx
│   └── AnalyticsTab.tsx
├── services/           # Core business logic
│   ├── llm/           # LLM provider implementations
│   ├── TestGenerationService.ts
│   ├── AnalyticsService.ts
│   ├── RateLimitService.ts
│   └── StateManagementService.ts
├── store/             # Zustand state management
│   └── index.ts
├── types/             # TypeScript type definitions
│   └── index.ts
├── utils/             # Utility functions
│   ├── storage.ts
│   ├── formatting.ts
│   └── encryption.ts
├── background/        # Service worker
│   └── background.ts
├── content/          # Content scripts
│   └── content.ts
└── popup/            # Extension popup
    └── popup.tsx
```

### Key Services

#### TestGenerationService
- Orchestrates test generation workflow
- Manages HAR data processing
- Coordinates with LLM providers
- Handles export operations

#### LLM Providers
- **OpenAIProvider**: GPT-4, GPT-3.5 integration
- **ClaudeProvider**: Anthropic Claude integration
- **GeminiProvider**: Google Gemini integration
- **BaseLLMProvider**: Abstract base class

#### AnalyticsService
- Usage metrics tracking
- Performance monitoring
- Cost analysis
- Quality insights

#### RateLimitService
- API usage tracking
- Rate limit enforcement
- Cost management
- Provider switching

## 🔧 Configuration Management

### Environment Variables
```bash
# Development
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_claude_key
GOOGLE_API_KEY=your_gemini_key

# Build Configuration
NODE_ENV=development|production
DEBUG_MODE=true|false
```

### Extension Settings
- Stored in Chrome's local storage
- Encrypted with AES-256
- Synced across devices (optional)
- Backup and restore functionality

### Development Configuration
```javascript
// webpack.config.js
module.exports = {
  mode: process.env.NODE_ENV || 'development',
  devtool: 'source-map',
  // ... other configuration
};
```

## 🧪 Testing Strategy

### Unit Testing
- Jest framework with TypeScript support
- Comprehensive mocking for Chrome APIs
- Service layer testing with dependency injection
- Utility function testing

### Integration Testing
- End-to-end test generation workflows
- LLM provider integration testing
- Storage and encryption testing
- Cross-browser compatibility testing

### Test Structure
```javascript
// Example test structure
describe('TestGenerationService', () => {
  beforeEach(() => {
    // Setup mocks and test data
  });

  describe('generateFromSession', () => {
    it('should generate tests successfully', async () => {
      // Test implementation
    });

    it('should handle errors gracefully', async () => {
      // Error handling test
    });
  });
});
```

## 🔒 Security Considerations

### Data Protection
- All sensitive data encrypted with AES-256
- API keys stored securely in Chrome storage
- PII detection and automatic masking
- Secure communication with external APIs

### Code Security
- Input validation and sanitization
- XSS prevention measures
- CSRF protection
- Content Security Policy implementation

### Privacy Compliance
- GDPR-compliant data handling
- User consent management
- Data retention policies
- Audit logging

## 🚀 Deployment & Distribution

### Build Process
1. **Clean Build**
   ```bash
   npm run clean
   npm run build
   ```

2. **Quality Validation**
   ```bash
   npm run validate
   ```

3. **Package Creation**
   ```bash
   npm run package
   ```

### Chrome Web Store Deployment
1. Update manifest.json version
2. Create production build
3. Generate package zip
4. Upload to Chrome Web Store
5. Update store listing

### Firefox Add-ons Deployment
1. Build Firefox-specific package
2. Sign with Mozilla
3. Upload to Firefox Add-ons
4. Update compatibility information

## 🐛 Debugging & Troubleshooting

### Development Debugging
- Chrome DevTools integration
- Source map support
- Console logging with debug levels
- Performance profiling

### Common Issues
1. **Extension not loading**
   - Check manifest.json syntax
   - Verify permissions
   - Review console errors

2. **API integration failures**
   - Validate API keys
   - Check network connectivity
   - Review rate limits

3. **Test generation issues**
   - Verify HAR data quality
   - Check LLM provider status
   - Review prompt templates

### Debug Tools
```javascript
// Enable debug mode
localStorage.setItem('debug', 'true');

// View extension logs
chrome.runtime.getBackgroundPage((bg) => {
  console.log(bg.console);
});
```

## 🤝 Contributing Guidelines

### Code Standards
- Follow TypeScript strict mode
- Use ESLint configuration
- Write comprehensive tests
- Document public APIs

### Pull Request Process
1. Fork the repository
2. Create feature branch
3. Implement changes with tests
4. Run validation suite
5. Submit pull request

### Commit Convention
```bash
feat: add new test framework support
fix: resolve authentication issue
docs: update API documentation
test: add integration tests
refactor: improve code organization
```

## 📈 Performance Optimization

### Bundle Optimization
- Tree shaking for unused code
- Code splitting for large modules
- Compression and minification
- Asset optimization

### Runtime Performance
- Lazy loading for heavy components
- Efficient state management
- Memory leak prevention
- Background processing optimization

### Monitoring
- Performance metrics collection
- Memory usage tracking
- API response time monitoring
- User experience analytics

## 🔮 Future Development

### Planned Features
- Enhanced AI model support
- Visual test builder
- Advanced analytics dashboard
- Mobile app testing support

### Architecture Evolution
- Plugin system implementation
- Microservice architecture
- Cloud-based processing options
- Real-time collaboration features

### Technology Roadmap
- Web Components adoption
- Progressive Web App features
- Advanced security enhancements
- Cross-platform compatibility
