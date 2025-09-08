# XHRscribe Architecture Documentation

## Overview

XHRscribe is a Chrome extension that captures network traffic and generates tests based on API requests. This document outlines the architecture of the extension, including the core components, data flow, and design patterns.

## Core Components

### 1. Service Worker (Background)

The service worker is the central component that manages the lifecycle of the extension and handles network recording.

**Key Classes:**
- `BackgroundService`: Manages the core functionality of the extension, including network recording and session management
- `ServiceWorkerManager`: Handles service worker persistence and lifecycle management
- `OptimizedHARProcessor`: Processes and optimizes HAR data with memory efficiency

**Responsibilities:**
- Attaching to Chrome's debugger API to capture network traffic
- Managing recording sessions
- Processing and filtering network requests
- Communicating with the popup UI
- Maintaining service worker persistence

### 2. Popup UI

The popup UI provides a user-friendly interface for controlling the extension and viewing results.

**Key Components:**
- React components for the UI
- Communication with the service worker via messaging

### 3. Test Generation Services

Services that handle the generation of test code from captured network traffic.

**Key Classes:**
- `TestGenerationService`: Coordinates test generation workflow
- `LLMService`: Manages communication with language models for test generation
- Various LLM provider implementations (OpenAI, Claude, Gemini)

### 4. Storage and Utilities

Components that handle data persistence and provide utility functions.

**Key Classes:**
- `EnhancedSecureStorage`: Provides secure storage with encryption
- `ErrorHandlingService`: Centralizes error handling and reporting

## Data Flow

### Recording Flow

1. User initiates recording from the popup UI
2. Popup sends a START_RECORDING message to the service worker
3. Service worker attaches to the Chrome debugger API on the active tab
4. Chrome debugger events are processed by the background script
5. Network requests are captured, processed, and stored in memory
6. When recording stops, the session is saved to secure storage

```
User → Popup UI → Service Worker → Chrome Debugger API → Network Requests → HAR Processing → Storage
```

### Test Generation Flow

1. User selects a recording session and requests test generation
2. Service worker retrieves the session data
3. TestGenerationService processes the data
4. LLMService sends the data to the selected AI provider
5. Generated test code is returned to the UI

```
User → Popup UI → Service Worker → TestGenerationService → LLMService → AI Provider → Generated Tests → UI
```

## Service Worker Persistence

The service worker persistence strategy uses multiple techniques to ensure the service worker remains active:

1. **Offscreen Document API**: Maintains a hidden document to keep the service worker alive
2. **Alarm API**: Sets periodic alarms to wake the service worker
3. **Self-connection**: Establishes a connection from the service worker to itself
4. **Content Script Pings**: Sends periodic messages from content scripts

The `ServiceWorkerManager` class coordinates these techniques based on the current persistence mode:
- `IDLE`: Minimal persistence for inactive periods
- `STANDARD`: Normal persistence for regular operation
- `INTENSIVE`: Maximum persistence during recording

## Error Handling

Error handling is centralized through the `ErrorHandlingService`, which provides:
- Severity-based error processing
- Error logging and persistence
- Registered error handlers for different components
- Integration with the UI for error reporting

## Security Model

Security is implemented through several mechanisms:
- `EnhancedSecureStorage` for encrypted data storage
- Device-specific encryption keys
- Data masking for sensitive information
- Content Security Policy enforcement

## Data Optimization

The extension optimizes data handling through:
- Streaming HAR processing
- Incremental entry building
- Chunked storage for large sessions
- Data compression for storage efficiency

## Component Diagram

```
+------------------------+      +------------------------+      +---------------------------+
|                        |      |                        |      |                           |
|      Popup UI          <----->|   Background Service   <----->|   Chrome Debugger API    |
|                        |      |                        |      |                           |
+------------------------+      +------------------------+      +---------------------------+
                                          ^    ^
                                          |    |
                                          v    v
+------------------------+      +------------------------+      +---------------------------+
|                        |      |                        |      |                           |
|    Service Worker      |      |   Test Generation      |      |   AI Language Models     |
|    Persistence         |      |   Services             <----->|   (OpenAI, Claude, etc.) |
|                        |      |                        |      |                           |
+------------------------+      +------------------------+      +---------------------------+
                                          ^
                                          |
                                          v
+------------------------+      +------------------------+
|                        |      |                        |
|  Enhanced Secure       |      |  Error Handling        |
|  Storage               |      |  Service               |
|                        |      |                        |
+------------------------+      +------------------------+
```

## Design Patterns

The extension uses several design patterns:

1. **Singleton Pattern**: Used for services that should have only one instance (ServiceWorkerManager, ErrorHandlingService)
2. **Observer Pattern**: Used for event handling and notifications
3. **Factory Pattern**: Used for creating LLM provider instances
4. **Strategy Pattern**: Used for different HAR processing strategies
5. **Repository Pattern**: Used for data access and storage

## Testing Strategy

The testing approach includes:
- Unit tests for individual services
- Integration tests for service interactions
- Mock implementations of Chrome APIs for testing

## Future Architecture Considerations

Potential future improvements:

1. **Worker Threads**: Offload heavy processing to worker threads
2. **IndexedDB**: Move from Chrome Storage API to IndexedDB for better performance with large datasets
3. **WebAssembly**: Use WebAssembly for performance-critical operations
4. **Microfrontend Architecture**: Split UI into more manageable components
5. **Lazy Loading**: Implement lazy loading for less frequently used features
