# XHRScribe - Chrome Extension

> Turn traffic into tests

## 🚀 Overview

XHRScribe is an intelligent Chrome extension that automatically captures network traffic during web application navigation and uses advanced AI to generate comprehensive, production-ready test suites. Built with privacy and security in mind, it supports multiple AI providers and test frameworks with enhanced capabilities for enterprise-grade testing.

## 🔧 Recent Hardening Pass

A correctness, privacy, and feature-completeness pass focused on closing the gap
between advertised and actually-wired behaviour:

- **Privacy choke point fixed** — request *and* response headers/bodies are now
  masked in a single guaranteed pass at stop-recording time. Previously response
  data could be persisted unmasked, and a request/response race could drop
  captured responses entirely.
- **WebSocket & SSE capture fixed** — frame-bearing WebSocket and SSE requests
  were silently dropped from the HAR (no status code); they now survive into the
  generated tests.
- **MV3 lifecycle leaks fixed** — duplicate heartbeat-alarm listeners and a
  leaking cleanup interval are gone; active sessions are snapshotted to
  `chrome.storage.session` and recovered if the service worker restarts
  mid-recording.
- **Robust LLM output parsing** — generated code now has markdown fences and
  surrounding prose reliably stripped (single block, multiple blocks, and
  unterminated fences) before it ever reaches a test file.
- **Validate → auto-fix → re-validate loop** — generated suites that aren't
  production/staging-ready are run through the IntelligentAutoFixer (rule-based
  fixes first, then AI for the remainder) and re-validated; the fix is only kept
  if the score improves. Surfaced as an "Auto-fixed" badge in the UI.
- **Artifact exports wired to the UI** — OpenAPI spec, GraphQL schema, `.env`
  file, and a security-test report can now be exported per session (the
  generators existed but had no UI trigger).
- **Dead code removed** — orphaned `LLMService`/`AnthropicProvider`/
  `AIProviderFactory`/`StreamingService`/`AssertionGenerator`/
  `TestGenerationTemplates` deleted; the single live LLM path is `AIService` +
  the four concrete providers.
- **Test infrastructure repaired** — the AIService suite (previously unable to
  load) now runs; full suite at 227 passing across 16 suites.

## ✨ Enhanced Features

### 🔍 **Advanced Network Capture**
- Automatically records XHR, fetch, WebSocket, and GraphQL requests
- Smart filtering and categorization with real-time processing
- Streaming HAR processing for large-scale applications
- Request relationship mapping and dependency analysis
- Background processing with progress tracking

### 🤖 **Multi-Provider AI Integration**
- **OpenAI**: GPT-5.5, GPT-5.4-mini, GPT-4.1 (1M context), GPT-4.1-mini
- **Anthropic Claude**: Claude Opus 4.8, Claude Sonnet 4.6, Claude Haiku 4.5
- **Google Gemini**: Gemini 3.5 Flash, Gemini 2.5 Pro, Gemini 3.1 Flash-Lite
- **Local Models**: Llama 3.2, DeepSeek Coder (via Ollama)
- **Cost Estimation**: Real-time token usage and cost tracking
- **Quality Scoring**: AI-powered test quality analysis with recommendations

### 🔒 **Enterprise Security & Privacy**
- AES-256 encryption for all stored data and API keys
- Advanced data masking (PII, tokens, credentials, sensitive headers)
- Permissions audit script with security recommendations
- Privacy-first architecture with local processing options
- GDPR compliance and data retention controls

### 🧪 **Comprehensive Test Generation**
- **8 Test Frameworks**: Jest, Playwright, Mocha/Chai, Cypress, Puppeteer, Vitest, Supertest, Postman
- **Authentication Tests**: Bearer tokens, API keys, OAuth, custom auth patterns
- **Error Scenario Coverage**: 4xx/5xx responses, network failures, timeouts
- **Data Validation Tests**: Schema validation, type checking, boundary testing
- **Performance Assertions**: Response time limits, load testing scenarios
- **Security Tests**: Header validation, CORS checks, vulnerability scanning
- **Mock Data Generation**: Realistic test data instead of production data
- **Retry Logic**: Robust retry mechanisms for flaky tests

### 🛠️ **Enhanced Developer Experience**
- **VSCode Integration**: Direct export to development environment
- **Multiple Export Options**: File download, clipboard copy, batch operations
- **Test Metadata**: Coverage analysis, complexity scoring, execution estimates
- **Quality Insights**: Improvement recommendations and best practices
- **Git Workflow Support**: Pre-commit hooks and validation scripts
- **CI/CD Templates**: Ready-to-use pipeline configurations

## 🏗️ Architecture

### Built With
- **React 18+** with TypeScript
- **Material-UI** for modern UI components
- **Zustand** for state management
- **Chrome Extension API** (Manifest V3)
- **Crypto-JS** for encryption
- **Webpack** for bundling

### Project Structure
```
src/
├── popup/           # Extension popup interface
├── options/         # Settings and configuration page
├── background/      # Service worker for network capture
├── content/         # Content scripts
├── components/      # Reusable React components
├── utils/           # Utility functions
├── types/           # TypeScript type definitions
├── store/           # State management
└── icons/           # Extension icons
```

