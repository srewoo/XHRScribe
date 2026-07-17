# Privacy Policy for XHRScribe

**Last Updated: July 2026**

## Overview

XHRScribe ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard information when you use our Chrome extension.

## Information We Collect

### Data Collected Locally
- **Network Request Data**: HTTP/HTTPS requests, responses, headers, and payload data from websites you visit while recording
- **User Settings**: AI provider preferences, API keys, test framework selections, and extension configurations
- **Session Data**: Recorded network sessions with timestamps and metadata

### Data Processing
- **Local Processing**: All data is processed locally on your device by default
- **AI Service Integration**: When using cloud AI providers, anonymized and encrypted data may be sent to:
  - OpenAI (if selected)
  - Anthropic Claude (if selected)
  - Google Gemini (if selected)
- **Local Model Option**: You can use local AI models for complete offline processing

## How We Use Your Information

### Primary Uses
- Generate automated test suites from captured network requests
- Provide AI-powered code generation services
- Store user preferences and settings
- Maintain recording session history

### Data Processing Principles
- **Minimal Collection**: We only collect data necessary for core functionality
- **User Control**: You control what data is recorded and processed
- **At-rest obfuscation**: Stored data (sessions and API keys) is encrypted with AES before being written to Chrome storage
- **Local First**: Processing happens locally when possible

## Data Security

### Encryption & Storage
- **At-rest encryption**: Recorded sessions and API keys are AES-encrypted (via CryptoJS) before being stored in `chrome.storage.local`.
- **Honest limitation**: Because a browser extension has no user-supplied passphrase, the encryption key is generated per-installation and stored **locally alongside the data**. This protects against casual inspection and sync, but it is **not** protection against an attacker who already has access to your operating-system user profile or disk — such an attacker could read the key and decrypt the data. Treat the extension's storage as only as private as your OS user account.
- **API keys stay local**: API keys are stored in `chrome.storage.local` only — they are **never** placed in `chrome.storage.sync`, so they do not transit Google's sync servers or propagate to your other devices.

### Data Transmission
- **HTTPS Only**: All external communications use HTTPS/TLS encryption.
- **Data Masking (best-effort)**: Before any data is sent to a cloud AI provider, request/response URLs, headers, and bodies are run through a masking pass that redacts common secrets and PII (auth headers, cookies, API-key and token formats, emails, credit cards, etc.). Masking is **pattern-based and best-effort** — it cannot guarantee every custom or opaque secret is removed. As a safeguard, the extension scans the outgoing payload one more time and asks you to confirm before uploading if it still detects sensitive-looking values.
- **Where data goes**: When a cloud provider is selected, the masked payload is sent only to that provider's API endpoint (OpenAI, Anthropic, or Google). The active security-scanner sends requests only to hosts you explicitly authorize (internal/loopback targets are blocked).
- **Optional Transmission**: Choosing the local (Ollama) provider keeps all processing on your machine with no external data transmission.

## Third-Party Services

### AI Providers (Optional)
When you choose to use cloud AI services:
- **OpenAI**: Subject to OpenAI's privacy policy and terms of service
- **Anthropic**: Subject to Anthropic's privacy policy and terms of service
- **Google**: Subject to Google's privacy policy and terms of service

### Data Sent to AI Providers
- **Masked Request Data**: Method, URL, headers, and request/response bodies with detected secrets/PII redacted (best-effort — see the masking note above)
- **User Control**: You can disable cloud AI and use local models instead, and you are prompted before upload if residual sensitive data is detected

## Data Retention

### Local Data
- **Recording Sessions**: Stored locally until manually deleted by user
- **Settings**: Retained until extension is uninstalled
- **API Keys**: Stored locally in encrypted format until removed by user

### External Data
- **AI Providers**: We do not control data retention by third-party AI services
- **No Persistent Storage**: We do not maintain servers or databases with your data

## User Control & Rights

### Your Choices
- **Recording Control**: Start/stop recording at any time
- **Data Deletion**: Delete any recording session or all data
- **Provider Selection**: Choose between cloud AI or local processing
- **Export Options**: Export your data in standard formats

### Privacy Settings
- **Local Mode**: Process everything offline without external API calls
- **Cloud Mode**: Use cloud AI with data masking and encryption
- **Hybrid Mode**: Smart routing based on data sensitivity
- **Custom Masking**: Define your own sensitive data patterns

## Children's Privacy

XHRScribe is not intended for users under 13 years of age. We do not knowingly collect personal information from children under 13.

## Data Sharing

### We Do NOT Share
- **Personal Information**: We never sell or share personal data
- **Recording Data**: Your captured network data remains private
- **Usage Analytics**: We do not track how you use the extension

### Limited Sharing
- **AI Processing Only**: Anonymized data may be sent to selected AI providers for code generation
- **User Controlled**: All sharing is explicitly controlled by user choices

## International Users

### Data Processing
- **Local Processing**: Most data processing occurs on your local device
- **AI Provider Locations**: Cloud AI providers may process data in various countries
- **No Cross-Border Transfers**: We do not transfer data across borders (only AI providers may)

## Changes to Privacy Policy

### Updates
- **Notification**: Users will be notified of material changes
- **Version Control**: All changes are tracked and dated
- **User Consent**: Continued use constitutes acceptance of updates

## Contact Information

### Privacy Questions
- **GitHub Issues**: [Repository URL]/issues
- **Email**: [Your contact email]
- **Documentation**: Available within the extension

### Data Requests
If you have questions about your data or privacy rights, please contact us through the channels above.

## Compliance

### Standards
- **GDPR Compliant**: Designed to meet European privacy requirements
- **CCPA Compliant**: Meets California privacy standards
- **Chrome Web Store**: Follows Google's developer policies

### User Rights
- **Access**: View all data collected by the extension
- **Deletion**: Remove any or all stored data
- **Portability**: Export data in standard formats
- **Correction**: Modify or update stored information

---

**Effective Date**: This privacy policy is effective as of the last updated date above.

**Contact**: For privacy-related questions, please contact us through our GitHub repository or the contact methods listed above.