## 🚦 Getting Started

### Prerequisites
- Node.js 18.0.0 or higher
- Chrome browser
- AI provider API key (OpenAI, Claude, or Gemini)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd XHRscribe
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist` folder

### Development

1. **Start development build**
   ```bash
   npm run dev
   ```

2. **Run type checking**
   ```bash
   npm run type-check
   ```

3. **Run linting**
   ```bash
   npm run lint
   ```

## 📖 Usage

### Quick Start

1. **Configure Settings**
   - Click the extension icon
   - Go to Settings and configure your AI provider
   - Enter your API key securely (encrypted with AES-256)
   - Select preferred test framework and complexity level

2. **Start Recording**
   - Click "Start Recording" 
   - Navigate through your web application
   - Interact with APIs normally
   - Monitor real-time request capture

3. **Generate Tests**
   - Stop recording when done
   - Review captured requests with filtering options
   - Configure generation options (auth tests, error scenarios, etc.)
   - Generate AI-powered test suites with cost estimation

4. **Export & Use**
   - Export to file, clipboard, or directly to VSCode
   - Review test metadata and quality scores
   - Integrate with your CI/CD pipeline

### Advanced Features

#### Enhanced Test Generation Options
- **Authentication Tests**: Automatically detect and test auth patterns
- **Error Scenario Coverage**: Generate tests for 4xx/5xx responses
- **Data Validation**: Schema validation and type checking
- **Performance Testing**: Response time assertions and load tests
- **Security Testing**: Header validation and vulnerability checks
- **Mock Data**: Generate realistic test data instead of production data

#### Privacy & Security Settings
- **Local Mode**: Process everything locally with no external calls
- **Cloud Mode**: Send masked data to AI providers with encryption
- **Hybrid Mode**: Smart routing based on data sensitivity
- **Data Masking**: Automatic PII detection with custom rules
- **Permissions Audit**: Built-in security analysis and recommendations

## 🔧 Enhanced Configuration

### Environment Variables
- `OPENAI_API_KEY`: OpenAI API key (gpt-4.1, GPT-4-turbo, GPT-3.5-turbo)
- `ANTHROPIC_API_KEY`: Claude API key (Claude-3.5-sonnet, Claude-3-haiku, Claude-3-opus)
- `GOOGLE_API_KEY`: Gemini API key (Gemini-1.5-pro, Gemini-1.5-flash, Gemini-pro)

### Advanced Settings Options
- **AI Provider & Model**: Choose from 10+ supported models across providers
- **Test Framework**: Jest, Playwright, Mocha/Chai, Cypress, Puppeteer, Vitest, Supertest, Postman
- **Test Complexity**: Basic, Intermediate, Advanced generation levels
- **Privacy Mode**: Local, Cloud, or Hybrid processing modes
- **Authentication Tests**: Enable automatic auth pattern detection
- **Error Scenarios**: Generate comprehensive error handling tests
- **Performance Testing**: Include response time and load test assertions
- **Security Testing**: Enable vulnerability and header validation tests
- **Data Masking**: Configure PII detection and custom masking rules
- **Cost Controls**: Set token limits and cost thresholds
- **Quality Thresholds**: Minimum quality scores for generated tests

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Documentation**: [docs.api-testgen-ai.com](https://docs.api-testgen-ai.com)
- **Issues**: GitHub Issues
- **Discord**: [Community Discord](https://discord.gg/api-testgen-ai)
- **Email**: support@api-testgen-ai.com

## 🗺️ Roadmap

### Phase 1: Foundation (Current)
- [x] Core extension architecture
- [x] HAR capture and processing
- [x] Multi-provider AI integration
- [x] Security and privacy features

### Phase 2: Enhancement (Q2 2024)
- [x] Advanced test generation
- [x] Self-healing tests
- [ ] Team collaboration features
- [x] Performance optimization

### Phase 3: Scale (Q3 2024)
- [ ] Enterprise features
- [ ] Mobile app testing
- [ ] Advanced analytics
- [ ] API documentation generation

### Phase 4: Innovation (Q4 2024)
- [ ] Custom model fine-tuning
- [ ] Visual test builder
- [ ] Cross-platform support
- [ ] Advanced integrations

## 📊 Enhanced Metrics & Capabilities

- **Time Savings**: 85%+ reduction in test creation time
- **Security**: AES-256 encryption, GDPR compliant, permissions audit
- **Test Framework Coverage**: 8 major frameworks (Jest, Playwright, Cypress, Mocha/Chai, Puppeteer, Vitest, Supertest, Postman)
- **AI Models**: 10+ supported models across 4 providers (OpenAI, Claude, Gemini, Local)
- **Test Types**: Authentication, Error Scenarios, Performance, Security, Data Validation
- **Quality Features**: Complexity analysis, quality scoring, improvement recommendations
- **Browser Support**: Chrome, Edge, Brave, Firefox (with documented compatibility)
- **Developer Tools**: TypeScript, ESLint, Jest testing, pre-commit hooks
- **Export Options**: File, clipboard, VSCode integration, batch operations

---

**Made with ❤️ by the XHRScribe Team**